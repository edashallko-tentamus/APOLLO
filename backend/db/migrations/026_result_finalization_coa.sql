-- LIMS3 schema, migration 026: R-1, Result Finalization and the Certificate of Analysis (Alex Kiddle, 2026-10-13:
-- "complete the testing process by sending finalized COAs to clients"). Built by Claude in the cloud.
-- Vault: Decision - Result Finalization and the Certificate of Analysis.
--  - Result Finalization: the second review (authorization of the report). Every sample test whose results QC Review
--    approved waits in a queue; a Project Manager (or QA for GMP work) finalizes a group of them with one signing act,
--    which records a signature on each COA separately. Never skipped.
--  - The COA: one per sample, versioned, never deleted. Each version is a PDF made by the server, fingerprinted
--    (SHA-256) and chained to the previous version's fingerprint, with a verification code anyone can check. A version
--    holds every result finalized so far; tests still in the lab are listed as in progress. The last test's
--    finalization makes the final version, and the order is Reported once every sample has its final COA.
--  - Release check: the server's checks travel with each version; a Block stops it, a Warning needs a reason.
--  - COA notes (on the sample or on one result, typed or canned) and an internal note; canned COA comments are kept by
--    QA in Canned reasons ("COA comments").
--  - Sample compliance category (static list kept by administrators and QA), sample attachments (submission form...),
--    the client's "Allow partial reports", and automated email templates kept in the Outbox.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 026: Result Finalization and the COA', true);

-------------------------------------------------------------------------------
-- 0. PERMISSIONS AND THE PROJECT MANAGER GROUP
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('reports.finalize', 'Reports', 'Result Finalization', 'Finalize approved results and issue the sample''s COA (the second review)', false, 95),
 ('reports.finalize_gmp', 'Reports', 'Result Finalization (GMP)', 'Finalize results of GMP work (a Regulated client or a cGMP sample)', false, 96),
 ('reports.notes', 'Reports', 'COA notes', 'Add COA notes and internal notes to samples and results', false, 97),
 ('outbox.templates', 'Lab orders', 'Email templates', 'Change the automatic email templates in the Outbox', false, 42),
 ('master.compliance', 'Master data', 'Compliance categories', 'Keep the list of sample compliance categories', false, 26);

