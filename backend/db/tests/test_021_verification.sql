-- Verification for migration 024 (WD-6): workflow verification. The automated accounts (no password, no group, rights
-- only during a run at the verification's lab), the protocol (signed, QA approves, never its author), the design
-- fingerprint, a run (its order, codes, verification batches kept out of the backlog, no stock taken, daily QC not
-- shared with the lab), checks recorded once, the outcome, QA's report (justifications), and the gate on approving the
-- version. The run's own driver (server/verification.js) is exercised by the browser test e2e_verification.js.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.methods_internal', '', false);
SELECT set_config('lims.verification_id', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (wrong error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.user_only(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) || set_config('lims.signature_id', '', false) $$;
-- inside the run's transaction: act as an automated account (its signature is made by sign_action, as the run does)
CREATE OR REPLACE FUNCTION pg_temp.auto(u text, meaning text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), true); IF meaning IS NOT NULL THEN PERFORM sign_action(meaning, 'Rule test', 'Testing', NULL); END IF; RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.vsite(c text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = c $$;
CREATE OR REPLACE FUNCTION pg_temp.wdc() RETURNS uuid LANGUAGE sql AS $$ SELECT d.id FROM department d WHERE d.site_id = pg_temp.vsite('CFL') AND d.department_code = 'WDC' $$;
CREATE OR REPLACE FUNCTION pg_temp.lead() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = 'WD Lead' $$;
CREATE OR REPLACE FUNCTION pg_temp.tv() RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Verify' ORDER BY v.version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.st(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_step WHERE test_version_id = pg_temp.tv() AND step_key = k AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.w() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_verification WHERE test_version_id = pg_temp.tv() ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.vb() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_batch WHERE verification_id = pg_temp.w() ORDER BY batch_code LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.vr(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.vb() AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.protocol(p_hash text) RETURNS uuid LANGUAGE sql AS $$
  SELECT create_verification(pg_temp.tv(), p_hash, 'Rule test', '{"samples": [{"key": "S1"}]}',
    '[{"req_code": "URS-01", "kind": "URS", "statement": "Lead is reported"}, {"req_code": "FRS-01", "kind": "FRS", "statement": "Result = reading", "traces": ["URS-01"]},
      {"req_code": "FRS-02", "kind": "FRS", "statement": "Never reached", "traces": ["URS-01"]}]',
    '[{"check_code": "VC-01", "case_label": "Typical", "title": "S1 Lead", "requirement_codes": ["URS-01", "FRS-01"], "expected": {"text": "2.00"}},
      {"check_code": "VC-02", "case_label": "Process", "title": "Not reached", "requirement_codes": ["FRS-02"]}]') $$;

-- set-up: WD Verify, a draft with a daily method blank (the lab requires workflow verification)
SELECT pg_temp.as_user('akiddle');
UPDATE lab_site SET require_workflow_verification = true WHERE site_code = 'CFL';
SELECT pg_temp.as_user('wd.ana');
SELECT create_test(pg_temp.vsite('CFL'), 'WD Verify', pg_temp.wdc(), (SELECT id FROM method WHERE method_name = 'WD Elemental impurities by ICP-MS' AND site_id = pg_temp.vsite('CFL') LIMIT 1));
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, loq, lod) VALUES (pg_temp.tv(), pg_temp.lead(), 1, 'Numeric', 'mg/kg', 0.010, 0.005);
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.tv(), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 5, "qc": [{"qc_type": "Method Blank", "qc_class": "Prep", "frequency": "Daily", "criteria": [{"limit_type": "Blank threshold", "max": 0.05}]}]}'),
 (pg_temp.tv(), 'read', 'Read', 'Data Entry', 2, '{"value_label": "Lead", "value_unit": "mg/kg", "require_attachment": false}'),
 (pg_temp.tv(), 'calc', 'Result', 'Calculation', 3, '{"formula": "{read.reading} * 1"}'),
 (pg_temp.tv(), 'review', 'QC Review', 'QC Review', 4, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES
 (pg_temp.st('read'), pg_temp.st('batch')), (pg_temp.st('calc'), pg_temp.st('read')), (pg_temp.st('review'), pg_temp.st('calc'));

-- 1. the automated accounts
SELECT pg_temp.expect_true('Three automated accounts exist; outside a run they have no rights and no lab',
  (SELECT count(*) FROM app_user WHERE is_automated AND username IN ('verify.analyst','verify.witness','verify.reviewer')) = 3
  AND NOT user_has_permission_at(pg_temp.uid('verify.analyst'), 'testing.perform', pg_temp.vsite('CFL'))
  AND NOT user_has_permission_at(pg_temp.uid('verify.reviewer'), 'testing.review', pg_temp.vsite('CFL'))
  AND NOT user_can_access_site(pg_temp.uid('verify.analyst'), pg_temp.vsite('CFL')));
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_error_like('An automated account cannot be given a password', $$UPDATE app_user SET password_hash = 'scrypt$1$1$1$x$y' WHERE username = 'verify.analyst'$$, 'cannot sign in');
SELECT pg_temp.expect_error_like('An automated account cannot be made a system administrator', $$UPDATE app_user SET is_admin = true WHERE username = 'verify.reviewer'$$, 'automated verification account');
SELECT pg_temp.expect_error_like('Whether an account is automated is fixed', $$UPDATE app_user SET is_automated = true WHERE username = 'wd.ana2'$$, 'fixed when it is created');
SELECT pg_temp.expect_error_like('Nobody creates an automated account', $$INSERT INTO app_user (username, full_name, is_automated) VALUES ('fake.bot', 'Fake bot', true)$$, 'only by the system');
SELECT pg_temp.expect_error_like('An automated account cannot be put in a group', $$INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.uid('verify.analyst') FROM lab_group g WHERE g.site_id = pg_temp.vsite('CFL') AND g.group_name = 'Analyst'$$, 'cannot be in a group');
SELECT pg_temp.expect_error_like('An automated account cannot be given lab access', $$INSERT INTO user_site_access (user_id, site_id) VALUES (pg_temp.uid('verify.analyst'), pg_temp.vsite('CFL'))$$, 'only during a verification run');
SELECT pg_temp.expect_error_like('An automated account cannot sign outside a run',
  $$SELECT set_config('lims.user_id', pg_temp.uid('verify.analyst')::text, true), sign_action('Performed by', 'x', 'Testing', NULL)$$, 'only during a workflow verification run');
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_error_like('Nobody else signs as an automated verification run',
  $$INSERT INTO signature_event (user_id, full_name, meaning, action, method) VALUES (pg_temp.uid('akiddle'), '', 'Approved by', 'x', 'Automated verification run')$$, 'Only the automated verification accounts');

-- 2. the protocol
SELECT pg_temp.user_only('wd.ana');
SELECT pg_temp.expect_error_like('Writing a protocol is signed', $$SELECT pg_temp.protocol(test_version_config_hash(pg_temp.tv()))$$, 'electronic signature');
SELECT pg_temp.as_user('wd.int');
SELECT pg_temp.expect_error_like('Writing a protocol needs methods.design', $$SELECT pg_temp.protocol(test_version_config_hash(pg_temp.tv()))$$, 'methods.design');
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('A protocol written for another design is refused', $$SELECT pg_temp.protocol('not-the-fingerprint')$$, 'version changed while the protocol');
SELECT pg_temp.as_user('wd.qa');
SELECT pg_temp.protocol(test_version_config_hash(pg_temp.tv()));
SELECT pg_temp.expect_error_like('Its author cannot approve a protocol, even holding methods.verify', $$SELECT approve_verification_protocol(pg_temp.w())$$, 'someone else (QA) must approve');
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.protocol(test_version_config_hash(pg_temp.tv()));
SELECT pg_temp.expect_true('A new protocol supersedes the version''s earlier one not signed off',
  (SELECT string_agg(status || ':' || COALESCE(cancelled_reason, ''), ',' ORDER BY created_at) FROM workflow_verification WHERE test_version_id = pg_temp.tv()) = 'Cancelled:Superseded by a new protocol,Protocol draft:');
SELECT pg_temp.expect_true('The protocol is a draft with its design, fingerprint and signature "Prepared by"',
  (SELECT status = 'Protocol draft' AND config_hash = test_version_config_hash(pg_temp.tv()) AND definition->>'test_name' = 'WD Verify'
          AND prepared_signature_id IS NOT NULL AND verification_code LIKE 'VER-%' FROM workflow_verification WHERE id = pg_temp.w()));
SELECT pg_temp.expect_error_like('Its requirements and checks change only through the protocol, run and report', $$UPDATE verification_check SET title = 'x' WHERE verification_id = pg_temp.w()$$, 'only through their protocol');
SELECT pg_temp.expect_error_like('The designer who wrote it cannot approve it either', $$SELECT approve_verification_protocol(pg_temp.w())$$, 'methods.verify');
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.expect_error_like('Approving the protocol needs methods.verify (QA)', $$SELECT approve_verification_protocol(pg_temp.w())$$, 'methods.verify');
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('The run waits for QA''s approval of the protocol', $$SELECT start_verification_run(pg_temp.w(), '[{"key": "S1"}]')$$, 'QA approves the protocol');
SELECT pg_temp.as_user('wd.qa');
SELECT approve_verification_protocol(pg_temp.w());
SELECT pg_temp.expect_true('QA approved it (signed)', (SELECT status = 'Protocol approved' AND protocol_approved_by = pg_temp.uid('wd.qa') AND protocol_signature_id IS NOT NULL FROM workflow_verification WHERE id = pg_temp.w()));

-- 3. a change to the design voids the protocol
SELECT pg_temp.as_user('wd.ana');
UPDATE workflow_step SET config = '{"formula": "{read.reading} * 2"}' WHERE id = pg_temp.st('calc');
SELECT pg_temp.expect_error_like('A protocol is not executed once the version changed', $$SELECT start_verification_run(pg_temp.w(), '[{"key": "S1"}]')$$, 'changed after');
UPDATE workflow_step SET config = '{"formula": "{read.reading} * 1"}' WHERE id = pg_temp.st('calc');
SELECT pg_temp.expect_true('Changing it back gives the same fingerprint (the design, not its history)', (SELECT config_hash = test_version_config_hash(pg_temp.tv()) FROM workflow_verification WHERE id = pg_temp.w()));

-- 4. the run (in one transaction, as the server runs it)
BEGIN;
SELECT pg_temp.as_user('wd.qa');
SELECT set_config('lims.signature_id', sign_action('Executed by', 'Rule test run', 'Methods', NULL)::text, true);
SELECT start_verification_run(pg_temp.w(), '[{"key": "S1", "description": "Typical"}]');
SELECT pg_temp.expect_true('The run made an internal order of origin Workflow Verification, with its own sample codes, in the backlog only during the run',
  (SELECT o.origin::text = 'Workflow Verification' AND c.is_internal FROM workflow_verification w JOIN lab_order o ON o.id = w.lab_order_id JOIN client c ON c.id = o.client_id WHERE w.id = pg_temp.w())
  AND (SELECT string_agg(s.sample_code, ',') FROM sample s JOIN workflow_verification w ON w.lab_order_id = s.lab_order_id WHERE w.id = pg_temp.w()) LIKE 'VER-%-1'
  AND EXISTS (SELECT 1 FROM test_pool_view WHERE test_version_id = pg_temp.tv()));
SELECT pg_temp.expect_true('During the run the automated analyst may do bench work at CFL only, the reviewer may review',
  user_has_permission_at(pg_temp.uid('verify.analyst'), 'testing.perform', pg_temp.vsite('CFL')) AND NOT user_has_permission_at(pg_temp.uid('verify.analyst'), 'testing.perform', pg_temp.vsite('TPS'))
  AND user_in_department(pg_temp.uid('verify.analyst'), pg_temp.wdc()) AND user_has_permission_at(pg_temp.uid('verify.reviewer'), 'testing.review', pg_temp.vsite('CFL'))
  AND NOT user_has_permission_at(pg_temp.uid('verify.reviewer'), 'testing.perform', pg_temp.vsite('CFL')) AND NOT user_has_permission_at(pg_temp.uid('verify.analyst'), 'orders.edit', pg_temp.vsite('CFL')));
SELECT pg_temp.auto('verify.analyst', NULL);
SELECT create_batch(pg_temp.vsite('CFL'), pg_temp.tv());
SELECT pg_temp.expect_true('The batch is a verification batch of this verification, with its own daily method blank',
  (SELECT is_verification AND verification_id = pg_temp.w() FROM test_batch WHERE id = pg_temp.vb())
  AND EXISTS (SELECT 1 FROM batch_entry WHERE batch_id = pg_temp.vb() AND label = 'Method Blank (daily)'));
SELECT pg_temp.auto('verify.analyst', 'Performed by');
SELECT complete_step(pg_temp.vr('batch'));
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) SELECT pg_temp.vr('read'), e.id, pg_temp.lead(), CASE WHEN e.entry_type = 'Sample' THEN 2 ELSE 0 END FROM batch_entry e WHERE e.batch_id = pg_temp.vb();
INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit)
  SELECT pg_temp.vr('read'), (SELECT id FROM batch_entry WHERE batch_id = pg_temp.vb() AND entry_type = 'QC'), id, 'Spike', 0.5, 'mL' FROM inventory_lot WHERE manufacturer_lot = 'WD-SPK' ORDER BY created_at LIMIT 1;
