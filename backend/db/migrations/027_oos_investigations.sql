-- LIMS3 schema, migration 027: R-2, OOS investigations and retests. Built by Claude in the cloud, 2026-10-14.
-- Alex's decisions (vault: Decision - OOS Investigations Use a Procedure Matched to the Work, Decision - An OOS Result
-- Holds Only Itself, Decision - Client OOS Retests Are Re-preps Billed by QA Determination, Decision - Result
-- Finalization and the Certificate of Analysis): an OOS record is NOT opened automatically; QC Review flags the result
-- and has a button to open it (data or sample details may need fixing first). Full Phase I (21 CFR 211) for GMP work,
-- Check and Acknowledge otherwise (the lab's default); automatic data checks for both; the OOS result alone is held;
-- the client is emailed on release, not detection, and asked whether they want Phase II re-testing; client retests are
-- re-preps from the retained sample, billed by QA's determination; a retest's result replaces the original on the next
-- COA version, which does not say it is a retest.
--  - oos_investigation (OOS-000001): the result, the procedure, the automatic checks, the signed sections (Phase I:
--    analyst, supervisor, QA conclusion; Check and Acknowledge: one reviewer), the conclusion, the signed report (PDF).
--  - OOS checklists and close-within days per procedure are configuration kept by QA (oos.configure).
--  - Conclusion "Assignable cause found": the result is invalidated (kept, Superseded) when the lab orders its
--    non-billable lab investigation retest (re-prep). "OOS confirmed": the result is released as out of specification.
--  - The client's answers come back through a link (no sign-in) and wait on the OOS record for the lab to act on.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 027: OOS investigations and retests', true);

-------------------------------------------------------------------------------
-- 0. PERMISSIONS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('oos.open', 'Testing', 'OOS investigations', 'Open an OOS investigation and record its analyst section', false, 93),
 ('oos.approve', 'Testing', 'OOS approval (QA)', 'Conclude a Full Phase I OOS investigation, record the retest determination, cancel an investigation', false, 94),
 ('oos.configure', 'Master data', 'OOS checklists', 'Keep the OOS checklists and target times', false, 27);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('Analyst', '{oos.open}'), ('Lab Supervisor', '{oos.open}'), ('QA', '{oos.open,oos.approve,oos.configure}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

CREATE FUNCTION oos_internal() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('lims.oos_internal', true), '') = '1' $$;
CREATE FUNCTION set_oos_internal(p_on boolean) RETURNS text LANGUAGE sql AS $$ SELECT set_config('lims.oos_internal', CASE WHEN p_on THEN '1' ELSE '' END, true) $$;
CREATE FUNCTION oos_tables_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF oos_internal() THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Use the OOS investigation page (OOS records change only through its signed steps)';
END $$;