INSERT INTO standard_group_template (group_name, description, permissions, sort_order) VALUES
 ('Project Manager', 'Manages clients'' projects: finalizes approved results and releases COAs (Result Finalization).',
  '{reports.finalize,reports.notes,orders.edit,master.clients,audit.view,purchasing.request,purchasing.receive}', 9);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES
 ('QA', '{reports.finalize,reports.finalize_gmp,reports.notes,outbox.templates,master.compliance}'),
 ('Administrator', '{outbox.templates,master.compliance}'),
 ('Lab Supervisor', '{reports.notes}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;
SELECT create_standard_groups(id) FROM lab_site;    -- adds Project Manager to every lab

-------------------------------------------------------------------------------
-- 1. SAMPLE COMPLIANCE CATEGORY (static list), SAMPLE ATTACHMENTS, PARTIAL REPORTS
-------------------------------------------------------------------------------
CREATE TABLE compliance_category (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_name   text NOT NULL CHECK (btrim(category_name) <> ''),
    is_gmp          boolean NOT NULL DEFAULT false,      -- GMP work: finalized by QA (reports.finalize_gmp)
    description     text,
    sort_order      integer NOT NULL DEFAULT 100,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX compliance_category_uq ON compliance_category (lower(category_name));
CALL make_gxp('compliance_category');
-- Alex's list (the sample submission forms), then Claude's suggestions (marked in the description)
INSERT INTO compliance_category (category_name, is_gmp, description, sort_order) VALUES
 ('Food', false, NULL, 10), ('Beverage', false, NULL, 20), ('Cosmetic', false, NULL, 30), ('Drug product', true, '21 CFR 210/211', 40),
 ('Dietary supplement', false, '21 CFR 111', 50), ('cGMP', true, 'Current good manufacturing practice work', 60), ('Internal use', false, NULL, 70),
 ('Non-FDA work', false, NULL, 80), ('Research', false, NULL, 90),
 ('Animal food and pet food', false, 'Suggested by Claude', 100), ('Hemp and cannabinoid products', false, 'Suggested by Claude', 110),
 ('Medical device', true, 'Suggested by Claude (21 CFR 820)', 120), ('OTC drug', true, 'Suggested by Claude', 130),
 ('Infant formula', false, 'Suggested by Claude (21 CFR 106)', 140), ('Water', false, 'Suggested by Claude', 150),
 ('Stability study', false, 'Suggested by Claude', 160), ('Raw material or ingredient', false, 'Suggested by Claude', 170);
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON compliance_category FOR EACH ROW EXECUTE FUNCTION require_list_permission('master.compliance');

ALTER TABLE sample ADD COLUMN compliance_category text;
CREATE FUNCTION sample_compliance_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
    IF NEW.compliance_category IS NOT NULL AND btrim(NEW.compliance_category) = '' THEN NEW.compliance_category := NULL; END IF;
    IF NEW.compliance_category IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.compliance_category IS DISTINCT FROM OLD.compliance_category) THEN
        SELECT category_name INTO v FROM compliance_category WHERE lower(category_name) = lower(btrim(NEW.compliance_category)) AND status = 'Active';
        IF v IS NULL THEN
            RAISE EXCEPTION 'Compliance category "%" is not on the list. Pick one from the list, or ask QA or an administrator to add it.', NEW.compliance_category;
        END IF;
        NEW.compliance_category := v;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER b_sample_compliance BEFORE INSERT OR UPDATE ON sample FOR EACH ROW EXECUTE FUNCTION sample_compliance_check();
CREATE OR REPLACE VIEW sample_view AS
SELECT s.id, s.lab_order_id, s.sample_code, s.client_sample_id, s.description, s.matrix, s.product, s.lot, s.batch, s.quantity_received,
       s.quantity_unit, s.number_of_units, s.condition, s.receipt_temperature, s.preservation, s.received_at, s.logged_at, s.logged_by, s.status,
       s.record_version, s.created_at, s.created_by, s.modified_at, s.modified_by,
       (SELECT max(due_date) FROM requested_test rt WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled') AS due_date,
       (SELECT count(*) FROM requested_test rt WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled') AS test_count,
       (SELECT COALESCE(sum(price + rush_fee), 0) FROM requested_test rt WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled') AS sample_value,
       s.compliance_category
  FROM sample s;

-- GMP work: a Regulated client, or a sample whose category is GMP
CREATE FUNCTION sample_is_gmp(p_sample uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(c.is_gmp_client, false) OR COALESCE((SELECT k.is_gmp FROM compliance_category k WHERE k.category_name = s.compliance_category), false)
      FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id WHERE s.id = p_sample
$$;

ALTER TABLE client ADD COLUMN allow_partial_reports boolean NOT NULL DEFAULT true;

CREATE TABLE sample_attachment (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_order_id    uuid NOT NULL REFERENCES lab_order(id),
    sample_id       uuid REFERENCES sample(id),           -- NULL = the whole order (e.g. the submission form)
    document_id     uuid NOT NULL REFERENCES document_file(id),
    kind            text NOT NULL DEFAULT 'Other' CHECK (kind IN ('Sample submission form','Chain of custody','Client correspondence','Photo','Other')),
    label           text,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX sample_attachment_order_idx ON sample_attachment (lab_order_id);
CALL make_gxp('sample_attachment', false);
CREATE FUNCTION sample_attachment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid;
BEGIN
    SELECT site_id INTO v_site FROM lab_order WHERE id = NEW.lab_order_id;
    IF NOT (has_permission_at('orders.edit', v_site) OR has_permission_at('reports.notes', v_site)) THEN
        PERFORM require_permission_at('orders.edit', v_site);
    END IF;
    IF NEW.sample_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sample WHERE id = NEW.sample_id AND lab_order_id = NEW.lab_order_id) THEN
        RAISE EXCEPTION 'That sample is not on this order';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.document_id <> OLD.document_id OR NEW.lab_order_id <> OLD.lab_order_id) THEN
        RAISE EXCEPTION 'An attachment keeps its file: add a new one and set this one Inactive';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON sample_attachment FOR EACH ROW EXECUTE FUNCTION sample_attachment_rules();

-------------------------------------------------------------------------------
-- 2. AUTOMATED EMAILS ARE TEMPLATES IN THE OUTBOX
-------------------------------------------------------------------------------
CREATE TABLE email_template (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code   text NOT NULL UNIQUE,                 -- what the system sends it for (fixed)
    template_name   text NOT NULL,
    subject         text NOT NULL CHECK (btrim(subject) <> ''),
    body            text NOT NULL CHECK (btrim(body) <> ''),
    placeholders    text,                                 -- the {{names}} the system fills in (shown to the editor)
    is_active       boolean NOT NULL DEFAULT true,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('email_template');
INSERT INTO email_template (template_code, template_name, subject, body, placeholders) VALUES
 ('Rush Not Accepted', 'Rush request not accepted',
  'Rush request not accepted: {{test_name}} on {{sample}} (order {{order_code}})',
  E'Dear {{first_name}},\n\nWe are unable to accept the {{requested_tier}} rush you requested for {{test_name}} on sample {{sample_logged}} (your ID: {{client_sample_id}}).\n\nIt has been changed to: {{new_tier}}.\nNew due date: {{due_date}}.\nRush fee: ${{old_fee}} changed to ${{new_fee}}.\nReason: {{reason}}\n\nProcessed by {{staff_name}}, {{site_name}}.\nPlease reply to this email or call us if you have any questions.',
  'first_name, test_name, sample, sample_logged, client_sample_id, order_code, requested_tier, new_tier, due_date, old_fee, new_fee, reason, staff_name, site_name'),
 ('COA Issued', 'Certificate of Analysis issued',
  'Certificate of Analysis {{coa_code}} version {{version_no}}: {{client_sample_id}} (order {{order_code}})',
  E'Dear {{first_name}},\n\nThe Certificate of Analysis for your sample {{client_sample_id}} ({{sample_code}}) is attached: {{coa_code}}, version {{version_no}}.\n{{status_line}}\n\nTo check that a copy of this certificate is genuine, open {{verify_url}} (verification code {{verify_code}}).\n\nThank you for choosing {{site_name}}.\n{{staff_name}}',
  'first_name, client_sample_id, sample_code, coa_code, version_no, status_line, order_code, verify_url, verify_code, site_name, staff_name'),
 ('OOS Result', 'Out of specification result (R-2, not sent yet)',
  'Out of specification result: {{client_sample_id}} ({{test_name}}), order {{order_code}}',
  E'Dear {{first_name}},\n\nA result for your sample {{client_sample_id}} ({{sample_code}}) is outside the specification you provided:\n{{oos_results}}\n\nOur laboratory investigation (Phase I) is complete: {{phase1_conclusion}}{{phase1_attachment}}\n\nWould you like us to carry out Phase II re-testing on your sample, working in parallel with your own investigation? Please choose one of the options below:\n- Retest: {{link_retest}}\n- Retest in duplicate: {{link_retest_duplicate}}\n- Test a new sample from the same batch: {{link_new_sample}}\n- Hold or return the retained sample: {{link_retain}}\n- Request a call with our Quality team: {{link_call}}\n- Acknowledge receipt (no further testing): {{link_acknowledge}}\n\nRetests are carried out on a new preparation from the retained sample.\n\n{{staff_name}}, {{site_name}}',
  'first_name, client_sample_id, sample_code, test_name, order_code, oos_results, phase1_conclusion, phase1_attachment, link_retest, link_retest_duplicate, link_new_sample, link_retain, link_call, link_acknowledge, staff_name, site_name');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON email_template FOR EACH ROW EXECUTE FUNCTION require_list_permission('outbox.templates');
CREATE FUNCTION email_template_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.template_code <> OLD.template_code THEN RAISE EXCEPTION 'A template''s code is what the system sends it for: it cannot change'; END IF;
    IF TG_OP = 'INSERT' AND NOT in_group_sync() THEN RAISE EXCEPTION 'The system''s templates are added by migrations; change the wording of an existing one instead'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_rules BEFORE INSERT OR UPDATE ON email_template FOR EACH ROW EXECUTE FUNCTION email_template_rules();

ALTER TABLE email_outbox ADD COLUMN coa_version_id uuid;   -- the COA version attached (FK added below)

-- {{name}} replaced by vars->>name (missing names are left visible so a template error shows)
CREATE FUNCTION fill_template(p_text text, p_vars jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; v text; out text := p_text;
BEGIN
    FOR k, v IN SELECT key, COALESCE(value #>> '{}', '') FROM jsonb_each(COALESCE(p_vars, '{}')) LOOP
        out := replace(out, '{{' || k || '}}', v);
    END LOOP;
    RETURN out;
END $$;
CREATE FUNCTION queue_email(p_code text, p_to text, p_to_name text, p_vars jsonb, p_order uuid, p_coa_version uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE t email_template; v uuid;
BEGIN
    SELECT * INTO t FROM email_template WHERE template_code = p_code;
    IF t.id IS NULL THEN RAISE EXCEPTION 'No email template "%"', p_code; END IF;
    IF NOT t.is_active THEN RETURN NULL; END IF;
    INSERT INTO email_outbox (template, to_address, to_name, subject, body, lab_order_id, coa_version_id)
    VALUES (p_code, p_to, p_to_name, fill_template(t.subject, p_vars), fill_template(t.body, p_vars), p_order, p_coa_version) RETURNING id INTO v;
    RETURN v;
END $$;

-- The rush email (migration 003) now comes from its template; the text is the same as before
CREATE OR REPLACE FUNCTION rush_decision_apply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_rt requested_test; v_old_fee numeric; v_old_due date; n requested_test; s sample; o lab_order; c contact;
        t test; tier_req rush_fee_tier; tier_rep rush_fee_tier; u app_user; si lab_site;
BEGIN
    SELECT * INTO v_rt FROM requested_test WHERE id = NEW.requested_test_id;
    IF v_rt.rush_tier_id IS DISTINCT FROM NEW.requested_tier_id OR v_rt.rush_status NOT IN ('Pending Approval','Auto-accepted','Approved') THEN
        RAISE EXCEPTION 'There is no open rush request for that tier on this test';
    END IF;
    IF NEW.decision = 'Approved' THEN
        IF v_rt.rush_status <> 'Pending Approval' THEN RAISE EXCEPTION 'This rush does not need approval'; END IF;
        UPDATE requested_test SET rush_status = 'Approved' WHERE id = v_rt.id;
        RETURN NULL;
    END IF;
    IF NEW.replacement_tier_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM rush_fee_tier a JOIN rush_fee_tier b ON b.schedule_id = a.schedule_id
         WHERE a.id = NEW.requested_tier_id AND b.id = NEW.replacement_tier_id AND b.rush_tat > a.rush_tat) THEN
        RAISE EXCEPTION 'The replacement must be a slower tier on the same rush schedule, or standard turnaround';
    END IF;
    v_old_fee := v_rt.rush_fee; v_old_due := v_rt.due_date;
    PERFORM set_config('lims.rush_explicit', '1', true);
    UPDATE requested_test
       SET rush_tier_id = NEW.replacement_tier_id,
           rush_status = CASE WHEN NEW.replacement_tier_id IS NULL THEN 'Not Accepted' ELSE 'Approved' END::rush_status
     WHERE id = v_rt.id RETURNING * INTO n;
    PERFORM set_config('lims.rush_explicit', '', true);
    SELECT * INTO s FROM sample WHERE id = n.sample_id;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    SELECT * INTO c FROM contact WHERE id = o.ordering_contact_id;
    SELECT * INTO t FROM test WHERE id = n.test_id;
    SELECT * INTO tier_req FROM rush_fee_tier WHERE id = NEW.requested_tier_id;
    SELECT * INTO tier_rep FROM rush_fee_tier WHERE id = NEW.replacement_tier_id;
    SELECT * INTO u FROM app_user WHERE id = current_app_user();
    SELECT * INTO si FROM lab_site WHERE id = o.site_id;
    PERFORM queue_email('Rush Not Accepted', c.email, c.first_name || ' ' || c.last_name, jsonb_build_object(
        'first_name', c.first_name, 'test_name', t.test_name, 'sample', COALESCE(s.sample_code, s.client_sample_id, 'your sample'),
        'sample_logged', COALESCE(s.sample_code, s.client_sample_id, '(not yet logged)'), 'client_sample_id', COALESCE(s.client_sample_id, 'none'),
        'order_code', o.order_code, 'requested_tier', tier_req.tier_name, 'new_tier', COALESCE(tier_rep.tier_name || ' rush', 'standard turnaround'),
        'due_date', COALESCE(to_char(n.due_date, 'FMMonth FMDD, YYYY'), 'set when the sample is logged'),
        'old_fee', to_char(v_old_fee, 'FM999990.00'), 'new_fee', to_char(n.rush_fee, 'FM999990.00'), 'reason', NEW.reason,
        'staff_name', u.full_name, 'site_name', si.site_name), o.id);
    RETURN NULL;
END $$;

-------------------------------------------------------------------------------
-- 3. CANNED COA COMMENTS (and Reports reasons) in Canned reasons
-------------------------------------------------------------------------------
ALTER TABLE reason_code DROP CONSTRAINT reason_code_module_check;
ALTER TABLE reason_code ADD CONSTRAINT reason_code_module_check
    CHECK (module IN ('General','Clients','Orders','Quotes','Catalog','Inventory','Equipment','Purchasing','Methods','Testing','Reports','COA comments','Admin'));
-- (the canned COA comments themselves are in seed_020: canned reasons are changed by people holding master.reasons)

-------------------------------------------------------------------------------
-- 4. THE COA, ITS VERSIONS, NOTES AND FINALIZATIONS
-------------------------------------------------------------------------------
CREATE FUNCTION reports_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.reports_internal', true), '') = '1'
$$;
CREATE FUNCTION set_reports_internal(p_on boolean) RETURNS text LANGUAGE sql AS $$
    SELECT set_config('lims.reports_internal', CASE WHEN p_on THEN '1' ELSE '' END, true)
$$;
CREATE FUNCTION reports_tables_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF reports_internal() THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Use Result Finalization (COAs and finalizations are recorded by the finalization)';
END $$;
CREATE FUNCTION reports_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'An issued COA version is kept exactly as issued: finalize again to issue a new version'; END $$;

CREATE SEQUENCE finalization_group_seq;
CREATE TABLE coa (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sample_id       uuid NOT NULL UNIQUE REFERENCES sample(id),
    coa_code        text NOT NULL UNIQUE,                 -- COA-<sample ID>
    site_id         uuid NOT NULL REFERENCES lab_site(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('coa', false);
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON coa FOR EACH ROW EXECUTE FUNCTION reports_tables_rules();

CREATE TABLE coa_version (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    coa_id            uuid NOT NULL REFERENCES coa(id),
    version_no        integer NOT NULL CHECK (version_no > 0),
    is_final          boolean NOT NULL,                   -- no test left in the lab
    content           jsonb NOT NULL,                     -- exactly what the PDF shows
    document_id       uuid NOT NULL REFERENCES document_file(id),   -- the PDF
    sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    prev_sha256       text CHECK (prev_sha256 ~ '^[0-9a-f]{64}$'), -- the chain: the previous version's fingerprint
    verify_code       text NOT NULL UNIQUE,
    release_checks    jsonb NOT NULL DEFAULT '[]',        -- the release check, with the reasons given for warnings
    internal_note     text,
    group_code        text NOT NULL,                      -- the finalization group it was signed in
    issued_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    issued_by         uuid NOT NULL REFERENCES app_user(id),
    signature_id      uuid NOT NULL REFERENCES signature_event(id),
    record_version    integer NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at       timestamptz NOT NULL DEFAULT now(),
    modified_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (coa_id, version_no)
);
CALL make_gxp('coa_version', false);
CREATE TRIGGER a00_frozen BEFORE UPDATE ON coa_version FOR EACH ROW EXECUTE FUNCTION reports_frozen();
CREATE TRIGGER a01_rules BEFORE INSERT ON coa_version FOR EACH ROW EXECUTE FUNCTION reports_tables_rules();
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_coa_version_fk FOREIGN KEY (coa_version_id) REFERENCES coa_version(id);

CREATE TABLE result_finalization (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_test_id  uuid NOT NULL REFERENCES requested_test(id),
    result_ids         uuid[] NOT NULL,                   -- the approved results it covers (a later re-review changes them)
    coa_version_id     uuid REFERENCES coa_version(id),   -- NULL when the client takes no partial reports (held for the final COA)
    group_code         text NOT NULL,
    finalized_by       uuid NOT NULL REFERENCES app_user(id),
    finalized_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    signature_id       uuid NOT NULL REFERENCES signature_event(id),
    record_version     integer NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at        timestamptz NOT NULL DEFAULT now(),
    modified_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX result_finalization_rt_idx ON result_finalization (requested_test_id);
CALL make_gxp('result_finalization', false);
CREATE TRIGGER a00_frozen BEFORE UPDATE ON result_finalization FOR EACH ROW EXECUTE FUNCTION reports_frozen();
CREATE TRIGGER a01_rules BEFORE INSERT ON result_finalization FOR EACH ROW EXECUTE FUNCTION reports_tables_rules();

-- Notes: an internal note (never printed) or a COA note on the sample or on one result (typed or canned)
CREATE TABLE coa_note (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sample_id          uuid NOT NULL REFERENCES sample(id),
    requested_test_id  uuid REFERENCES requested_test(id),
    analyte_id         uuid REFERENCES analyte(id),       -- with requested_test_id: the note is on that result
    kind               text NOT NULL CHECK (kind IN ('Internal','COA')),
    note_text          text NOT NULL CHECK (btrim(note_text) <> ''),
    reason_code_id     uuid REFERENCES reason_code(id),   -- a canned COA comment
    status             record_status NOT NULL DEFAULT 'Active',
    record_version     integer NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at        timestamptz NOT NULL DEFAULT now(),
    modified_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CHECK (analyte_id IS NULL OR requested_test_id IS NOT NULL)
);
CREATE INDEX coa_note_sample_idx ON coa_note (sample_id);
CALL make_gxp('coa_note', false);
CREATE FUNCTION coa_note_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid;
BEGIN
    SELECT o.site_id INTO v_site FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = NEW.sample_id;
    PERFORM require_permission_at('reports.notes', v_site);
    IF NEW.requested_test_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM requested_test WHERE id = NEW.requested_test_id AND sample_id = NEW.sample_id) THEN
        RAISE EXCEPTION 'That test is not on this sample';
    END IF;
    IF NEW.reason_code_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM reason_code WHERE id = NEW.reason_code_id AND module = 'COA comments') THEN
        RAISE EXCEPTION 'Canned notes come from the COA comments list (Canned reasons)';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.sample_id <> OLD.sample_id OR NEW.kind <> OLD.kind) THEN RAISE EXCEPTION 'A note stays on its sample and keeps its kind'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON coa_note FOR EACH ROW EXECUTE FUNCTION coa_note_rules();

-------------------------------------------------------------------------------
-- 5. WHAT IS READY FOR FINALIZATION
-------------------------------------------------------------------------------
-- The approved results of a test (final stage, active), in a fixed order
CREATE FUNCTION test_final_result_ids(p_rt uuid) RETURNS uuid[] LANGUAGE sql STABLE AS $$
    SELECT COALESCE(array_agg(tr.id ORDER BY tr.id), '{}') FROM test_result tr WHERE tr.requested_test_id = p_rt AND tr.status = 'Active' AND tr.stage = 'Final'
$$;
-- A test waits for finalization when QC Review approved its final result, nothing is re-prepping, and its current
-- results are not the ones last finalized. Client work only (not verification or media qualification samples).
CREATE FUNCTION test_awaits_finalization(p_rt uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT rt.status <> 'Cancelled' AND s.status <> 'Cancelled' AND rt.media_lot_id IS NULL AND o.origin::text <> 'Workflow Verification' AND NOT COALESCE(c.is_internal, false)
       AND EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.result_key IS NULL AND tr.stage = 'Final')
       AND NOT EXISTS (SELECT 1 FROM reprep_request rp WHERE rp.requested_test_id = rt.id AND rp.status = 'Pooled')
       AND test_final_result_ids(rt.id) IS DISTINCT FROM (SELECT f.result_ids FROM result_finalization f WHERE f.requested_test_id = rt.id ORDER BY f.finalized_at DESC LIMIT 1)
      FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id
     WHERE rt.id = p_rt
$$;
-- Finalized and still current (its results have not changed since)
CREATE FUNCTION test_is_finalized(p_rt uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM result_finalization f WHERE f.requested_test_id = p_rt)
       AND test_final_result_ids(p_rt) IS NOT DISTINCT FROM (SELECT f.result_ids FROM result_finalization f WHERE f.requested_test_id = p_rt ORDER BY f.finalized_at DESC LIMIT 1)
$$;

CREATE VIEW finalization_queue_view AS
SELECT rt.id AS requested_test_id, rt.sample_id, s.sample_code, s.client_sample_id, s.compliance_category, o.id AS lab_order_id, o.order_code, o.site_id,
       c.id AS client_id, COALESCE(c.display_name, c.legal_name) AS client_name, c.account_status, rt.test_id, t.test_code, t.test_name, rt.due_date, rt.rush_status,
       (SELECT max(tr.approved_at) FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active') AS approved_at,
       (SELECT string_agg(DISTINCT u.full_name, ', ') FROM test_result tr JOIN app_user u ON u.id = tr.approved_by WHERE tr.requested_test_id = rt.id AND tr.status = 'Active') AS reviewed_by,
       sample_is_gmp(s.id) AS is_gmp,
       EXISTS (SELECT 1 FROM result_finalization f WHERE f.requested_test_id = rt.id) AS refinalize,
       EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.conformance = 'Does not conform') AS has_oos,
       (SELECT count(*) FROM requested_test r2 WHERE r2.sample_id = s.id AND r2.status <> 'Cancelled' AND r2.id <> rt.id
           AND NOT test_is_finalized(r2.id) AND NOT test_awaits_finalization(r2.id))::int AS other_tests_in_lab
  FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id
  JOIN test t ON t.id = rt.test_id
 WHERE test_awaits_finalization(rt.id);

-------------------------------------------------------------------------------
-- 6. FINALIZE AND ISSUE (one call per sample, inside the signed transaction of the group)
-------------------------------------------------------------------------------
CREATE FUNCTION next_finalization_group() RETURNS text LANGUAGE sql AS $$
    SELECT 'FG-' || lpad(nextval('finalization_group_seq')::text, 6, '0')
$$;

-- p_tests: the sample's tests finalized now. p_content: what the PDF shows (built by the server from the record);
-- p_doc / p_sha: the PDF; p_checks: the release check with reasons for warnings. Returns the new version, or NULL
-- when the client takes no partial reports and tests are still in the lab (finalized, held for the final COA).
CREATE FUNCTION finalize_sample(p_sample uuid, p_tests uuid[], p_content jsonb, p_doc uuid, p_sha text, p_checks jsonb, p_group text,
                                p_internal_note text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s sample; o lab_order; cl client; si lab_site; v_rt uuid; v_coa coa; v_prev coa_version; v_ver uuid; v_no integer; v_pending integer;
        d document_file; x jsonb; v_sig uuid := NULLIF(current_setting('lims.signature_id', true), '')::uuid; v_code text; ct record; u app_user;
        v_ids uuid[]; v_bad text;
BEGIN
    SELECT * INTO s FROM sample WHERE id = p_sample FOR UPDATE;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Sample not found'; END IF;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    SELECT * INTO cl FROM client WHERE id = o.client_id;
    SELECT * INTO si FROM lab_site WHERE id = o.site_id;
    SELECT * INTO u FROM app_user WHERE id = current_app_user();
    PERFORM require_permission_at('reports.finalize', o.site_id);
    IF sample_is_gmp(s.id) AND NOT has_permission_at('reports.finalize_gmp', o.site_id) THEN
        RAISE EXCEPTION '% is GMP work (%): it is finalized by the quality team (reports.finalize_gmp)', s.sample_code,
            CASE WHEN cl.is_gmp_client THEN 'a Regulated client' ELSE 'compliance category ' || s.compliance_category END;
    END IF;
    PERFORM assert_signed('finalize results and issue a COA');
    p_tests := COALESCE(p_tests, '{}');
    -- no test: a new version of an issued COA (e.g. a corrected note or client detail), with a reason
    IF cardinality(p_tests) = 0 THEN
        IF NOT EXISTS (SELECT 1 FROM coa c JOIN coa_version v ON v.coa_id = c.id WHERE c.sample_id = p_sample) THEN RAISE EXCEPTION 'Choose the tests to finalize'; END IF;
        IF current_reason() IS NULL OR current_reason() = 'Finalized for release' THEN RAISE EXCEPTION 'Say why a new version of the COA of % is issued', s.sample_code; END IF;
    END IF;
    IF cl.account_status = 'On Hold' THEN RAISE EXCEPTION '% is On Hold: its reports cannot be released', COALESCE(cl.display_name, cl.legal_name); END IF;

    FOREACH v_rt IN ARRAY p_tests LOOP
        IF NOT EXISTS (SELECT 1 FROM requested_test WHERE id = v_rt AND sample_id = p_sample) THEN RAISE EXCEPTION 'A test is not on sample %', s.sample_code; END IF;
        IF NOT test_awaits_finalization(v_rt) THEN
            RAISE EXCEPTION '% on %: nothing waits for finalization (not approved in QC Review yet, or already finalized)',
                (SELECT t.test_name FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.id = v_rt), s.sample_code;
        END IF;
        -- R-2 builds the OOS process; until then an out-of-specification result is held
        SELECT string_agg(a.analyte_name || ' ' || tr.reported, ', ') INTO v_bad FROM test_result tr JOIN analyte a ON a.id = tr.analyte_id
         WHERE tr.requested_test_id = v_rt AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.conformance = 'Does not conform';
        IF v_bad IS NOT NULL THEN
            RAISE EXCEPTION '% does not conform to its specification (%): it is held for the OOS process and cannot be finalized yet', s.sample_code, v_bad;
        END IF;
        -- the second review is someone else's: not who did, witnessed or reviewed the work
        IF EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id JOIN step_run r ON r.batch_id = b.id
                    WHERE e.requested_test_id = v_rt AND b.status <> 'Cancelled'
                      AND (r.performed_by = current_app_user() OR r.witness_id = current_app_user() OR b.reviewed_by = current_app_user()))
           OR EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = v_rt AND tr.status = 'Active' AND tr.approved_by = current_app_user()) THEN
            RAISE EXCEPTION 'You performed, witnessed or reviewed the work on % (%): someone else finalizes it', s.sample_code,
                (SELECT t.test_name FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.id = v_rt);
        END IF;
    END LOOP;

    -- the release check: no Block, and a reason for every Warning
    FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_checks, '[]')) LOOP
        IF x->>'level' = 'Block' THEN RAISE EXCEPTION 'Release check for %: % (%)', s.sample_code, x->>'title', x->>'detail'; END IF;
        IF x->>'level' = 'Warning' AND COALESCE(btrim(x->>'ack'), '') = '' THEN
            RAISE EXCEPTION 'Release check for %: give a reason to release despite "%"', s.sample_code, x->>'title';
        END IF;
    END LOOP;

    -- the content must be this record: these results, this version, these tests still in the lab
    SELECT array_agg(DISTINCT r ORDER BY r) INTO v_ids FROM unnest(p_tests) AS q(t), unnest(test_final_result_ids(q.t)) AS r;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(v_ids, '{}')) r WHERE NOT (p_content->'result_ids') ? r::text) THEN
        RAISE EXCEPTION 'The COA of % was built before a result changed: open it again', s.sample_code;
    END IF;
    SELECT count(*) INTO v_pending FROM requested_test r WHERE r.sample_id = p_sample AND r.status <> 'Cancelled' AND NOT r.id = ANY (p_tests)
       AND NOT test_is_finalized(r.id);
    IF (p_content->>'pending_count')::int IS DISTINCT FROM v_pending THEN
        RAISE EXCEPTION 'The COA of % was built before its tests changed: open it again', s.sample_code;
    END IF;

    PERFORM set_reports_internal(true);
    SELECT * INTO v_coa FROM coa WHERE sample_id = p_sample;
    v_ver := NULL;
    IF v_pending = 0 OR cl.allow_partial_reports OR cardinality(p_tests) = 0 THEN
        IF v_coa.id IS NULL THEN
            INSERT INTO coa (sample_id, coa_code, site_id) VALUES (p_sample, 'COA-' || COALESCE(s.sample_code, s.id::text), o.site_id) RETURNING * INTO v_coa;
        END IF;
        SELECT * INTO v_prev FROM coa_version WHERE coa_id = v_coa.id ORDER BY version_no DESC LIMIT 1;
        v_no := COALESCE(v_prev.version_no, 0) + 1;
        IF (p_content->>'version_no')::int IS DISTINCT FROM v_no OR (p_content->>'coa_code') IS DISTINCT FROM v_coa.coa_code THEN
            RAISE EXCEPTION 'The COA of % was built as another version: open it again', s.sample_code;
        END IF;
        SELECT * INTO d FROM document_file WHERE id = p_doc;
        IF d.id IS NULL OR d.mime_type <> 'application/pdf' OR encode(sha256(d.content), 'hex') <> p_sha THEN
            RAISE EXCEPTION 'The COA of % is not the stored PDF it claims to be', s.sample_code;
        END IF;
        v_code := (p_content->>'verify_code');
        IF v_code IS NULL OR v_code !~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' THEN RAISE EXCEPTION 'The COA has no verification code'; END IF;
        INSERT INTO coa_version (coa_id, version_no, is_final, content, document_id, sha256, prev_sha256, verify_code, release_checks, internal_note, group_code,
                                 issued_by, signature_id)
        VALUES (v_coa.id, v_no, v_pending = 0, p_content, p_doc, p_sha, v_prev.sha256, v_code, COALESCE(p_checks, '[]'), NULLIF(btrim(p_internal_note), ''), p_group,
                current_app_user(), v_sig) RETURNING id INTO v_ver;
    END IF;
    FOREACH v_rt IN ARRAY p_tests LOOP
        INSERT INTO result_finalization (requested_test_id, result_ids, coa_version_id, group_code, finalized_by, signature_id)
        VALUES (v_rt, test_final_result_ids(v_rt), v_ver, p_group, current_app_user(), v_sig);
    END LOOP;
    PERFORM set_reports_internal(false);

    -- the client is sent the COA (Outbox): the order's report recipients, or the ordering contact
    IF v_ver IS NOT NULL THEN
        FOR ct IN SELECT DISTINCT c2.email, c2.first_name, c2.last_name FROM client_contact cc JOIN contact c2 ON c2.id = cc.contact_id
                   WHERE cc.client_id = o.client_id AND cc.status = 'Active' AND c2.status = 'Active' AND 'REPORT' = ANY (cc.roles)
                  UNION SELECT c3.email, c3.first_name, c3.last_name FROM contact c3 WHERE c3.id = o.ordering_contact_id
                    AND NOT EXISTS (SELECT 1 FROM client_contact cc WHERE cc.client_id = o.client_id AND cc.status = 'Active' AND 'REPORT' = ANY (cc.roles)) LOOP
            PERFORM queue_email('COA Issued', ct.email, ct.first_name || ' ' || ct.last_name, jsonb_build_object(
                'first_name', ct.first_name, 'client_sample_id', COALESCE(s.client_sample_id, s.sample_code), 'sample_code', s.sample_code,
                'coa_code', v_coa.coa_code, 'version_no', v_no, 'order_code', o.order_code,
                'status_line', CASE WHEN v_pending = 0 THEN 'All testing on this sample is complete.'
                                    ELSE v_pending || ' test' || CASE WHEN v_pending > 1 THEN 's are' ELSE ' is' END || ' still in progress; you will receive the next version when they are finalized.' END,
                'verify_url', COALESCE(p_content->>'verify_url', ''), 'verify_code', v_code, 'site_name', si.site_name, 'staff_name', u.full_name), o.id, v_ver);
        END LOOP;
    END IF;
    PERFORM refresh_order_reported(o.id);
    RETURN v_ver;
END $$;

-- The order is Reported once every logged sample has a final COA that covers its current results
CREATE FUNCTION sample_fully_reported(p_sample uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM coa c JOIN coa_version v ON v.coa_id = c.id WHERE c.sample_id = p_sample AND v.is_final)
       AND NOT EXISTS (SELECT 1 FROM requested_test r WHERE r.sample_id = p_sample AND r.status <> 'Cancelled' AND NOT test_is_finalized(r.id))
$$;
CREATE FUNCTION refresh_order_reported(p_order uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o lab_order; gs text;
BEGIN
    SELECT * INTO o FROM lab_order WHERE id = p_order;
    IF o.status = 'Reported' OR o.status <> 'Approved' THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM sample s WHERE s.lab_order_id = o.id AND s.status <> 'Cancelled' AND NOT sample_fully_reported(s.id)) THEN RETURN; END IF;
    gs := COALESCE(current_setting('lims.group_sync', true), '');
    PERFORM set_config('lims.group_sync', '1', true);
    PERFORM ensure_reason('Every sample''s final COA is issued');
    UPDATE lab_order SET status = 'Reported' WHERE id = o.id;
    PERFORM set_config('lims.group_sync', gs, true);
END $$;

-- What anyone holding a COA can check (no sign-in): the lab, the COA number and version, when it was issued, its
-- fingerprint, and whether a later version replaces it. Nothing about the client or the results.
CREATE FUNCTION coa_public_check(p_code text) RETURNS TABLE (site_name text, coa_code text, version_no integer, issued_at timestamptz, sha256 text,
                                                            is_final boolean, latest_version integer) LANGUAGE sql STABLE AS $$
    SELECT si.site_name, c.coa_code, v.version_no, v.issued_at, v.sha256, v.is_final,
           (SELECT max(v2.version_no) FROM coa_version v2 WHERE v2.coa_id = c.id)
      FROM coa_version v JOIN coa c ON c.id = v.coa_id JOIN lab_site si ON si.id = c.site_id WHERE v.verify_code = upper(btrim(p_code))
$$;

-------------------------------------------------------------------------------
-- 7. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_r1;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_s uuid; v_code text;
BEGIN
    IF p_table = 'coa' THEN
        RETURN jsonb_build_object('label', 'COA ' || (r->>'coa_code'), 'link', '#/samples/' || (r->>'sample_id'));
    ELSIF p_table = 'coa_version' THEN
        SELECT c.sample_id, c.coa_code INTO v_s, v_code FROM coa c WHERE c.id = (r->>'coa_id')::uuid;
        RETURN jsonb_build_object('label', 'COA ' || v_code || ' version ' || (r->>'version_no'), 'link', '#/samples/' || v_s);
    ELSIF p_table = 'result_finalization' THEN
        SELECT rt.sample_id, t.test_name INTO v_s, v_code FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.id = (r->>'requested_test_id')::uuid;
        RETURN jsonb_build_object('label', 'Finalization of ' || v_code || ' (' || (r->>'group_code') || ')', 'link', '#/samples/' || v_s);
    ELSIF p_table = 'coa_note' THEN
        RETURN jsonb_build_object('label', CASE WHEN r->>'kind' = 'Internal' THEN 'Internal note' ELSE 'COA note' END || ' on ' ||
            COALESCE((SELECT sample_code FROM sample WHERE id = (r->>'sample_id')::uuid), 'a sample'), 'link', '#/samples/' || (r->>'sample_id'));
    ELSIF p_table = 'sample_attachment' THEN
        RETURN jsonb_build_object('label', 'Attachment (' || (r->>'kind') || ')', 'link', CASE WHEN r->>'sample_id' IS NOT NULL THEN '#/samples/' || (r->>'sample_id') ELSE '#/orders/' || (r->>'lab_order_id') END);
    ELSIF p_table = 'compliance_category' THEN
        RETURN jsonb_build_object('label', 'Compliance category ' || (r->>'category_name'), 'link', '#/admin/matrices');
    ELSIF p_table = 'email_template' THEN
        RETURN jsonb_build_object('label', 'Email template ' || (r->>'template_name'), 'link', '#/outbox?tab=templates');
    END IF;
    RETURN audit_record_ref_r1(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