SELECT pg_temp.expect_true('A lot used in a verification batch is traced but its stock is not taken',
  EXISTS (SELECT 1 FROM entry_material WHERE step_run_id = pg_temp.vr('read')) AND NOT EXISTS (SELECT 1 FROM inventory_transaction WHERE reference LIKE (SELECT batch_code FROM test_batch WHERE id = pg_temp.vb()) || '%'));
SELECT pg_temp.auto('verify.analyst', 'Performed by');
SELECT complete_step(pg_temp.vr('read'));
SELECT pg_temp.auto('verify.analyst', 'Performed by');
SELECT complete_step(pg_temp.vr('calc'));
SELECT pg_temp.expect_true('Steps are signed by the automated analyst as an automated verification run, naming the verification',
  (SELECT bool_and(se.method = 'Automated verification run' AND se.verification_id = pg_temp.w() AND se.meaning = 'Performed by' AND r.performed_by = pg_temp.uid('verify.analyst'))
     FROM step_run r JOIN signature_event se ON se.id = r.signature_id WHERE r.batch_id = pg_temp.vb() AND r.status = 'Completed'));
SELECT pg_temp.auto('verify.reviewer', NULL);
SELECT approve_review_step(r.step_run_id) FROM review_step_runs(pg_temp.vb()) r;
SELECT pg_temp.auto('verify.reviewer', 'Reviewed by');
SELECT approve_batch(pg_temp.vb());
SELECT pg_temp.expect_true('The automated reviewer approved it (signed) and the order is Approved',
  (SELECT b.status = 'Approved' AND b.reviewed_by = pg_temp.uid('verify.reviewer') FROM test_batch b WHERE b.id = pg_temp.vb())
  AND (SELECT o.status::text = 'Approved' FROM lab_order o JOIN workflow_verification w ON w.lab_order_id = o.id WHERE w.id = pg_temp.w()));