-------------------------------------------------------------------------------
-- 1. CONFIGURATION: target times and checklists per procedure (QA)
-------------------------------------------------------------------------------
CREATE TABLE oos_procedure_setting (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    procedure          oos_procedure NOT NULL UNIQUE,
    close_within_days  integer NOT NULL CHECK (close_within_days > 0),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('oos_procedure_setting');
INSERT INTO oos_procedure_setting (procedure, close_within_days) VALUES ('Full Phase I (21 CFR 211)', 30), ('Check and Acknowledge', 10);

CREATE TABLE oos_checklist_item (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    procedure       oos_procedure NOT NULL,
    section         text NOT NULL CHECK (section IN ('Analyst','Supervisor','Reviewer')),
    item_text       text NOT NULL CHECK (btrim(item_text) <> ''),
    sort_order      integer NOT NULL DEFAULT 100,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CHECK ((procedure = 'Full Phase I (21 CFR 211)' AND section IN ('Analyst','Supervisor')) OR (procedure = 'Check and Acknowledge' AND section = 'Reviewer'))
);
CALL make_gxp('oos_checklist_item');
-- The vault's items (OOS Investigation business object); the wording belongs to QA's OOS SOP and is edited by QA
INSERT INTO oos_checklist_item (procedure, section, item_text, sort_order) VALUES
 ('Full Phase I (21 CFR 211)', 'Analyst', 'The test solutions, preparations and raw data were kept (nothing discarded) until the investigation is closed.', 10),
 ('Full Phase I (21 CFR 211)', 'Analyst', 'The method (SOP and test version) was followed as written.', 20),
 ('Full Phase I (21 CFR 211)', 'Analyst', 'The raw data (chromatograms, spectra, plate counts) were reviewed and show nothing unusual.', 30),
 ('Full Phase I (21 CFR 211)', 'Analyst', 'Nothing unusual was seen during preparation (weighing, dilution, digestion, extraction).', 40),
 ('Full Phase I (21 CFR 211)', 'Analyst', 'The calculation and every transcription were checked against the raw data.', 50),
 ('Full Phase I (21 CFR 211)', 'Analyst', 'The standards, reagents and media used were in date, released and correctly prepared.', 60),
 ('Full Phase I (21 CFR 211)', 'Analyst', 'The instruments used were calibrated, in service and performing to specification.', 70),
 ('Full Phase I (21 CFR 211)', 'Supervisor', 'The result and the investigation were discussed with the analyst.', 10),
 ('Full Phase I (21 CFR 211)', 'Supervisor', 'The method''s performance (system suitability, QC, historical data) was reviewed and was in control.', 20),
 ('Full Phase I (21 CFR 211)', 'Supervisor', 'The automatic data checks were reviewed; any failure is explained.', 30),
 ('Full Phase I (21 CFR 211)', 'Supervisor', 'Any hypothesis test (re-analysis of the same preparation) was planned before it was done, and every result is kept.', 40),
 ('Check and Acknowledge', 'Reviewer', 'The calculation and every transcription were checked against the raw data.', 10),
 ('Check and Acknowledge', 'Reviewer', 'The batch QC passed (or its failures were accepted with a justification).', 20),
 ('Check and Acknowledge', 'Reviewer', 'The standards, reagents, media and instruments used were in date and in service.', 30),
 ('Check and Acknowledge', 'Reviewer', 'The sample details (identity, condition, specification) were checked.', 40);
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON oos_procedure_setting FOR EACH ROW EXECUTE FUNCTION require_list_permission('oos.configure');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON oos_checklist_item FOR EACH ROW EXECUTE FUNCTION require_list_permission('oos.configure');

-------------------------------------------------------------------------------
-- 2. THE INVESTIGATION
-------------------------------------------------------------------------------
CREATE SEQUENCE oos_code_seq;
CREATE TABLE oos_investigation (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    oos_code              text NOT NULL UNIQUE DEFAULT 'OOS-' || lpad(nextval('oos_code_seq')::text, 6, '0'),
    site_id               uuid NOT NULL REFERENCES lab_site(id),
    sample_id             uuid NOT NULL REFERENCES sample(id),
    requested_test_id     uuid NOT NULL REFERENCES requested_test(id),
    analyte_id            uuid NOT NULL REFERENCES analyte(id),
    batch_id              uuid REFERENCES test_batch(id),
    test_result_id        uuid REFERENCES test_result(id),     -- the stored (approved) result investigated
    procedure             oos_procedure NOT NULL,
    is_gmp                boolean NOT NULL,
    reported              text,
    value_num             numeric,
    unit                  text,
    spec_text             text,
    opened_reason         text,
    status                text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Analyst signed','Supervisor signed','Closed','Cancelled')),
    opened_by             uuid NOT NULL REFERENCES app_user(id),
    opened_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
    open_signature_id     uuid REFERENCES signature_event(id),
    due_date              date,
    auto_checks           jsonb NOT NULL DEFAULT '[]',
    auto_checked_at       timestamptz,
    analyst_answers       jsonb, analyst_comment text, hypothesis text,
    analyst_by            uuid REFERENCES app_user(id), analyst_at timestamptz, analyst_signature_id uuid REFERENCES signature_event(id),
    supervisor_answers    jsonb, supervisor_comment text,
    supervisor_by         uuid REFERENCES app_user(id), supervisor_at timestamptz, supervisor_signature_id uuid REFERENCES signature_event(id),
    reviewer_answers      jsonb,
    conclusion            text CHECK (conclusion IN ('OOS confirmed','Assignable cause found')),
    assignable_cause      text,
    conclusion_comment    text,
    concluded_by          uuid REFERENCES app_user(id), concluded_at timestamptz, conclusion_signature_id uuid REFERENCES signature_event(id),
    report_document_id    uuid REFERENCES document_file(id),
    report_sha256         text,
    client_token          text UNIQUE,
    client_notified_at    timestamptz,
    retest_determination  text CHECK (retest_determination IN ('Confirmed OOS','Lab error','Inconclusive')),
    determination_reason  text,
    determined_by         uuid REFERENCES app_user(id), determined_at timestamptz, determination_signature_id uuid REFERENCES signature_event(id),
    cancelled_reason      text, cancelled_by uuid REFERENCES app_user(id), cancelled_at timestamptz,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX oos_rt_idx ON oos_investigation (requested_test_id, analyte_id);
CALL make_gxp('oos_investigation', false);
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON oos_investigation FOR EACH ROW EXECUTE FUNCTION oos_tables_rules();

CREATE TABLE oos_client_response (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    oos_id                    uuid NOT NULL REFERENCES oos_investigation(id),
    choice                    text NOT NULL CHECK (choice IN ('Retest','Retest in duplicate','Test a new sample','Hold the retained sample','Return the retained sample','Call with QA','Acknowledge')),
    note                      text,
    contact_name              text,
    received_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
    handled_by                uuid REFERENCES app_user(id),
    handled_at                timestamptz,
    handled_note              text,
    retest_requested_test_id  uuid REFERENCES requested_test(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('oos_client_response', false);
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON oos_client_response FOR EACH ROW EXECUTE FUNCTION oos_tables_rules();

-- Retests: a requested test that repeats another (re-prep from the retained sample)
ALTER TABLE requested_test ADD COLUMN retest_of_id uuid REFERENCES requested_test(id);
ALTER TABLE requested_test ADD COLUMN oos_investigation_id uuid REFERENCES oos_investigation(id);
ALTER TABLE requested_test ADD COLUMN billing_status text CHECK (billing_status IN ('Pending QA determination','Billable','Non-billable'));
ALTER TABLE requested_test ADD COLUMN retest_replicates integer CHECK (retest_replicates BETWEEN 1 AND 3);
DROP INDEX requested_test_one_active;
CREATE UNIQUE INDEX requested_test_one_active ON requested_test (sample_id, test_id) WHERE status <> 'Cancelled' AND retest_of_id IS NULL;
-- a non-billable retest costs nothing (after the price is worked out from the quote)
CREATE FUNCTION requested_test_billing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.billing_status = 'Non-billable' THEN NEW.price := 0; NEW.rush_fee := 0; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.retest_of_id IS DISTINCT FROM OLD.retest_of_id OR NEW.oos_investigation_id IS DISTINCT FROM OLD.oos_investigation_id) THEN
        RAISE EXCEPTION 'A retest stays linked to the test and investigation it repeats';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.billing_status IS DISTINCT FROM OLD.billing_status AND NOT oos_internal() THEN
        RAISE EXCEPTION 'A retest''s billing follows QA''s determination (OOS investigation page)';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER b_requested_test_billing BEFORE INSERT OR UPDATE ON requested_test FOR EACH ROW EXECUTE FUNCTION requested_test_billing();
CREATE FUNCTION test_is_replaced(p_rt uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM requested_test r2 WHERE r2.retest_of_id = p_rt AND r2.status <> 'Cancelled')
$$;

-- An invalidated result is kept, Superseded, with the investigation that invalidated it
ALTER TABLE test_result ADD COLUMN invalidated_oos_id uuid REFERENCES oos_investigation(id);
-- email attachments other than a COA (the signed Phase I report)
ALTER TABLE email_outbox ADD COLUMN document_id uuid REFERENCES document_file(id);
CREATE OR REPLACE FUNCTION queue_email(p_code text, p_to text, p_to_name text, p_vars jsonb, p_order uuid, p_coa_version uuid DEFAULT NULL, p_document uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE t email_template; v uuid;
BEGIN
    SELECT * INTO t FROM email_template WHERE template_code = p_code;
    IF t.id IS NULL THEN RAISE EXCEPTION 'No email template "%"', p_code; END IF;
    IF NOT t.is_active THEN RETURN NULL; END IF;
    INSERT INTO email_outbox (template, to_address, to_name, subject, body, lab_order_id, coa_version_id, document_id)
    VALUES (p_code, p_to, p_to_name, fill_template(t.subject, p_vars), fill_template(t.body, p_vars), p_order, p_coa_version, p_document) RETURNING id INTO v;
    RETURN v;
END $$;
DROP FUNCTION queue_email(text, text, text, jsonb, uuid, uuid);

-------------------------------------------------------------------------------
-- 3. THE STEPS OF AN INVESTIGATION
-------------------------------------------------------------------------------
CREATE FUNCTION oos_get(p_id uuid) RETURNS oos_investigation LANGUAGE plpgsql AS $$
DECLARE o oos_investigation;
BEGIN
    SELECT * INTO o FROM oos_investigation WHERE id = p_id FOR UPDATE;
    IF o.id IS NULL THEN RAISE EXCEPTION 'OOS investigation not found'; END IF;
    RETURN o;
END $$;
-- every active checklist item of the section answered Yes, No or N/A
CREATE FUNCTION oos_assert_answers(o oos_investigation, p_section text, p_answers jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i record; a text; n integer := 0;
BEGIN
    FOR i IN SELECT * FROM oos_checklist_item WHERE procedure = o.procedure AND section = p_section AND status = 'Active' ORDER BY sort_order LOOP
        a := COALESCE(p_answers->(i.id::text)->>'answer', '');
        IF a NOT IN ('Yes','No','N/A') THEN RAISE EXCEPTION 'Answer every item of the % section (Yes, No or N/A): "%"', lower(p_section), i.item_text; END IF;
        IF a = 'No' AND COALESCE(btrim(p_answers->(i.id::text)->>'comment'), '') = '' THEN
            RAISE EXCEPTION 'Explain the "No" for: "%"', i.item_text;
        END IF;
        n := n + 1;
    END LOOP;
END $$;

-- Open: from QC Review (the batch's reading, before approval) or from the stored result (after approval). Signed.
CREATE FUNCTION open_oos(p_rt uuid, p_analyte uuid, p_batch uuid, p_reason text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE rt requested_test; s sample; o lab_order; tr test_result; it record; v_id uuid; v_proc oos_procedure; v_days integer; x oos_investigation;
        v_rep text; v_val numeric; v_unit text; v_spec text; v_batch uuid := p_batch; v_res uuid;
BEGIN
    SELECT * INTO rt FROM requested_test WHERE id = p_rt;
    IF rt.id IS NULL THEN RAISE EXCEPTION 'Test not found'; END IF;
    SELECT * INTO s FROM sample WHERE id = rt.sample_id;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    PERFORM require_permission_at('oos.open', o.site_id);
    PERFORM assert_signed('open an OOS investigation');
    SELECT * INTO x FROM oos_investigation WHERE requested_test_id = p_rt AND analyte_id = p_analyte AND status NOT IN ('Closed','Cancelled') LIMIT 1;
    IF x.id IS NOT NULL THEN RAISE EXCEPTION '% is already open for this result', x.oos_code; END IF;
    SELECT * INTO tr FROM test_result WHERE requested_test_id = p_rt AND analyte_id = p_analyte AND result_key IS NULL AND status = 'Active' AND stage = 'Final';
    IF tr.id IS NOT NULL THEN
        IF tr.conformance <> 'Does not conform' THEN RAISE EXCEPTION 'The approved result conforms to its specification: there is nothing to investigate'; END IF;
        IF EXISTS (SELECT 1 FROM oos_investigation WHERE test_result_id = tr.id AND status = 'Closed') THEN
            RAISE EXCEPTION 'This result was already investigated (%)', (SELECT oos_code FROM oos_investigation WHERE test_result_id = tr.id AND status = 'Closed' LIMIT 1);
        END IF;
        v_res := tr.id; v_batch := tr.batch_id; v_rep := tr.reported; v_val := tr.value_num; v_unit := tr.unit;
        v_spec := COALESCE(tr.spec_text, concat_ws(' and ', '≥ ' || tr.spec_min::text, '≤ ' || tr.spec_max::text) || COALESCE(' ' || tr.spec_unit, ''));
    ELSE
        IF p_batch IS NULL THEN RAISE EXCEPTION 'Open the investigation from the batch''s QC Review (the result is not approved yet)'; END IF;
        SELECT * INTO it FROM batch_review_items(p_batch) i WHERE i.requested_test_id = p_rt AND i.analyte_id = p_analyte LIMIT 1;
        IF it.requested_test_id IS NULL THEN RAISE EXCEPTION 'That result is not in batch %', (SELECT batch_code FROM test_batch WHERE id = p_batch); END IF;
        IF COALESCE(it.conformance, '') <> 'Does not conform' THEN RAISE EXCEPTION 'The chosen reading conforms to its specification: there is nothing to investigate'; END IF;
        v_rep := it.reported; v_val := it.value; v_unit := it.unit;
        v_spec := COALESCE(it.spec_text, concat_ws(' and ', '≥ ' || it.spec_min::text, '≤ ' || it.spec_max::text) || COALESCE(' ' || it.spec_unit, ''));
    END IF;
    v_proc := CASE WHEN sample_is_gmp(s.id) THEN 'Full Phase I (21 CFR 211)' ELSE (SELECT default_oos_procedure FROM lab_site WHERE id = o.site_id) END;
    SELECT close_within_days INTO v_days FROM oos_procedure_setting WHERE procedure = v_proc;
    PERFORM ensure_reason('OOS investigation opened');
    PERFORM set_oos_internal(true);
    INSERT INTO oos_investigation (site_id, sample_id, requested_test_id, analyte_id, batch_id, test_result_id, procedure, is_gmp, reported, value_num, unit, spec_text,
                                   opened_reason, opened_by, open_signature_id, due_date)
    VALUES (o.site_id, s.id, p_rt, p_analyte, v_batch, v_res, v_proc, sample_is_gmp(s.id), v_rep, v_val, v_unit, v_spec, NULLIF(btrim(p_reason), ''), current_app_user(),
            NULLIF(current_setting('lims.signature_id', true), '')::uuid, site_today(o.site_id) + COALESCE(v_days, 30))
    RETURNING id INTO v_id;
    PERFORM set_oos_internal(false);
    RETURN v_id;
END $$;

-- The automatic data checks (worked out by the server from the record), kept on the investigation; re-run until closed
CREATE FUNCTION record_oos_checks(p_id uuid, p_checks jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o oos_investigation := oos_get(p_id);
BEGIN
    IF NOT (has_permission_at('oos.open', o.site_id) OR has_permission_at('testing.review', o.site_id)) THEN PERFORM require_permission_at('oos.open', o.site_id); END IF;
    IF o.status IN ('Closed','Cancelled') THEN RAISE EXCEPTION '% is %: its checks are kept as they were', o.oos_code, lower(o.status); END IF;
    PERFORM ensure_reason('Automatic data checks run');
    PERFORM set_oos_internal(true);
    UPDATE oos_investigation SET auto_checks = COALESCE(p_checks, '[]'), auto_checked_at = clock_timestamp() WHERE id = p_id;
    PERFORM set_oos_internal(false);
END $$;

-- Full Phase I: the analyst section (bench rights at the lab), signed
CREATE FUNCTION sign_oos_analyst(p_id uuid, p_answers jsonb, p_comment text, p_hypothesis text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o oos_investigation := oos_get(p_id);
BEGIN
    IF o.procedure <> 'Full Phase I (21 CFR 211)' THEN RAISE EXCEPTION '% follows Check and Acknowledge: one reviewer concludes it', o.oos_code; END IF;
    IF o.status <> 'Open' THEN RAISE EXCEPTION '% is %: the analyst section is already signed', o.oos_code, lower(o.status); END IF;
    PERFORM require_permission_at('testing.perform', o.site_id);
    PERFORM assert_signed('sign the analyst section of an OOS investigation');
    PERFORM oos_assert_answers(o, 'Analyst', p_answers);
    PERFORM ensure_reason('OOS investigation: analyst section signed');
    PERFORM set_oos_internal(true);
    UPDATE oos_investigation SET analyst_answers = p_answers, analyst_comment = NULLIF(btrim(p_comment), ''), hypothesis = NULLIF(btrim(p_hypothesis), ''),
           analyst_by = current_app_user(), analyst_at = clock_timestamp(), analyst_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid,
           status = 'Analyst signed' WHERE id = p_id;
    PERFORM set_oos_internal(false);
END $$;

-- Full Phase I: the supervisor section (review rights, not the analyst), signed
CREATE FUNCTION sign_oos_supervisor(p_id uuid, p_answers jsonb, p_comment text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o oos_investigation := oos_get(p_id);
BEGIN
    IF o.procedure <> 'Full Phase I (21 CFR 211)' THEN RAISE EXCEPTION '% follows Check and Acknowledge: one reviewer concludes it', o.oos_code; END IF;
    IF o.status <> 'Analyst signed' THEN RAISE EXCEPTION '% is %: the supervisor section follows the analyst''s', o.oos_code, lower(o.status); END IF;
    IF o.analyst_by = current_app_user() THEN RAISE EXCEPTION 'You signed the analyst section: a supervisor signs this one'; END IF;
    IF o.batch_id IS NOT NULL AND EXISTS (SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = o.batch_id AND ws.step_type <> 'QC Review'
                AND current_app_user() IN (r.performed_by, r.witness_id)) THEN
        RAISE EXCEPTION 'You performed or witnessed a step of the batch: a supervisor independent of the bench work signs this section';
    END IF;
    PERFORM require_permission_at('testing.review', o.site_id);
    PERFORM assert_signed('sign the supervisor section of an OOS investigation');
    PERFORM oos_assert_answers(o, 'Supervisor', p_answers);
    PERFORM ensure_reason('OOS investigation: supervisor section signed');
    PERFORM set_oos_internal(true);
    UPDATE oos_investigation SET supervisor_answers = p_answers, supervisor_comment = NULLIF(btrim(p_comment), ''),
           supervisor_by = current_app_user(), supervisor_at = clock_timestamp(), supervisor_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid,
           status = 'Supervisor signed' WHERE id = p_id;
    PERFORM set_oos_internal(false);
END $$;

-- The conclusion (signed, with the report PDF made by the server). Full Phase I: QA (oos.approve), after the
-- supervisor, never someone who signed a section. Check and Acknowledge: one reviewer (QC Review rights or QA) answers
-- the checklist and concludes. The batch must be approved: the conclusion is about the stored result.
CREATE FUNCTION conclude_oos(p_id uuid, p_conclusion text, p_cause text, p_comment text, p_answers jsonb, p_doc uuid, p_sha text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o oos_investigation := oos_get(p_id); tr test_result; d document_file;
BEGIN
    IF o.status IN ('Closed','Cancelled') THEN RAISE EXCEPTION '% is already %', o.oos_code, lower(o.status); END IF;
    IF o.procedure = 'Full Phase I (21 CFR 211)' THEN
        IF o.status <> 'Supervisor signed' THEN RAISE EXCEPTION '% needs the analyst and supervisor sections signed first', o.oos_code; END IF;
        IF current_app_user() IN (o.analyst_by, o.supervisor_by) THEN RAISE EXCEPTION 'You signed a section of %: QA concludes it independently', o.oos_code; END IF;
        PERFORM require_permission_at('oos.approve', o.site_id);
    ELSE
        IF NOT (has_permission_at('testing.review', o.site_id) OR has_permission_at('oos.approve', o.site_id)) THEN PERFORM require_permission_at('testing.review', o.site_id); END IF;
        PERFORM oos_assert_answers(o, 'Reviewer', p_answers);
    END IF;
    -- independent of the bench work, as in QC Review
    IF o.batch_id IS NOT NULL AND EXISTS (SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = o.batch_id AND ws.step_type <> 'QC Review'
                AND current_app_user() IN (r.performed_by, r.witness_id)) THEN
        RAISE EXCEPTION 'You performed or witnessed a step of the batch: someone else concludes %', o.oos_code;
    END IF;
    PERFORM assert_signed('conclude an OOS investigation');
    IF p_conclusion NOT IN ('OOS confirmed','Assignable cause found') THEN RAISE EXCEPTION 'Conclude with "OOS confirmed" or "Assignable cause found"'; END IF;
    IF p_conclusion = 'Assignable cause found' AND COALESCE(btrim(p_cause), '') = '' THEN RAISE EXCEPTION 'Describe the assignable cause (the documented laboratory error)'; END IF;
    IF COALESCE(btrim(p_comment), '') = '' THEN RAISE EXCEPTION 'Write the conclusion''s justification'; END IF;
    SELECT * INTO tr FROM test_result WHERE requested_test_id = o.requested_test_id AND analyte_id = o.analyte_id AND result_key IS NULL AND status = 'Active' AND stage = 'Final';
    IF tr.id IS NULL THEN RAISE EXCEPTION 'Approve the batch in QC Review first: the conclusion is about the approved result'; END IF;
    IF p_conclusion = 'OOS confirmed' AND tr.conformance <> 'Does not conform' THEN
        RAISE EXCEPTION 'The approved result (%) conforms: it cannot be confirmed out of specification', tr.reported;
    END IF;
    SELECT * INTO d FROM document_file WHERE id = p_doc;
    IF d.id IS NULL OR d.mime_type <> 'application/pdf' OR encode(sha256(d.content), 'hex') <> p_sha THEN RAISE EXCEPTION 'The investigation report is not the stored PDF it claims to be'; END IF;
    PERFORM ensure_reason('OOS investigation concluded');
    PERFORM set_oos_internal(true);
    UPDATE oos_investigation SET conclusion = p_conclusion, assignable_cause = NULLIF(btrim(p_cause), ''), conclusion_comment = btrim(p_comment),
           reviewer_answers = CASE WHEN procedure = 'Check and Acknowledge' THEN p_answers ELSE reviewer_answers END,
           test_result_id = tr.id, reported = tr.reported, value_num = tr.value_num, unit = tr.unit,
           concluded_by = current_app_user(), concluded_at = clock_timestamp(), conclusion_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid,
           report_document_id = p_doc, report_sha256 = p_sha, status = 'Closed' WHERE id = p_id;
    PERFORM set_oos_internal(false);
END $$;

-- Cancel an investigation opened in error (e.g. the sample details or data entry were wrong and are corrected), signed
CREATE FUNCTION cancel_oos(p_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o oos_investigation := oos_get(p_id);
BEGIN
    IF o.status IN ('Closed','Cancelled') THEN RAISE EXCEPTION '% is already %', o.oos_code, lower(o.status); END IF;
    IF NOT (has_permission_at('oos.approve', o.site_id) OR (o.opened_by = current_app_user() AND has_permission_at('oos.open', o.site_id))) THEN
        RAISE EXCEPTION 'Only QA (oos.approve) or whoever opened % can cancel it', o.oos_code;
    END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say why % is cancelled', o.oos_code; END IF;
    PERFORM assert_signed('cancel an OOS investigation');
    PERFORM ensure_reason(p_reason);
    PERFORM set_oos_internal(true);
    UPDATE oos_investigation SET status = 'Cancelled', cancelled_reason = btrim(p_reason), cancelled_by = current_app_user(), cancelled_at = clock_timestamp() WHERE id = p_id;
    PERFORM set_oos_internal(false);
END $$;

-- Order a retest (re-prep from the retained sample), signed. Lab investigation retest: after "Assignable cause found",
-- non-billable; the original results are invalidated (kept, Superseded). Client retest: after the confirmed OOS was
-- released to the client; billed by QA's later determination.
CREATE FUNCTION order_oos_retest(p_id uuid, p_kind text, p_replicates integer DEFAULT 1, p_response uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o oos_investigation := oos_get(p_id); rt requested_test; s sample; v_new uuid; ord lab_order; gs text;
BEGIN
    SELECT * INTO rt FROM requested_test WHERE id = o.requested_test_id;
    SELECT * INTO s FROM sample WHERE id = rt.sample_id;
    SELECT * INTO ord FROM lab_order WHERE id = s.lab_order_id;
    PERFORM require_permission_at('orders.edit', o.site_id);
    PERFORM assert_signed('order an OOS retest');
    IF o.status <> 'Closed' THEN RAISE EXCEPTION '% is not concluded yet', o.oos_code; END IF;
    IF COALESCE(p_replicates, 1) NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'A retest is single, duplicate or triplicate'; END IF;
    IF s.retained_quantity IS NOT NULL AND s.retained_quantity <= 0 THEN RAISE EXCEPTION 'No retained sample is left for %: a retest needs a new sample', s.sample_code; END IF;
    IF test_is_replaced(rt.id) THEN RAISE EXCEPTION 'A retest of this test is already ordered'; END IF;
    IF p_kind = 'Lab investigation' THEN
        IF o.conclusion <> 'Assignable cause found' THEN RAISE EXCEPTION 'A lab investigation retest follows an assignable cause; % confirmed the OOS', o.oos_code; END IF;
    ELSIF p_kind = 'Client' THEN
        IF o.conclusion <> 'OOS confirmed' THEN RAISE EXCEPTION 'A client retest follows a confirmed OOS'; END IF;
        IF o.client_notified_at IS NULL THEN RAISE EXCEPTION 'The client has not been told of the OOS yet (it is told when the result is released on the COA)'; END IF;
    ELSE RAISE EXCEPTION 'Order a "Lab investigation" or a "Client" retest';
    END IF;
    PERFORM ensure_reason(CASE WHEN p_kind = 'Client' THEN 'Client OOS retest ordered' ELSE 'Lab investigation retest ordered' END);
    PERFORM set_oos_internal(true);
    IF p_kind = 'Lab investigation' THEN
        PERFORM set_testing_internal(true);
        UPDATE test_result SET status = 'Superseded', invalidated_oos_id = o.id WHERE requested_test_id = rt.id AND status = 'Active';
        PERFORM set_testing_internal(false);
    END IF;
    INSERT INTO requested_test (sample_id, test_id, test_version_id, quoted_line_id, source, special_instructions, retest_of_id, oos_investigation_id, billing_status, retest_replicates)
    VALUES (rt.sample_id, rt.test_id, rt.test_version_id, rt.quoted_line_id,
            CASE WHEN p_kind = 'Client' THEN 'Client OOS Retest' ELSE 'Lab Investigation Retest' END::test_source,
            format('Re-prep from the retained sample (%s), %s', o.oos_code, CASE COALESCE(p_replicates, 1) WHEN 1 THEN 'single' WHEN 2 THEN 'in duplicate' ELSE 'in triplicate' END),
            rt.id, o.id, CASE WHEN p_kind = 'Client' THEN 'Pending QA determination' ELSE 'Non-billable' END, COALESCE(p_replicates, 1))
    RETURNING id INTO v_new;
    -- the same specification as the original test
    INSERT INTO specification (requested_test_id, analyte_id, min_value, max_value, text_value, unit, source)
    SELECT v_new, sp.analyte_id, sp.min_value, sp.max_value, sp.text_value, sp.unit, sp.source FROM specification sp
     WHERE sp.requested_test_id = rt.id AND sp.status = 'Active'
       AND NOT EXISTS (SELECT 1 FROM specification x WHERE x.requested_test_id = v_new AND x.analyte_id = sp.analyte_id AND x.status = 'Active');
    IF p_response IS NOT NULL THEN
        UPDATE oos_client_response SET retest_requested_test_id = v_new, handled_by = current_app_user(), handled_at = clock_timestamp(),
               handled_note = COALESCE(handled_note, 'Retest ordered') WHERE id = p_response AND oos_id = o.id;
    END IF;
    PERFORM set_oos_internal(false);
    -- a reported order has work again
    IF ord.status IN ('Reported','Approved') THEN
        gs := COALESCE(current_setting('lims.group_sync', true), '');
        PERFORM set_config('lims.group_sync', '1', true);
        UPDATE lab_order SET status = 'Received' WHERE id = ord.id;
        PERFORM set_config('lims.group_sync', gs, true);
        PERFORM refresh_order_status(ord.id);
    END IF;
    RETURN v_new;
END $$;

-- QA's determination after the client retest's result is approved: it sets the retest's billing
CREATE FUNCTION record_retest_determination(p_id uuid, p_determination text, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o oos_investigation := oos_get(p_id); r requested_test;
BEGIN
    PERFORM require_permission_at('oos.approve', o.site_id);
    PERFORM assert_signed('record the retest determination');
    SELECT * INTO r FROM requested_test WHERE oos_investigation_id = o.id AND source = 'Client OOS Retest' AND status <> 'Cancelled' LIMIT 1;
    IF r.id IS NULL THEN RAISE EXCEPTION 'No client retest was ordered for %', o.oos_code; END IF;
    IF NOT EXISTS (SELECT 1 FROM test_result WHERE requested_test_id = r.id AND status = 'Active' AND stage = 'Final' AND result_key IS NULL) THEN
        RAISE EXCEPTION 'The retest has no approved result yet: QA determines the cause after QC Review';
    END IF;
    IF o.retest_determination IS NOT NULL THEN RAISE EXCEPTION 'The determination of % is already recorded', o.oos_code; END IF;
    IF p_determination NOT IN ('Confirmed OOS','Lab error','Inconclusive') THEN RAISE EXCEPTION 'Determine Confirmed OOS, Lab error or Inconclusive'; END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give the evidence for the determination'; END IF;
    PERFORM ensure_reason('Retest determination recorded');
    PERFORM set_oos_internal(true);
    UPDATE oos_investigation SET retest_determination = p_determination, determination_reason = btrim(p_reason), determined_by = current_app_user(),
           determined_at = clock_timestamp(), determination_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = o.id;
    UPDATE requested_test SET billing_status = CASE WHEN p_determination = 'Lab error' THEN 'Non-billable' ELSE 'Billable' END WHERE id = r.id;
    PERFORM set_oos_internal(false);
END $$;

-- The client's answer through the link in the OOS email (no sign-in; recorded as the system, with the contact's name)
CREATE FUNCTION record_oos_client_response(p_token text, p_choice text, p_note text, p_name text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE o oos_investigation;
BEGIN
    SELECT * INTO o FROM oos_investigation WHERE client_token = p_token AND client_token IS NOT NULL;
    IF o.id IS NULL OR o.client_notified_at < clock_timestamp() - interval '90 days' THEN RAISE EXCEPTION 'This link is not valid any more: please contact the laboratory'; END IF;
    PERFORM set_config('lims.reason', 'Client response through the OOS link', true);
    PERFORM set_oos_internal(true);
    INSERT INTO oos_client_response (oos_id, choice, note, contact_name) VALUES (o.id, p_choice, NULLIF(btrim(p_note), ''), NULLIF(btrim(p_name), ''));
    PERFORM set_oos_internal(false);
    RETURN o.oos_code;
END $$;
CREATE FUNCTION handle_oos_response(p_response uuid, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r oos_client_response; o oos_investigation;
BEGIN
    SELECT * INTO r FROM oos_client_response WHERE id = p_response;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Response not found'; END IF;
    SELECT * INTO o FROM oos_investigation WHERE id = r.oos_id;
    IF NOT (has_permission_at('orders.edit', o.site_id) OR has_permission_at('oos.open', o.site_id)) THEN PERFORM require_permission_at('orders.edit', o.site_id); END IF;
    IF r.handled_at IS NOT NULL THEN RAISE EXCEPTION 'Already handled'; END IF;
    PERFORM ensure_reason('Client response handled');
    PERFORM set_oos_internal(true);
    UPDATE oos_client_response SET handled_by = current_app_user(), handled_at = clock_timestamp(), handled_note = NULLIF(btrim(p_note), '') WHERE id = p_response;
    PERFORM set_oos_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 4. RELEASE: what OOS holds, the email on release, the retest replacing its original
-------------------------------------------------------------------------------
-- What stops a test's results from being finalized because of an OOS (NULL = nothing)
CREATE FUNCTION oos_release_problem(p_rt uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE tr record; x oos_investigation;
BEGIN
    SELECT * INTO x FROM oos_investigation WHERE requested_test_id = p_rt AND status NOT IN ('Closed','Cancelled') ORDER BY opened_at LIMIT 1;
    IF x.id IS NOT NULL THEN RETURN x.oos_code || ' is open: its result is held until the investigation is concluded'; END IF;
    FOR tr IN SELECT t.*, a.analyte_name FROM test_result t JOIN analyte a ON a.id = t.analyte_id
               WHERE t.requested_test_id = p_rt AND t.status = 'Active' AND t.stage = 'Final' AND t.result_key IS NULL AND t.conformance = 'Does not conform' LOOP
        SELECT * INTO x FROM oos_investigation WHERE test_result_id = tr.id AND status = 'Closed' ORDER BY concluded_at DESC LIMIT 1;
        IF x.id IS NULL THEN RETURN tr.analyte_name || ' ' || tr.reported || ' does not conform: open the OOS investigation (QC Review, or the sample page) before it can be released'; END IF;
        IF x.conclusion = 'Assignable cause found' THEN RETURN x.oos_code || ' found an assignable cause for ' || tr.analyte_name || ': order the lab investigation retest; the invalid result is not released'; END IF;
    END LOOP;
    RETURN NULL;
END $$;

-- The queue: the OOS state of each test
DROP VIEW finalization_queue_view;
CREATE VIEW finalization_queue_view AS
SELECT rt.id AS requested_test_id, rt.sample_id, s.sample_code, s.client_sample_id, s.compliance_category, o.id AS lab_order_id, o.order_code, o.site_id,
       c.id AS client_id, COALESCE(c.display_name, c.legal_name) AS client_name, c.account_status, rt.test_id, t.test_code, t.test_name, rt.due_date, rt.rush_status,
       (SELECT max(tr.approved_at) FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active') AS approved_at,
       (SELECT string_agg(DISTINCT u.full_name, ', ') FROM test_result tr JOIN app_user u ON u.id = tr.approved_by WHERE tr.requested_test_id = rt.id AND tr.status = 'Active') AS reviewed_by,
       sample_is_gmp(s.id) AS is_gmp,
       EXISTS (SELECT 1 FROM result_finalization f WHERE f.requested_test_id = rt.id) AS refinalize,
       EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.conformance = 'Does not conform') AS has_oos,
       (SELECT count(*) FROM requested_test r2 WHERE r2.sample_id = s.id AND r2.status <> 'Cancelled' AND r2.id <> rt.id AND NOT test_is_replaced(r2.id)
           AND NOT test_is_finalized(r2.id) AND NOT test_awaits_finalization(r2.id))::int AS other_tests_in_lab,
       oos_release_problem(rt.id) AS oos_problem,
       (SELECT string_agg(x.oos_code || ' ' || CASE WHEN x.status = 'Closed' THEN x.conclusion ELSE x.status END, ', ' ORDER BY x.opened_at) FROM oos_investigation x
         WHERE x.requested_test_id = rt.id AND x.status <> 'Cancelled') AS oos_codes,
       rt.retest_of_id IS NOT NULL AS is_retest
  FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id
  JOIN test t ON t.id = rt.test_id
 WHERE test_awaits_finalization(rt.id);

-- A test with a retest is shown by its retest: not pending, not on the order's count
CREATE OR REPLACE FUNCTION sample_fully_reported(p_sample uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM coa c JOIN coa_version v ON v.coa_id = c.id WHERE c.sample_id = p_sample AND v.is_final)
       AND NOT EXISTS (SELECT 1 FROM requested_test r WHERE r.sample_id = p_sample AND r.status <> 'Cancelled' AND NOT test_is_replaced(r.id) AND NOT test_is_finalized(r.id))
$$;
CREATE OR REPLACE FUNCTION refresh_order_status(p_order uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o lab_order; n_tests integer; n_done integer; n_batched integer; n_review integer; s lab_order_status; fallback lab_order_status; gs text;
BEGIN
    SELECT * INTO o FROM lab_order WHERE id = p_order;
    IF o.id IS NULL OR o.status IN ('Draft','Reported') THEN RETURN; END IF;
    fallback := CASE WHEN EXISTS (SELECT 1 FROM sample sm WHERE sm.lab_order_id = o.id AND sm.status = 'Expected') THEN 'Submitted' ELSE 'Received' END;
    SELECT count(*),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.result_key IS NULL AND tr.stage = 'Final')
                                  AND NOT EXISTS (SELECT 1 FROM reprep_request rp WHERE rp.requested_test_id = rt.id AND rp.status = 'Pooled')),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE e.requested_test_id = rt.id AND b.status <> 'Cancelled' AND e.removed_at IS NULL)),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE e.requested_test_id = rt.id AND e.status = 'Active' AND b.status = 'Awaiting Review')
                                  AND NOT EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.result_key IS NULL AND tr.stage = 'Final'))
      INTO n_tests, n_done, n_batched, n_review
      FROM requested_test rt JOIN sample sm ON sm.id = rt.sample_id
     WHERE sm.lab_order_id = o.id AND rt.status <> 'Cancelled' AND sm.status <> 'Cancelled' AND NOT test_is_replaced(rt.id);
    s := CASE WHEN n_tests > 0 AND n_done = n_tests THEN 'Approved' WHEN n_review > 0 AND n_done + n_review >= n_tests THEN 'In Review' WHEN n_batched > 0 THEN 'In Testing' ELSE fallback END;
    IF s = o.status OR (s = fallback AND o.status NOT IN ('In Testing','In Review','Approved','Complete')) THEN RETURN; END IF;
    gs := COALESCE(current_setting('lims.group_sync', true), '');
    PERFORM set_config('lims.group_sync', '1', true);
    PERFORM ensure_reason('Order status follows its tests');
    UPDATE lab_order SET status = s WHERE id = o.id;
    PERFORM set_config('lims.group_sync', gs, true);
END $$;

-- Finalize (as in 026), now: the OOS rules instead of holding every out-of-specification result; a test replaced by
-- its retest is not pending; the OOS email goes out with the version that first releases a confirmed OOS.
CREATE OR REPLACE FUNCTION finalize_sample(p_sample uuid, p_tests uuid[], p_content jsonb, p_doc uuid, p_sha text, p_checks jsonb, p_group text,
                                p_internal_note text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s sample; o lab_order; cl client; si lab_site; v_rt uuid; v_coa coa; v_prev coa_version; v_ver uuid; v_no integer; v_pending integer;
        d document_file; x jsonb; v_sig uuid := NULLIF(current_setting('lims.signature_id', true), '')::uuid; v_code text; ct record; u app_user;
        v_ids uuid[]; v_bad text; q oos_investigation; v_base text; v_tok text; v_lines text;
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
        v_bad := oos_release_problem(v_rt);
        IF v_bad IS NOT NULL THEN RAISE EXCEPTION '%: %', s.sample_code, v_bad; END IF;
        IF EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id JOIN step_run r ON r.batch_id = b.id
                    WHERE e.requested_test_id = v_rt AND b.status <> 'Cancelled'
                      AND (r.performed_by = current_app_user() OR r.witness_id = current_app_user() OR b.reviewed_by = current_app_user()))
           OR EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = v_rt AND tr.status = 'Active' AND tr.approved_by = current_app_user()) THEN
            RAISE EXCEPTION 'You performed, witnessed or reviewed the work on % (%): someone else finalizes it', s.sample_code,
                (SELECT t.test_name FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.id = v_rt);
        END IF;
    END LOOP;

    FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_checks, '[]')) LOOP
        IF x->>'level' = 'Block' THEN RAISE EXCEPTION 'Release check for %: % (%)', s.sample_code, x->>'title', x->>'detail'; END IF;
        IF x->>'level' = 'Warning' AND COALESCE(btrim(x->>'ack'), '') = '' THEN
            RAISE EXCEPTION 'Release check for %: give a reason to release despite "%"', s.sample_code, x->>'title';
        END IF;
    END LOOP;

    SELECT array_agg(DISTINCT r ORDER BY r) INTO v_ids FROM unnest(p_tests) AS q2(t), unnest(test_final_result_ids(q2.t)) AS r;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(v_ids, '{}')) r WHERE NOT (p_content->'result_ids') ? r::text) THEN
        RAISE EXCEPTION 'The COA of % was built before a result changed: open it again', s.sample_code;
    END IF;
    SELECT count(*) INTO v_pending FROM requested_test r WHERE r.sample_id = p_sample AND r.status <> 'Cancelled' AND NOT r.id = ANY (p_tests)
       AND NOT test_is_replaced(r.id) AND NOT test_is_finalized(r.id);
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
        -- a confirmed OOS released for the first time: the client is told (email on release, not detection)
        v_base := regexp_replace(COALESCE(p_content->>'verify_url', ''), '/verify\.html.*$', '');
        FOR q IN SELECT x2.* FROM oos_investigation x2 JOIN test_result tr ON tr.id = x2.test_result_id
                  WHERE x2.requested_test_id = ANY (p_tests) AND x2.status = 'Closed' AND x2.conclusion = 'OOS confirmed' AND x2.client_notified_at IS NULL AND tr.status = 'Active' LOOP
            v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
            SELECT string_agg('- ' || a.analyte_name || ': ' || q.reported || COALESCE(' ' || q.unit, '') || ' (specification ' || COALESCE(q.spec_text, '') || ')', E'\n')
              INTO v_lines FROM analyte a WHERE a.id = q.analyte_id;
            PERFORM set_oos_internal(true);
            UPDATE oos_investigation SET client_token = v_tok, client_notified_at = clock_timestamp() WHERE id = q.id;
            PERFORM set_oos_internal(false);
            FOR ct IN SELECT DISTINCT c2.email, c2.first_name, c2.last_name FROM client_contact cc JOIN contact c2 ON c2.id = cc.contact_id
                       WHERE cc.client_id = o.client_id AND cc.status = 'Active' AND c2.status = 'Active' AND ('REPORT' = ANY (cc.roles) OR 'QUALITY' = ANY (cc.roles))
                      UNION SELECT c3.email, c3.first_name, c3.last_name FROM contact c3 WHERE c3.id = o.ordering_contact_id
                        AND NOT EXISTS (SELECT 1 FROM client_contact cc WHERE cc.client_id = o.client_id AND cc.status = 'Active' AND ('REPORT' = ANY (cc.roles) OR 'QUALITY' = ANY (cc.roles))) LOOP
                PERFORM queue_email('OOS Result', ct.email, ct.first_name || ' ' || ct.last_name, jsonb_build_object(
                    'first_name', ct.first_name, 'client_sample_id', COALESCE(s.client_sample_id, s.sample_code), 'sample_code', s.sample_code,
                    'test_name', (SELECT t.test_name FROM test t WHERE t.id = (SELECT test_id FROM requested_test WHERE id = q.requested_test_id)),
                    'order_code', o.order_code, 'oos_results', v_lines,
                    'phase1_conclusion', 'no laboratory error was found, so the result is confirmed (' || q.oos_code || ').',
                    'phase1_attachment', CASE WHEN q.is_gmp THEN E'\nThe signed Phase I investigation report is attached.' ELSE '' END,
                    'link_retest', v_base || '/oos-response.html?t=' || v_tok || '&a=retest', 'link_retest_duplicate', v_base || '/oos-response.html?t=' || v_tok || '&a=duplicate',
                    'link_new_sample', v_base || '/oos-response.html?t=' || v_tok || '&a=new', 'link_retain', v_base || '/oos-response.html?t=' || v_tok || '&a=retain',
                    'link_call', v_base || '/oos-response.html?t=' || v_tok || '&a=call', 'link_acknowledge', v_base || '/oos-response.html?t=' || v_tok || '&a=ack',
                    'staff_name', u.full_name, 'site_name', si.site_name), o.id, v_ver, CASE WHEN q.is_gmp THEN q.report_document_id END);
            END LOOP;
        END LOOP;
    END IF;
    PERFORM refresh_order_reported(o.id);
    RETURN v_ver;
END $$;

-- The OOS email's wording: the name now says it is sent
UPDATE email_template SET template_name = 'Out of specification result (on release)' WHERE template_code = 'OOS Result';

-------------------------------------------------------------------------------
-- 5. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_r2;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'oos_investigation' THEN
        RETURN jsonb_build_object('label', 'OOS investigation ' || (r->>'oos_code'), 'link', '#/oos/' || (r->>'id'));
    ELSIF p_table = 'oos_client_response' THEN
        RETURN jsonb_build_object('label', 'Client response (' || (r->>'choice') || ') to ' || COALESCE((SELECT oos_code FROM oos_investigation WHERE id = (r->>'oos_id')::uuid), 'an OOS'),
                                  'link', '#/oos/' || (r->>'oos_id'));
    ELSIF p_table = 'oos_checklist_item' OR p_table = 'oos_procedure_setting' THEN
        RETURN jsonb_build_object('label', 'OOS checklist: ' || COALESCE(r->>'item_text', r->>'procedure'), 'link', '#/admin/oos');
    END IF;
    RETURN audit_record_ref_r2(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
