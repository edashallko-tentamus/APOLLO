-- LIMS3 schema, migration 028: Alex's notes on Result Finalization, 2026-10-14 (built by Claude Code; vault:
-- "Decision - Report Finalization Follow-up"). Report Finalization (the module's new name):
--  1. Handwritten signatures: a copy of each person's wet signature and their title, kept on their user record by a lab
--     administrator (signed). A COA is issued only by someone with a signature on file; the PDF prints it with the
--     printed name, title and date under the line.
--  2. Serving size on the sample; a test version can report per serving (the result as measured, plus the amount per
--     serving, worked out from the unit).
--  3. Measurement uncertainty per analyte (± a value or a % of the result), printed when switched on.
--  4. Claiming finalization work: an approver claims sample tests (a batch, FB-000001) so nobody else finalizes them
--     until they are finished or released.
--  5. The OOS loop: after a confirmed OOS is released, the client's Phase II decision is recorded on the sample
--     (re-test ordered, or no re-test). Until then the COA carrying the OOS is not the final one; after "no re-test",
--     the final COA is issued (a new version).
--  6. The report ID is the sample ID followed by R1, R2... (the version); the COA email says so.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 028: Report Finalization follow-up', true);

-------------------------------------------------------------------------------
-- 1. HANDWRITTEN SIGNATURES
-------------------------------------------------------------------------------
ALTER TABLE app_user ADD COLUMN title text;
ALTER TABLE app_user ADD COLUMN signature_document_id uuid REFERENCES document_file(id);
ALTER TABLE app_user ADD COLUMN signature_set_at timestamptz;
ALTER TABLE app_user ADD COLUMN signature_set_by uuid REFERENCES app_user(id);

-- A lab administrator (admin.users in a lab the person works in) or a system administrator records it, signed
CREATE FUNCTION set_user_signature(p_user uuid, p_doc uuid, p_title text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u app_user; d document_file; gs text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    SELECT * INTO u FROM app_user WHERE id = p_user;
    IF u.id IS NULL OR u.is_automated THEN RAISE EXCEPTION 'Person not found'; END IF;
    IF NOT current_user_is_admin() AND NOT EXISTS (
        SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id
         WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND g.site_id IS NOT NULL AND has_permission_at('admin.users', g.site_id)) THEN
        RAISE EXCEPTION 'Only a lab administrator of a lab where % works (admin.users) records their signature', u.full_name;
    END IF;
    PERFORM assert_signed('record a handwritten signature');
    IF p_doc IS NOT NULL THEN
        SELECT * INTO d FROM document_file WHERE id = p_doc;
        IF d.id IS NULL OR d.mime_type NOT IN ('image/png','image/jpeg') THEN RAISE EXCEPTION 'The signature must be a PNG or JPEG image'; END IF;
        IF octet_length(d.content) > 1048576 THEN RAISE EXCEPTION 'The signature image is larger than 1 MB: crop or shrink it'; END IF;
    END IF;
    IF btrim(COALESCE(p_title, '')) = '' THEN RAISE EXCEPTION 'Enter %''s title (printed under the signature)', u.full_name; END IF;
    PERFORM ensure_reason('Handwritten signature recorded');
    PERFORM set_config('lims.group_sync', '1', true);
    UPDATE app_user SET title = btrim(p_title), signature_document_id = COALESCE(p_doc, signature_document_id),
           signature_set_at = CASE WHEN p_doc IS NOT NULL THEN clock_timestamp() ELSE signature_set_at END,
           signature_set_by = CASE WHEN p_doc IS NOT NULL THEN current_app_user() ELSE signature_set_by END
     WHERE id = p_user;
    PERFORM set_config('lims.group_sync', gs, true);
END $$;
-- Nobody changes them except through set_user_signature
CREATE FUNCTION app_user_signature_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.signature_document_id, NEW.title, NEW.signature_set_at, NEW.signature_set_by) IS NOT DISTINCT FROM (OLD.signature_document_id, OLD.title, OLD.signature_set_at, OLD.signature_set_by) THEN
        RETURN NEW;
    END IF;
    IF NOT in_group_sync() THEN
        RAISE EXCEPTION 'A person''s signature and title are recorded by a lab administrator (Admin > People and groups)';
    END IF;
    -- written to the audit trail (people's records are not otherwise audited row by row)
    INSERT INTO audit_log (table_name, record_id, action, record_version, changed_by, reason, changed_fields, new_row)
    VALUES ('app_user', NEW.id, 'UPDATE', 1 + (SELECT count(*) FROM audit_log WHERE table_name = 'app_user' AND record_id = NEW.id),
            current_app_user(), COALESCE(current_reason(), 'Handwritten signature recorded'),
            jsonb_build_object('signature_document_id', jsonb_build_object('old', OLD.signature_document_id, 'new', NEW.signature_document_id),
                               'title', jsonb_build_object('old', OLD.title, 'new', NEW.title)),
            jsonb_build_object('id', NEW.id, 'username', NEW.username, 'full_name', NEW.full_name, 'title', NEW.title, 'signature_document_id', NEW.signature_document_id));
    RETURN NEW;
END $$;
CREATE TRIGGER a01_signature_image BEFORE UPDATE OF signature_document_id, title, signature_set_at, signature_set_by ON app_user
    FOR EACH ROW EXECUTE FUNCTION app_user_signature_rules();

-------------------------------------------------------------------------------
-- 2. SERVING SIZE AND PER-SERVING RESULTS
-------------------------------------------------------------------------------
ALTER TABLE sample ADD COLUMN serving_size numeric(14,4) CHECK (serving_size > 0);
ALTER TABLE sample ADD COLUMN serving_unit text;
CREATE FUNCTION sample_serving_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.serving_unit IS NOT NULL AND btrim(NEW.serving_unit) = '' THEN NEW.serving_unit := NULL; END IF;
    IF NEW.serving_unit IS NOT NULL THEN NEW.serving_unit := canonical_unit(NEW.serving_unit, '{Mass,Volume,Count}', 'Serving unit'); END IF;
    IF NEW.serving_size IS NOT NULL AND NEW.serving_unit IS NULL THEN RAISE EXCEPTION 'Give the serving size a unit (e.g. g)'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.logged_at IS NOT NULL AND current_reason() IS NULL
       AND (NEW.serving_size, NEW.serving_unit) IS DISTINCT FROM (OLD.serving_size, OLD.serving_unit) THEN
        RAISE EXCEPTION 'A Reason for Change is required to change the serving size of a logged sample';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_sample_serving BEFORE INSERT OR UPDATE OF serving_size, serving_unit ON sample FOR EACH ROW EXECUTE FUNCTION sample_serving_rules();

ALTER TABLE test_version ADD COLUMN report_per_serving boolean NOT NULL DEFAULT false;
-- a new version or a copy keeps it (the copy functions name their own columns)
CREATE FUNCTION test_version_carry_028() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.copied_from_version_id IS NOT NULL THEN
        SELECT report_per_serving INTO NEW.report_per_serving FROM test_version WHERE id = NEW.copied_from_version_id;
        NEW.report_per_serving := COALESCE(NEW.report_per_serving, false);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_carry_028 BEFORE INSERT ON test_version FOR EACH ROW EXECUTE FUNCTION test_version_carry_028();

-- The amount per serving of a result: a result per mass or volume (mg/kg, µg/g, mg/L, ppm, %...) times the serving size
-- in the same terms. NULL when the units do not combine (e.g. CFU per serving of a count).
CREATE FUNCTION per_serving(p_value numeric, p_unit text, p_size numeric, p_size_unit text, OUT value numeric, OUT unit text) LANGUAGE plpgsql STABLE AS $$
DECLARE u text := btrim(COALESCE(p_unit, '')); num text; den text; mult numeric := 1; f numeric;
BEGIN
    IF p_value IS NULL OR p_size IS NULL OR p_size_unit IS NULL OR u = '' THEN RETURN; END IF;
    IF lower(u) = 'ppm' THEN u := 'mg/kg'; ELSIF lower(u) = 'ppb' THEN u := 'µg/kg'; ELSIF u IN ('%', '% w/w') THEN u := 'g/100 g'; END IF;
    IF position('/' IN u) = 0 THEN RETURN; END IF;
    num := btrim(split_part(u, '/', 1)); den := btrim(split_part(u, '/', 2));
    IF den ~ '^[0-9.]+\s*\S+$' THEN mult := (regexp_replace(den, '^([0-9.]+).*$', '\1'))::numeric; den := btrim(regexp_replace(den, '^[0-9.]+\s*', '')); END IF;
    f := unit_factor(p_size_unit, den, NULL);   -- the serving in the result's "per" unit
    IF f IS NULL THEN RETURN; END IF;
    value := p_value * p_size * f / mult;
    unit := num || ' per serving';
END $$;

-------------------------------------------------------------------------------
-- 3. MEASUREMENT UNCERTAINTY
-------------------------------------------------------------------------------
ALTER TABLE test_version_analyte ADD COLUMN uncertainty numeric CHECK (uncertainty >= 0);
ALTER TABLE test_version_analyte ADD COLUMN uncertainty_kind text CHECK (uncertainty_kind IN ('%','Unit'));
ALTER TABLE test_version_analyte ADD COLUMN report_uncertainty boolean NOT NULL DEFAULT false;
CREATE FUNCTION tva_uncertainty_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src uuid;
BEGIN
    -- a new version's (or a copy's) analytes keep the source's uncertainty
    IF TG_OP = 'INSERT' AND NEW.uncertainty IS NULL THEN
        SELECT copied_from_version_id INTO src FROM test_version WHERE id = NEW.test_version_id;
        IF src IS NOT NULL THEN
            SELECT a.uncertainty, a.uncertainty_kind, a.report_uncertainty INTO NEW.uncertainty, NEW.uncertainty_kind, NEW.report_uncertainty
              FROM test_version_analyte a WHERE a.test_version_id = src AND a.analyte_id = NEW.analyte_id AND a.status = 'Active' LIMIT 1;
            NEW.report_uncertainty := COALESCE(NEW.report_uncertainty, false);
        END IF;
    END IF;
    IF NEW.uncertainty IS NOT NULL AND NEW.uncertainty_kind IS NULL THEN NEW.uncertainty_kind := 'Unit'; END IF;
    IF NEW.report_uncertainty AND NEW.uncertainty IS NULL THEN RAISE EXCEPTION 'Enter the uncertainty before switching "Report ±" on'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_uncertainty BEFORE INSERT OR UPDATE OF uncertainty, uncertainty_kind, report_uncertainty ON test_version_analyte
    FOR EACH ROW EXECUTE FUNCTION tva_uncertainty_rules();

-------------------------------------------------------------------------------
-- 4. CLAIMING FINALIZATION WORK
-------------------------------------------------------------------------------
CREATE SEQUENCE finalization_claim_seq;
CREATE TABLE finalization_claim (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_code      text NOT NULL UNIQUE DEFAULT 'FB-' || lpad(nextval('finalization_claim_seq')::text, 6, '0'),
    site_id         uuid NOT NULL REFERENCES lab_site(id),
    claimed_by      uuid NOT NULL REFERENCES app_user(id),
    status          text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Done','Released')),
    note            text,
    closed_at       timestamptz,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('finalization_claim', false);
CREATE TABLE finalization_claim_test (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_id           uuid NOT NULL REFERENCES finalization_claim(id),
    requested_test_id  uuid NOT NULL REFERENCES requested_test(id),
    status             text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Done','Released')),
    record_version     integer NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at        timestamptz NOT NULL DEFAULT now(),
    modified_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX finalization_claim_test_one ON finalization_claim_test (requested_test_id) WHERE status = 'Active';
CALL make_gxp('finalization_claim_test', false);
CREATE FUNCTION claims_internal() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('lims.claims_internal', true), '') = '1' $$;
CREATE FUNCTION finalization_claim_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF claims_internal() THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Claim and release finalization work in Report Finalization';
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON finalization_claim FOR EACH ROW EXECUTE FUNCTION finalization_claim_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON finalization_claim_test FOR EACH ROW EXECUTE FUNCTION finalization_claim_rules();

-- Who holds a test's finalization now (NULL = nobody)
CREATE FUNCTION finalization_holder(p_rt uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT c.claimed_by FROM finalization_claim_test ct JOIN finalization_claim c ON c.id = ct.claim_id WHERE ct.requested_test_id = p_rt AND ct.status = 'Active' LIMIT 1
$$;

-- Claim sample tests waiting for finalization (one batch). No signature: it only says who is working on them.
CREATE FUNCTION claim_finalization(p_tests uuid[], p_note text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_site uuid; n integer; v_claim uuid; v_rt uuid; holder text;
BEGIN
    IF COALESCE(cardinality(p_tests), 0) = 0 THEN RAISE EXCEPTION 'Choose the sample tests to claim'; END IF;
    SELECT count(DISTINCT o.site_id), min(o.site_id::text)::uuid INTO n, v_site
      FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = ANY (p_tests);
    IF n <> 1 THEN RAISE EXCEPTION 'Claim sample tests of one lab at a time'; END IF;
    PERFORM require_permission_at('reports.finalize', v_site);
    FOREACH v_rt IN ARRAY p_tests LOOP
        IF NOT test_awaits_finalization(v_rt) THEN
            RAISE EXCEPTION '% on %: nothing waits for finalization', (SELECT t.test_name FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.id = v_rt),
                (SELECT s.sample_code FROM requested_test r JOIN sample s ON s.id = r.sample_id WHERE r.id = v_rt);
        END IF;
        SELECT u.full_name INTO holder FROM app_user u WHERE u.id = finalization_holder(v_rt);
        IF holder IS NOT NULL THEN
            RAISE EXCEPTION '% on % is already claimed by %', (SELECT t.test_name FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.id = v_rt),
                (SELECT s.sample_code FROM requested_test r JOIN sample s ON s.id = r.sample_id WHERE r.id = v_rt), holder;
        END IF;
    END LOOP;
    PERFORM ensure_reason('Finalization claimed');
    PERFORM set_config('lims.claims_internal', '1', true);
    INSERT INTO finalization_claim (site_id, claimed_by, note) VALUES (v_site, current_app_user(), NULLIF(btrim(p_note), '')) RETURNING id INTO v_claim;
    INSERT INTO finalization_claim_test (claim_id, requested_test_id) SELECT v_claim, x FROM unnest(p_tests) x GROUP BY x;
    PERFORM set_config('lims.claims_internal', '', true);
    RETURN v_claim;
END $$;

-- Release a claim (all its tests, or some): its owner, or a lab administrator taking it over (with a reason)
CREATE FUNCTION release_finalization_claim(p_claim uuid, p_tests uuid[] DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE c finalization_claim; n integer;
BEGIN
    SELECT * INTO c FROM finalization_claim WHERE id = p_claim;
    IF c.id IS NULL THEN RAISE EXCEPTION 'Claim not found'; END IF;
    IF c.status <> 'Active' THEN RAISE EXCEPTION '% is % already', c.claim_code, lower(c.status); END IF;
    IF c.claimed_by <> current_app_user() THEN
        IF NOT has_permission_at('admin.users', c.site_id) THEN
            RAISE EXCEPTION '% is claimed by %: only they, or a lab administrator, can release it', c.claim_code, (SELECT full_name FROM app_user WHERE id = c.claimed_by);
        END IF;
        IF current_reason() IS NULL OR current_reason() = 'Finalization released' THEN RAISE EXCEPTION 'Say why you release someone else''s claim'; END IF;
    END IF;
    PERFORM ensure_reason('Finalization released');
    PERFORM set_config('lims.claims_internal', '1', true);
    UPDATE finalization_claim_test SET status = 'Released' WHERE claim_id = c.id AND status = 'Active' AND (p_tests IS NULL OR requested_test_id = ANY (p_tests));
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE finalization_claim SET status = CASE WHEN EXISTS (SELECT 1 FROM finalization_claim_test WHERE claim_id = c.id AND status = 'Done') THEN 'Done' ELSE 'Released' END,
           closed_at = clock_timestamp()
     WHERE id = c.id AND NOT EXISTS (SELECT 1 FROM finalization_claim_test WHERE claim_id = c.id AND status = 'Active');
    PERFORM set_config('lims.claims_internal', '', true);
    RETURN n;
END $$;

-- Finalizing: nobody finalizes a test someone else has claimed; finalizing closes the claim
CREATE FUNCTION result_finalization_claims() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h uuid := finalization_holder(NEW.requested_test_id); prev text := COALESCE(current_setting('lims.claims_internal', true), '');
BEGIN
    IF TG_WHEN = 'BEFORE' THEN
        IF h IS NOT NULL AND h <> current_app_user() THEN
            RAISE EXCEPTION '% on % is claimed by % (Report Finalization): they finalize it, or release it first',
                (SELECT t.test_name FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.id = NEW.requested_test_id),
                (SELECT s.sample_code FROM requested_test r JOIN sample s ON s.id = r.sample_id WHERE r.id = NEW.requested_test_id),
                (SELECT full_name FROM app_user WHERE id = h);
        END IF;
        RETURN NEW;
    END IF;
    PERFORM set_config('lims.claims_internal', '1', true);
    UPDATE finalization_claim_test SET status = 'Done' WHERE requested_test_id = NEW.requested_test_id AND status = 'Active';
    UPDATE finalization_claim c SET status = 'Done', closed_at = clock_timestamp()
     WHERE c.status = 'Active' AND NOT EXISTS (SELECT 1 FROM finalization_claim_test t WHERE t.claim_id = c.id AND t.status = 'Active')
       AND EXISTS (SELECT 1 FROM finalization_claim_test t WHERE t.claim_id = c.id AND t.requested_test_id = NEW.requested_test_id);
    PERFORM set_config('lims.claims_internal', prev, true);
    RETURN NULL;
END $$;
CREATE TRIGGER a02_claims BEFORE INSERT ON result_finalization FOR EACH ROW EXECUTE FUNCTION result_finalization_claims();
CREATE TRIGGER z_claims AFTER INSERT ON result_finalization FOR EACH ROW EXECUTE FUNCTION result_finalization_claims();

-------------------------------------------------------------------------------
-- 5. THE OOS LOOP: THE CLIENT'S PHASE II DECISION
-------------------------------------------------------------------------------
ALTER TABLE oos_investigation ADD COLUMN phase2_decision text CHECK (phase2_decision IN ('Retest ordered','No retest'));
ALTER TABLE oos_investigation ADD COLUMN phase2_note text;
ALTER TABLE oos_investigation ADD COLUMN phase2_by uuid REFERENCES app_user(id);
ALTER TABLE oos_investigation ADD COLUMN phase2_at timestamptz;

-- A confirmed OOS waiting for the client's decision (released to the client, or about to be)
CREATE FUNCTION oos_awaiting_phase2(p_sample uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM oos_investigation x JOIN test_result tr ON tr.id = x.test_result_id
                    WHERE x.sample_id = p_sample AND x.status = 'Closed' AND x.conclusion = 'OOS confirmed' AND x.phase2_decision IS NULL AND tr.status = 'Active')
$$;

-- "No re-test": recorded on the sample, signed; a COA note says the result stands; the final COA can then be issued
CREATE FUNCTION record_oos_phase2(p_id uuid, p_decision text, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o oos_investigation := oos_get(p_id); prev text := COALESCE(current_setting('lims.reports_internal', true), '');
BEGIN
    IF NOT (has_permission_at('orders.edit', o.site_id) OR has_permission_at('oos.open', o.site_id) OR has_permission_at('reports.finalize', o.site_id)) THEN
        PERFORM require_permission_at('orders.edit', o.site_id);
    END IF;
    PERFORM assert_signed('record the client''s Phase II decision');
    IF o.status <> 'Closed' OR o.conclusion <> 'OOS confirmed' THEN RAISE EXCEPTION '% is not a confirmed OOS', o.oos_code; END IF;
    IF o.client_notified_at IS NULL THEN RAISE EXCEPTION 'The client has not been told of % yet: it is emailed when the result is released on the COA (Report Finalization)', o.oos_code; END IF;
    IF o.phase2_decision IS NOT NULL THEN RAISE EXCEPTION 'The Phase II decision of % is already recorded (%)', o.oos_code, o.phase2_decision; END IF;
    IF p_decision <> 'No retest' THEN RAISE EXCEPTION 'Order the Phase II re-test with "Order the client retest" (it records the decision itself)'; END IF;
    IF btrim(COALESCE(p_note, '')) = '' THEN RAISE EXCEPTION 'Say how the client decided (who, when, how)'; END IF;
    PERFORM ensure_reason('Phase II decision: no re-test');
    PERFORM set_oos_internal(true);
    UPDATE oos_investigation SET phase2_decision = 'No retest', phase2_note = btrim(p_note), phase2_by = current_app_user(), phase2_at = clock_timestamp() WHERE id = o.id;
    PERFORM set_oos_internal(false);
    -- the note on the final COA (the system writes it: no reports.notes needed)
    PERFORM set_config('lims.group_sync', '1', true);
    INSERT INTO coa_note (sample_id, requested_test_id, analyte_id, kind, note_text)
    VALUES (o.sample_id, o.requested_test_id, o.analyte_id, 'COA',
            'Out of specification (' || o.oos_code || '): the laboratory investigation found no laboratory error; the client requested no Phase II re-test. The reported result stands.');
    PERFORM set_config('lims.group_sync', '', true);
END $$;
-- ordering the client re-test records the decision
CREATE FUNCTION oos_phase2_from_retest() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text := COALESCE(current_setting('lims.oos_internal', true), '');
BEGIN
    IF NEW.source = 'Client OOS Retest' AND NEW.oos_investigation_id IS NOT NULL THEN
        PERFORM set_oos_internal(true);
        UPDATE oos_investigation SET phase2_decision = 'Retest ordered', phase2_by = current_app_user(), phase2_at = clock_timestamp(),
               phase2_note = COALESCE(phase2_note, 'Client re-test ordered')
         WHERE id = NEW.oos_investigation_id AND phase2_decision IS NULL;
        PERFORM set_config('lims.oos_internal', prev, true);   -- (runs inside order_oos_retest: leave its setting as it was)
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_oos_phase2 AFTER INSERT ON requested_test FOR EACH ROW EXECUTE FUNCTION oos_phase2_from_retest();
-- coa_note: the system's own note (group sync) needs no reports.notes
CREATE OR REPLACE FUNCTION coa_note_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid;
BEGIN
    SELECT o.site_id INTO v_site FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = NEW.sample_id;
    IF NOT in_group_sync() THEN PERFORM require_permission_at('reports.notes', v_site); END IF;
    IF NEW.requested_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM requested_test WHERE id = NEW.requested_test_id AND sample_id = NEW.sample_id) THEN
        RAISE EXCEPTION 'That test is not on this sample';
    END IF;
    IF NEW.reason_code_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reason_code WHERE id = NEW.reason_code_id AND module = 'COA comments') THEN
        RAISE EXCEPTION 'Canned notes come from the COA comments list (Canned reasons)';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.sample_id <> OLD.sample_id OR NEW.kind <> OLD.kind) THEN RAISE EXCEPTION 'A note stays on its sample and keeps its kind'; END IF;
    RETURN NEW;
END $$;

-------------------------------------------------------------------------------
-- 6. THE COA VERSION: SIGNED WITH A HANDWRITTEN SIGNATURE ON FILE; NOT FINAL WHILE AN OOS DECISION IS OUTSTANDING
-------------------------------------------------------------------------------
ALTER TABLE coa_version ADD COLUMN signature_image_id uuid REFERENCES document_file(id);
ALTER TABLE coa_version ADD COLUMN signer_title text;
CREATE FUNCTION coa_version_signer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u app_user;
BEGIN
    SELECT * INTO u FROM app_user WHERE id = NEW.issued_by;
    IF NOT u.is_automated THEN   -- (a workflow verification's automated accounts sign no client COA)
        IF u.signature_document_id IS NULL OR btrim(COALESCE(u.title, '')) = '' THEN
            RAISE EXCEPTION '% has no handwritten signature and title on file: a lab administrator adds them (Admin > People and groups) before a COA can be issued', u.full_name;
        END IF;
        NEW.signature_image_id := u.signature_document_id; NEW.signer_title := u.title;
    END IF;
    IF NEW.is_final AND oos_awaiting_phase2((SELECT sample_id FROM coa WHERE id = NEW.coa_id)) THEN NEW.is_final := false; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_signer BEFORE INSERT ON coa_version FOR EACH ROW EXECUTE FUNCTION coa_version_signer();

-- Samples whose final COA is due: the OOS decision is recorded, every test is finalized, the latest version is not final
CREATE VIEW final_coa_due_view AS
SELECT s.id AS sample_id, s.sample_code, s.client_sample_id, o.id AS lab_order_id, o.order_code, o.site_id, COALESCE(c.display_name, c.legal_name) AS client_name, c.id AS client_id,
       v.version_no AS last_version, v.issued_at AS last_issued_at,
       (SELECT string_agg(x.oos_code || ': ' || x.phase2_decision, ', ') FROM oos_investigation x WHERE x.sample_id = s.id AND x.phase2_decision IS NOT NULL) AS decisions
  FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id JOIN coa ON coa.sample_id = s.id
  JOIN LATERAL (SELECT * FROM coa_version cv WHERE cv.coa_id = coa.id ORDER BY cv.version_no DESC LIMIT 1) v ON true
 WHERE NOT v.is_final AND NOT oos_awaiting_phase2(s.id)
   AND EXISTS (SELECT 1 FROM oos_investigation x WHERE x.sample_id = s.id AND x.phase2_decision = 'No retest')
   AND NOT EXISTS (SELECT 1 FROM requested_test r WHERE r.sample_id = s.id AND r.status <> 'Cancelled' AND NOT test_is_replaced(r.id) AND NOT test_is_finalized(r.id));

-------------------------------------------------------------------------------
-- 7. THE REPORT ID IN THE COA EMAIL (sample ID followed by R and the version)
-------------------------------------------------------------------------------
UPDATE email_template SET subject = replace(subject, '{{coa_code}} version {{version_no}}', '{{sample_code}}-R{{version_no}} (version {{version_no}})'),
       body = replace(body, '{{coa_code}}, version {{version_no}}', '{{sample_code}}-R{{version_no}} (version {{version_no}})')
 WHERE template_code = 'COA Issued';

-------------------------------------------------------------------------------
-- 8. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_028;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'finalization_claim' THEN
        RETURN jsonb_build_object('label', 'Finalization claim ' || (r->>'claim_code'), 'link', '#/reports/finalization?tab=batched');
    ELSIF p_table = 'finalization_claim_test' THEN
        RETURN jsonb_build_object('label', 'Finalization claim of ' || COALESCE((SELECT s.sample_code || ' ' || t.test_name FROM requested_test rt JOIN sample s ON s.id = rt.sample_id
            JOIN test t ON t.id = rt.test_id WHERE rt.id = (r->>'requested_test_id')::uuid), ''), 'link', '#/reports/finalization?tab=batched');
    END IF;
    RETURN audit_record_ref_028(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