SELECT record_verification_check(pg_temp.w(), 'VC-01', '{"text": "2.00"}', 'Pass', NULL, pg_temp.vb(), 'batch');
SELECT pg_temp.expect_error_like('A check is recorded once', $$SELECT record_verification_check(pg_temp.w(), 'VC-01', '{"text": "3"}', 'Fail', NULL, NULL, NULL)$$, 'already recorded');
SELECT pg_temp.expect_true('The run ends: an unreached check is Not tested and the outcome is Pass with exceptions', finish_verification_run(pg_temp.w(), '[]') = 'Pass with exceptions');
SELECT pg_temp.expect_true('After the run the automated accounts have no rights again', verification_running() IS NULL AND NOT user_has_permission_at(pg_temp.uid('verify.analyst'), 'testing.perform', pg_temp.vsite('CFL')));
COMMIT;
SELECT pg_temp.expect_true('Each requirement takes its checks'' result',
  (SELECT string_agg(req_code || '=' || result, ',' ORDER BY sort_order) FROM verification_requirement WHERE verification_id = pg_temp.w()) = 'URS-01=Pass,FRS-01=Pass,FRS-02=Not tested'
  AND (SELECT result FROM verification_check WHERE verification_id = pg_temp.w() AND check_code = 'VC-02') = 'Not tested');
