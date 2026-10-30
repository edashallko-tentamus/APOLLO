-- Verification for migration 053 (0.31.0): training and competency. Who may do what; the rules per lab and department;
-- initial competency by record (evidence, the trainer's evaluation, QA's approval, never by the trainee or the
-- evaluator) granting a qualification; continuing competency keeping it up (a conditional pass); training samples (an
-- internal order, known values as the specification, evaluated only on final results); the qualification's state
-- (current, due soon, lapsed); department trained (N tests) and what it unlocks; the bench gate where the lab requires
-- training; legacy qualifications; withdrawing; the rolling counter.
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.site_id', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (other error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.tr_uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.tr_site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.tr_grp(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT g.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id WHERE s.site_code = site AND g.group_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.tr_can(u text, code text) RETURNS boolean LANGUAGE sql AS $$ SELECT user_has_permission_at(pg_temp.tr_uid(u), code, pg_temp.tr_site('CFL')) $$;
CREATE OR REPLACE FUNCTION pg_temp.tr_doc() RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('training-form.pdf', 'application/pdf', 0, '', decode('JVBERi0xLjQK', 'base64')) RETURNING id $$;
CREATE OR REPLACE FUNCTION pg_temp.tr_att(code text) RETURNS competency_attempt LANGUAGE sql AS $$ SELECT * FROM competency_attempt WHERE attempt_code = code $$;

-- fixtures: a trainee, a second trainee, a trainer (Lab Supervisor), QA; a test that earlier rule tests ran in batches at CFL
INSERT INTO app_user (username, full_name) VALUES ('tc.ana', 'TC Analyst'), ('tc.ana2', 'TC Analyst Two'), ('tc.sup', 'TC Supervisor'), ('tc.qa', 'TC QA');
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.tr_grp('CFL', 'Analyst'), pg_temp.tr_uid('tc.ana')), (pg_temp.tr_grp('CFL', 'Analyst'), pg_temp.tr_uid('tc.ana2')),
  (pg_temp.tr_grp('CFL', 'Lab Supervisor'), pg_temp.tr_uid('tc.sup')), (pg_temp.tr_grp('CFL', 'QA'), pg_temp.tr_uid('tc.qa'));
SELECT set_config('lims.site_id', pg_temp.tr_site('CFL')::text, false);
CREATE TEMP TABLE tr_fx AS
SELECT b.id AS batch_id, b.test_id, t.department_id, t.test_name
  FROM test_batch b JOIN test t ON t.id = b.test_id
 WHERE b.site_id = pg_temp.tr_site('CFL') AND NOT b.is_verification AND b.status::text <> 'Cancelled' AND t.department_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM step_run r WHERE r.batch_id = b.id AND r.completed_at IS NOT NULL)
 ORDER BY b.created_at LIMIT 1;
-- a test with an approved version and analytes, for training samples
CREATE TEMP TABLE tr_ts AS
SELECT t.id AS test_id, tv.id AS version_id, (SELECT a.analyte_id FROM test_version_analyte a WHERE a.test_version_id = tv.id AND a.status = 'Active' ORDER BY a.sort_order LIMIT 1) AS analyte_id
  FROM test t JOIN test_version tv ON tv.test_id = t.id AND tv.status = 'Effective'
 WHERE t.site_id = pg_temp.tr_site('CFL') AND t.id <> (SELECT test_id FROM tr_fx)
   AND EXISTS (SELECT 1 FROM test_version_analyte a WHERE a.test_version_id = tv.id AND a.status = 'Active')
 ORDER BY t.created_at LIMIT 1;
SELECT pg_temp.expect_true('(fixtures) a test with batches at CFL, and another with an approved version and analytes', (SELECT count(*) = 1 FROM tr_fx) AND (SELECT count(*) = 1 FROM tr_ts));

-------------------------------------------------------------------------------
-- 1. WHO MAY DO WHAT; THE RULES
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('QA views, records, approves and configures training; the Lab Supervisor records and configures but does not approve; the Analyst none',
  pg_temp.tr_can('tc.qa', 'training.approve') AND pg_temp.tr_can('tc.qa', 'training.configure') AND pg_temp.tr_can('tc.sup', 'training.record')
  AND pg_temp.tr_can('tc.sup', 'training.configure') AND NOT pg_temp.tr_can('tc.sup', 'training.approve') AND NOT pg_temp.tr_can('tc.ana', 'training.record') AND NOT pg_temp.tr_can('tc.ana', 'training.view'));