SELECT pg_temp.as_user('wd.ana');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.steps): after the run nobody works in a verification batch
SELECT pg_temp.expect_true('Verification samples stay out of the backlog', NOT EXISTS (SELECT 1 FROM test_pool_view WHERE test_version_id = pg_temp.tv()));

-- 5. the report and the gate
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.expect_error_like('Without a signed report the version cannot be approved (the lab requires it)', $$SELECT approve_test_version(pg_temp.tv())$$, 'needs a passing workflow verification');
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('Signing the report needs methods.verify (QA)', $$SELECT sign_verification_report(pg_temp.w(), 'Fine', '{}')$$, 'methods.verify');
SELECT pg_temp.as_user('wd.qa');
SELECT pg_temp.expect_error_like('Whoever executed the run cannot sign its report, even holding methods.verify', $$SELECT sign_verification_report(pg_temp.w(), 'Fine', '{}')$$, 'someone else (QA) must sign');
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_error_like('QA signs the report only once the evidence (screenshots) is captured', $$SELECT sign_verification_report(pg_temp.w(), 'Fine', '{"FRS-02": "x"}')$$, 'Capture the evidence');
-- 5b. the evidence (WD-6.1, migration 025): stored images, checked against their SHA-256, recorded once and never changed
SELECT pg_temp.as_user('wd.ana');
INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content)
  VALUES ('evidence-E01.png', 'image/png', 16, encode(sha256(decode('89504e470d0a1a0a0000000d49484452', 'hex')), 'hex'), decode('89504e470d0a1a0a0000000d49484452', 'hex')),
         ('notes.txt', 'text/plain', 5, encode(sha256('hello'::bytea), 'hex'), 'hello'::bytea);
CREATE OR REPLACE FUNCTION pg_temp.ev(f text, sha text) RETURNS text LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('title', 'BAT: Results and QC', 'page_ref', '#/testing/batches/x?step=results', 'check_codes', jsonb_build_array('VC-01'),
    'document_id', (SELECT id FROM document_file WHERE file_name = f AND mime_type IN ($t$image/png$t$, $t$text/plain$t$) ORDER BY uploaded_at DESC NULLS LAST LIMIT 1), 'sha256', sha, 'width', 1440, 'height', 900, 'captured_at', now()))::text $$;
SELECT pg_temp.expect_error_like('Evidence must be the stored image with that SHA-256', format('SELECT record_verification_evidence(pg_temp.w(), %L::jsonb)', pg_temp.ev('evidence-E01.png', repeat('0', 64))), 'not the stored image');
SELECT pg_temp.expect_error_like('Evidence must be a PNG image', format('SELECT record_verification_evidence(pg_temp.w(), %L::jsonb)', pg_temp.ev('notes.txt', encode(sha256('hello'::bytea), 'hex'))), 'not the stored image');
SELECT pg_temp.user_only('wd.ana');
SELECT pg_temp.expect_error_like('Recording the evidence is signed', format('SELECT record_verification_evidence(pg_temp.w(), %L::jsonb)', pg_temp.ev('evidence-E01.png', encode(sha256(decode('89504e470d0a1a0a0000000d49484452', 'hex')), 'hex'))), 'sign');
SELECT pg_temp.as_user('wd.ana');
SELECT record_verification_evidence(pg_temp.w(), pg_temp.ev('evidence-E01.png', encode(sha256(decode('89504e470d0a1a0a0000000d49484452', 'hex')), 'hex'))::jsonb);
SELECT pg_temp.expect_true('The evidence is recorded (signed "Evidence captured by" by the person capturing it)',
  (SELECT count(*) = 1 FROM verification_evidence WHERE verification_id = pg_temp.w()) AND (SELECT evidence_captured_by = pg_temp.uid('wd.ana') AND evidence_signature_id IS NOT NULL FROM workflow_verification WHERE id = pg_temp.w()));