SELECT pg_temp.expect_true('Every lab starts with its lab-wide rule: department trained after 4 tests, both unlocks, continuing competency every 12 months',
  (SELECT bool_and(dept_trained_after = 4 AND unlock_any_test AND unlock_can_train AND continuing_months = 12) FROM training_rule WHERE department_id IS NULL)
  AND (SELECT count(*) FROM training_rule WHERE department_id IS NULL) = (SELECT count(*) FROM lab_site));
SELECT pg_temp.as_user('tc.ana');
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): an analyst cannot change the training rules, training.configure (TrainingService.saveRules)
SELECT pg_temp.as_user('tc.sup');
-- since 055 every department already has its own rule (made from the lab's): the department sets its count
SELECT pg_temp.expect_true('The department already has its own rule, made from the lab''s (4 tests)',
  (SELECT dept_trained_after = 4 FROM training_rule WHERE site_id = pg_temp.tr_site('CFL') AND department_id = (SELECT department_id FROM tr_fx) AND status = 'Active'));
SELECT set_config('lims.reason', 'Department rule (rule test)', false);
UPDATE training_rule SET dept_trained_after = 1, continuing_months = 6 WHERE site_id = pg_temp.tr_site('CFL') AND department_id = (SELECT department_id FROM tr_fx);
SELECT pg_temp.expect_true('The department sets its own count (department trained after 1 test, continuing every 6 months); tests with no department keep the lab''s',
  (training_rule_for(pg_temp.tr_site('CFL'), (SELECT department_id FROM tr_fx))).dept_trained_after = 1
  AND (training_rule_for(pg_temp.tr_site('CFL'), gen_random_uuid())).dept_trained_after = 4);
SELECT pg_temp.expect_error_like('One rule per department', $$INSERT INTO training_rule (site_id, department_id) VALUES (pg_temp.tr_site('CFL'), (SELECT department_id FROM tr_fx))$$, 'training_rule_one');
-- Moved to the Java backend in migration 071 (JUnit: TrainingRulesTest.theRules): runs and months go together (and the other rule ranges, at least one route)

-------------------------------------------------------------------------------
-- 2. INITIAL COMPETENCY BY RECORD
-------------------------------------------------------------------------------
-- Moved to the Java backend in migration 071 (JUnit: TrainingRulesTest.startingAnAttempt): only a trainer starts training, never their own; a record says
--   what was done; continuing competency needs a qualification to keep up; one open attempt per person and test; someone qualified is not given an
--   initial competency again
-- Moved to the Java backend in migration 071 (JUnit: TrainingRulesTest.initialCompetencyByRecord): an attempt changes only through its steps; a record is
--   evaluated with its evidence attached; nobody evaluates their own competency; a fail says why; only QA (training.approve) decides, never the trainee
--   or the evaluator; rejecting says why; QA's approval grants the qualification; a qualification is never typed in (the Java service signs each step)
-- fixture: tc.ana's initial competency by record, approved by QA, as the Java service writes it
SELECT pg_temp.as_user('tc.sup');
INSERT INTO competency_attempt (user_id, test_id, site_id, kind, route, description, trained_on, status, evaluation, evaluated_by, evaluated_at, decided_by, decided_at)
VALUES (pg_temp.tr_uid('tc.ana'), (SELECT test_id FROM tr_fx), pg_temp.tr_site('CFL'), 'Initial', 'Record', 'Read the SOP; observed 3 runs; ran 3 supervised', current_date - 2,
        'Approved', 'Pass', pg_temp.tr_uid('tc.sup'), now(), pg_temp.tr_uid('tc.qa'), now());
CREATE TEMP TABLE tr_a1 AS SELECT attempt_code AS code, id FROM competency_attempt WHERE user_id = pg_temp.tr_uid('tc.ana') ORDER BY created_at DESC LIMIT 1;
INSERT INTO competency_evidence (attempt_id, document_id, title) VALUES ((SELECT id FROM tr_a1), pg_temp.tr_doc(), 'Signed training form');
INSERT INTO analyst_qualification (user_id, test_id, site_id, source, attempt_id, approved_by, signature_id)
VALUES (pg_temp.tr_uid('tc.ana'), (SELECT test_id FROM tr_fx), pg_temp.tr_site('CFL'), 'Initial competency', (SELECT id FROM tr_a1), pg_temp.tr_uid('tc.qa'),
        NULLIF(current_setting('lims.signature_id', true), '')::uuid);
SELECT pg_temp.expect_true('The qualification is AQ-..., from the initial competency, and current',
  (SELECT qualification_code LIKE 'AQ-%' AND source = 'Initial competency' FROM analyst_qualification WHERE user_id = pg_temp.tr_uid('tc.ana') AND test_id = (SELECT test_id FROM tr_fx) AND status = 'Active')
  AND qualification_current(pg_temp.tr_uid('tc.ana'), (SELECT test_id FROM tr_fx)));

-------------------------------------------------------------------------------
-- 3. DEPARTMENT TRAINED AND WHAT IT UNLOCKS
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('With the department''s rule at 1 test, the trainee is department trained; the other trainee is not',
  department_trained(pg_temp.tr_uid('tc.ana'), pg_temp.tr_site('CFL'), (SELECT department_id FROM tr_fx))
  AND NOT department_trained(pg_temp.tr_uid('tc.ana2'), pg_temp.tr_site('CFL'), (SELECT department_id FROM tr_fx)));
SELECT pg_temp.expect_true('Department trained, they may evaluate others there (the rule lets them train) without training.record',
  can_evaluate_training(pg_temp.tr_uid('tc.ana'), (SELECT test_id FROM tr_fx)) AND NOT pg_temp.tr_can('tc.ana', 'training.record'));
UPDATE training_rule SET unlock_can_train = false WHERE site_id = pg_temp.tr_site('CFL') AND department_id = (SELECT department_id FROM tr_fx);
SELECT pg_temp.expect_true('Turned off in the rule, they may not', NOT can_evaluate_training(pg_temp.tr_uid('tc.ana'), (SELECT test_id FROM tr_fx)));
UPDATE training_rule SET unlock_can_train = true WHERE site_id = pg_temp.tr_site('CFL') AND department_id = (SELECT department_id FROM tr_fx);

-------------------------------------------------------------------------------
-- 4. THE BENCH GATE (WHERE THE LAB REQUIRES TRAINING)
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('While the lab does not require training, nobody is stopped', training_gate_problem(pg_temp.tr_uid('tc.ana2'), (SELECT batch_id FROM tr_fx)) IS NULL);
SELECT pg_temp.as_user('akiddle');
UPDATE lab_site SET require_training = true WHERE site_code = 'CFL';
SELECT pg_temp.expect_true('Required: someone without a qualification is stopped, with a message naming them and the test',
  training_gate_problem(pg_temp.tr_uid('tc.ana2'), (SELECT batch_id FROM tr_fx)) LIKE 'TC Analyst Two is not qualified for %');
SELECT pg_temp.expect_true('the qualified person is not', training_gate_problem(pg_temp.tr_uid('tc.ana'), (SELECT batch_id FROM tr_fx)) IS NULL);
UPDATE training_rule SET dept_trained_after = 1, unlock_any_test = true WHERE site_id = pg_temp.tr_site('CFL') AND department_id = (SELECT department_id FROM tr_fx);
-- a lapsed qualification (simulated: its last competency 7 months ago with a 6-month rule)
SELECT set_config('lims.training_internal', '1', false);
UPDATE analyst_qualification SET last_competency_at = now() - interval '7 months' WHERE user_id = pg_temp.tr_uid('tc.ana') AND status = 'Active';
SELECT set_config('lims.training_internal', '', false);
SELECT pg_temp.expect_true('Continuing competency overdue: the qualification is Lapsed, with the date it was due',
  (SELECT state = 'Lapsed' AND why LIKE 'Continuing competency was due %' FROM analyst_qualification_view WHERE user_id = pg_temp.tr_uid('tc.ana') AND status = 'Active'));
SELECT pg_temp.expect_true('Lapsed: the bench stops them (record continuing competency), and they are no longer department trained',
  training_gate_problem(pg_temp.tr_uid('tc.ana'), (SELECT batch_id FROM tr_fx)) LIKE '%has lapsed%continuing competency%'
  AND NOT department_trained(pg_temp.tr_uid('tc.ana'), pg_temp.tr_site('CFL'), (SELECT department_id FROM tr_fx)));
SELECT set_config('lims.training_internal', '1', false);
UPDATE analyst_qualification SET last_competency_at = now() - interval '5 months 20 days' WHERE user_id = pg_temp.tr_uid('tc.ana') AND status = 'Active';
SELECT set_config('lims.training_internal', '', false);
SELECT pg_temp.expect_true('Within 30 days of its due date: Due soon (still current at the bench)',
  (SELECT state = 'Due soon' FROM analyst_qualification_view WHERE user_id = pg_temp.tr_uid('tc.ana') AND status = 'Active')
  AND training_gate_problem(pg_temp.tr_uid('tc.ana'), (SELECT batch_id FROM tr_fx)) IS NULL);
UPDATE lab_site SET require_training = false WHERE site_code = 'CFL';

-------------------------------------------------------------------------------
-- 5. CONTINUING COMPETENCY BY RECORD (A CONDITIONAL PASS)
-------------------------------------------------------------------------------
-- Moved to the Java backend in migration 071 (JUnit: TrainingRulesTest.continuingAndFailing): a conditional pass says what it is conditional on; approved,
--   a continuing competency keeps the qualification up and records the condition; approving a fail grants nothing

-------------------------------------------------------------------------------
-- 6. TRAINING SAMPLES
-------------------------------------------------------------------------------
-- Moved to the Java backend in migration 071 (JUnit: TrainingRulesTest.trainingSamples): training samples need the known value of an analyte (1 to 10
--   samples); the known value plus or minus the tolerance is each sample's specification; evaluated only once every training sample has its approved
--   final result; withdrawing (a trainer or QA, with the reason) cancels the training sample tests not yet batched. The internal order and its TRN-
--   samples are made by the Java service (TrainingRepository.makeTrainingSamples); their price still comes from requested_test_derive.

-------------------------------------------------------------------------------
-- 7. LEGACY QUALIFICATIONS; WITHDRAWING; THE COUNTER; AUDIT
-------------------------------------------------------------------------------
-- Moved to the Java backend in migration 071 (JUnit: TrainingRulesTest.evidenceAndQualifications): legacy qualifications and withdrawing one are QA's
--   (training.approve, signed); withdrawing gives the reason. The Java service grants legacy qualifications (TrainingRepository.grantLegacy).
SELECT pg_temp.expect_true('The rolling counter: a person''s bench runs of a test (all time) and the last run',
  (SELECT x.runs >= 1 AND x.last_at IS NOT NULL FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id,
          LATERAL training_runs(r.performed_by, (SELECT test_id FROM tr_fx), pg_temp.tr_site('CFL'), NULL) x
    WHERE r.batch_id = (SELECT batch_id FROM tr_fx) AND r.completed_at IS NOT NULL AND r.performed_by IS NOT NULL AND ws.step_type::text <> 'QC Review' LIMIT 1));
-- fixture: QA withdraws tc.ana's qualification, as the Java service writes it
SELECT pg_temp.as_user('tc.qa');
UPDATE analyst_qualification SET status = 'Inactive', withdrawn_reason = 'Left the chemistry bench' WHERE user_id = pg_temp.tr_uid('tc.ana') AND status = 'Active';
SELECT pg_temp.expect_true('Withdrawn: kept, with the reason, no longer current',
  (SELECT state = 'Withdrawn' AND withdrawn_reason = 'Left the chemistry bench' FROM analyst_qualification_view WHERE user_id = pg_temp.tr_uid('tc.ana') AND status = 'Inactive')
  AND NOT qualification_current(pg_temp.tr_uid('tc.ana'), (SELECT test_id FROM tr_fx)));
SELECT pg_temp.expect_true('The audit trail names qualifications and attempts with links to the person and the attempt',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'analyst_qualification' AND (audit_record_ref(table_name, record_id, new_row)->>'link') LIKE '#/training/people/%')
  AND EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'competency_attempt' AND (audit_record_ref(table_name, record_id, new_row)->>'label') LIKE 'Competency TA-%'));
SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.as_user('akiddle');

SELECT test, outcome AS result FROM results;