SELECT pg_temp.expect_error_like('The evidence is captured once', format('SELECT record_verification_evidence(pg_temp.w(), %L::jsonb)', pg_temp.ev('evidence-E01.png', encode(sha256(decode('89504e470d0a1a0a0000000d49484452', 'hex')), 'hex'))), 'already captured');
SELECT pg_temp.expect_error_like('Evidence is kept exactly as captured (no change)', $$UPDATE verification_evidence SET title = 'Other' WHERE verification_id = pg_temp.w()$$, 'exactly as captured');
SELECT pg_temp.expect_error_like('Evidence is kept exactly as captured (no deletion)', $$DELETE FROM verification_evidence WHERE verification_id = pg_temp.w()$$, '');
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_error_like('QA justifies each requirement not tested', $$SELECT sign_verification_report(pg_temp.w(), 'Fine', '{}')$$, 'FRS-02 was not tested');
SELECT sign_verification_report(pg_temp.w(), 'The workflow runs as designed', '{"FRS-02": "Covered by the rule tests"}');
SELECT pg_temp.expect_true('QA signed the report with the justification', (SELECT w.status = 'Report signed' AND w.report_signed_by = pg_temp.uid('akiddle') AND r.qa_justification = 'Covered by the rule tests'
  FROM workflow_verification w JOIN verification_requirement r ON r.verification_id = w.id AND r.req_code = 'FRS-02' WHERE w.id = pg_temp.w()));
SELECT pg_temp.expect_error_like('A signed verification cannot be cancelled', $$SELECT cancel_verification(pg_temp.w())$$, 'cannot be cancelled');
SELECT pg_temp.as_user('wd.ana');
UPDATE workflow_step SET instructions = 'Changed after the report' WHERE id = pg_temp.st('read');
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.expect_error_like('A change after the report closes the gate again', $$SELECT approve_test_version(pg_temp.tv())$$, 'needs a passing workflow verification');
SELECT pg_temp.as_user('wd.ana');
UPDATE workflow_step SET instructions = NULL WHERE id = pg_temp.st('read');
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.tv());
SELECT pg_temp.expect_true('With the passing report of exactly this design, the version is approved', (SELECT status = 'Effective' FROM test_version WHERE id = pg_temp.tv()));

-- 6. the lab's own batch keeps its own daily QC
SELECT pg_temp.as_user('akiddle');
INSERT INTO project (client_id, project_name) SELECT client_id, 'WD Verify project' FROM lab_order WHERE order_code = 'LO-000003';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'WD Verify project'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price)
  SELECT pv.id, x.id, 1, 0 FROM project_version pv JOIN project p ON p.id = pv.project_id, test x WHERE p.project_name = 'WD Verify project' AND x.test_name = 'WD Verify';
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Verify project');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam@acme.com') WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Verify project');
INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, quantity_received, quantity_unit, number_of_units)
  SELECT id, 'WD-VERIFY-1', 'Test product', 'Powder', 100, 'g', 1 FROM lab_order WHERE po_number = 'WD-PO-SPLIT';
SELECT order_test((SELECT id FROM sample WHERE client_sample_id = 'WD-VERIFY-1'),
  (SELECT q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id WHERE p.project_name = 'WD Verify project'));
SELECT log_samples(ARRAY(SELECT id FROM sample WHERE client_sample_id = 'WD-VERIFY-1'));
SELECT pg_temp.as_user('wd.ana');
SELECT create_batch(pg_temp.vsite('CFL'), pg_temp.tv());
SELECT pg_temp.expect_true('A lab batch the same day does not use the verification''s daily method blank',
  (SELECT e.label FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE b.test_version_id = pg_temp.tv() AND NOT b.is_verification AND e.entry_type = 'QC') = 'Method Blank (daily)');

SELECT pg_temp.as_user('akiddle');
UPDATE lab_site SET require_workflow_verification = false WHERE site_code = 'CFL';
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
