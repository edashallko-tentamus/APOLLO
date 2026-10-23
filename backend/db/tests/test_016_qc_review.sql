-- Verification for migration 018 (WD-3): QC Review. Continues the WD Metals version 3 batch of test_015 (readings
-- re-analysed, one sample re-prepped): the reviewer chooses the reportable readings, accepts failed QC with a
-- justification, returns the batch once, approves it (results stored and compared with the specification), and
-- cancels the re-prep batch (its samples go back to the backlog).
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Bench work', false);
SELECT set_config('lims.testing_internal', '', false);
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
CREATE OR REPLACE FUNCTION pg_temp.uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.an(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.v3() RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Metals' AND v.version_no = 3 $$;
CREATE OR REPLACE FUNCTION pg_temp.bb(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_batch WHERE test_version_id = pg_temp.v3() ORDER BY batch_code OFFSET n - 1 LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.rn(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.bb(1) AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.e(p int) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.bb(1) AND position = p $$;
CREATE OR REPLACE FUNCTION pg_temp.qe(lbl text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.bb(1) AND label = lbl $$;
CREATE OR REPLACE FUNCTION pg_temp.rt(p int) RETURNS uuid LANGUAGE sql AS $$ SELECT requested_test_id FROM batch_entry WHERE id = pg_temp.e(p) $$;
CREATE OR REPLACE FUNCTION pg_temp.problems() RETURNS text LANGUAGE sql AS $$ SELECT string_agg(problem, ' | ') FROM batch_review_problems(pg_temp.bb(1)) $$;

-- finish the bench work left open by test_015 (the re-analysed reading step and the calculation)
SELECT pg_temp.as_user('wd.ana');
-- WD-5: test_015's second re-analysis opened run 3 (its sample was then re-prepped): run 3's analytical QC is read, its
-- closing CCV fails for cadmium, and it has its own raw data and instrument
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num)
  SELECT pg_temp.rn('read'), e.id, a.id, 3, CASE WHEN e.label = 'CCV-3' AND a.analyte_name = 'WD Cadmium' THEN 60 ELSE 50 END
    FROM batch_entry e, analyte a WHERE e.batch_id = pg_temp.bb(1) AND e.qc_type IN ('ICV', 'CCV') AND a.analyte_name IN ('WD Lead', 'WD Cadmium');
INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('wd-icpms-run3.csv', 'text/csv', 0, '', convert_to('Sample,Pb,Cd', 'UTF8'));
INSERT INTO step_attachment (step_run_id, document_id, label, analytical_run_no) SELECT pg_temp.rn('read'), id, 'ICP-MS export, run 3', 3 FROM document_file WHERE file_name = 'wd-icpms-run3.csv';
INSERT INTO entry_equipment (step_run_id, equipment_id, analytical_run_no) SELECT pg_temp.rn('read'), id, 3 FROM equipment WHERE equipment_name = 'WD ICP-MS 1';
SELECT complete_step(pg_temp.rn('read'));
SELECT complete_step(pg_temp.rn('calc'));
SELECT pg_temp.expect_true('(the batch waits for review)', (SELECT status = 'Awaiting Review' FROM test_batch WHERE id = pg_temp.bb(1)));
SELECT pg_temp.expect_true('Reviewers: Lab Supervisor and QA hold testing.review; analysts do not',
  user_has_permission_at(pg_temp.uid('wd.sup'), 'testing.review', (SELECT site_id FROM test_batch WHERE id = pg_temp.bb(1)))
  AND user_has_permission_at(pg_temp.uid('wd.qa'), 'testing.review', (SELECT site_id FROM test_batch WHERE id = pg_temp.bb(1)))
  AND NOT user_has_permission_at(pg_temp.uid('wd.ana'), 'testing.review', (SELECT site_id FROM test_batch WHERE id = pg_temp.bb(1))));

-- what stops approval
SELECT pg_temp.expect_true('To resolve: the re-analysed sample needs its reportable reading chosen; failed QC (closing CCV, cadmium blank) needs accepting',
  pg_temp.problems() LIKE '%' || (SELECT label FROM batch_entry WHERE id = pg_temp.e(8)) || ' WD Lead: choose the reportable reading%'
  AND pg_temp.problems() LIKE '%CCV-3 WD Cadmium Recovery %: fail%' AND pg_temp.problems() LIKE '%Method Blank WD Cadmium Blank threshold: fail%'
  AND pg_temp.problems() NOT LIKE '%' || (SELECT label FROM batch_entry WHERE id = pg_temp.e(5)) || '%');
SELECT pg_temp.expect_true('A sample read once has its reading chosen automatically',
  (SELECT auto_chosen AND chosen_run_no = 1 FROM batch_review_items(pg_temp.bb(1)) WHERE requested_test_id = pg_temp.rt(5) AND analyte_id = pg_temp.an('WD Lead')));

-- who may review
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('An analyst cannot review (testing.review)', $$SELECT choose_result(pg_temp.bb(1), pg_temp.rt(8), pg_temp.an('WD Lead'), pg_temp.e(8), 2)$$, 'testing.review');
SELECT pg_temp.expect_error_like('Choices are made by the review, not written directly',
  $$INSERT INTO result_choice (batch_id, requested_test_id, analyte_id, entry_id, run_no) VALUES (pg_temp.bb(1), pg_temp.rt(8), pg_temp.an('WD Lead'), pg_temp.e(8), 2)$$, 'QC Review screen');
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.expect_error_like('A reading that is not this sample''s is refused', $$SELECT choose_result(pg_temp.bb(1), pg_temp.rt(8), pg_temp.an('WD Lead'), pg_temp.e(5), 1)$$, 'not a result');
SELECT pg_temp.expect_error_like('WD-5: picking one of several readings needs a justification',
  $$SELECT choose_result(pg_temp.bb(1), pg_temp.rt(8), pg_temp.an('WD Lead'), pg_temp.e(8), 1)$$, 'Write why');
SELECT pg_temp.expect_true('WD-5: the candidates are labelled by reading (RA1-, RA2-) and analytical run',
  (SELECT string_agg((x->>'label') || '/run ' || (x->>'run'), ', ' ORDER BY (x->>'run_no')::int) FROM batch_review_items(pg_temp.bb(1)) i, jsonb_array_elements(i.candidates) x
    WHERE i.requested_test_id = pg_temp.rt(8) AND i.analyte_id = pg_temp.an('WD Lead'))
  = (SELECT label FROM batch_entry WHERE id = pg_temp.e(8)) || '/run 1, RA1-' || (SELECT label FROM batch_entry WHERE id = pg_temp.e(8)) || '/run 2, RA2-' || (SELECT label FROM batch_entry WHERE id = pg_temp.e(8)) || '/run 2');
SELECT choose_result(pg_temp.bb(1), pg_temp.rt(8), pg_temp.an('WD Lead'), pg_temp.e(8), 1, 'First reading');
SELECT choose_result(pg_temp.bb(1), pg_temp.rt(8), pg_temp.an('WD Lead'), pg_temp.e(8), 2, 'Run 1 drifted (internal standard); run 2 is in control');
-- WD-5: report the average instead of one reading
SELECT pg_temp.expect_error_like('WD-5: an average needs at least two readings',
  $$SELECT average_results(pg_temp.bb(1), pg_temp.rt(8), pg_temp.an('WD Cadmium'), jsonb_build_array(jsonb_build_object('entry_id', pg_temp.e(8), 'run_no', 2)), 'x')$$, 'at least two');
SELECT pg_temp.expect_error_like('WD-5: leaving readings out of the average needs a justification',
  $$SELECT average_results(pg_temp.bb(1), pg_temp.rt(8), pg_temp.an('WD Cadmium'), jsonb_build_array(jsonb_build_object('entry_id', pg_temp.e(8), 'run_no', 2), jsonb_build_object('entry_id', pg_temp.e(8), 'run_no', 3)))$$, 'left out');
SELECT pg_temp.expect_error_like('WD-5: only this sample''s readings are averaged',
  $$SELECT average_results(pg_temp.bb(1), pg_temp.rt(8), pg_temp.an('WD Cadmium'), jsonb_build_array(jsonb_build_object('entry_id', pg_temp.e(8), 'run_no', 2), jsonb_build_object('entry_id', pg_temp.e(5), 'run_no', 1)), 'x')$$, 'Only numeric readings');
SELECT average_results(pg_temp.bb(1), pg_temp.rt(8), pg_temp.an('WD Cadmium'),
  jsonb_build_array(jsonb_build_object('entry_id', pg_temp.e(8), 'run_no', 2), jsonb_build_object('entry_id', pg_temp.e(8), 'run_no', 3)), 'Run 1 drifted; the two run 2 readings are averaged');
SELECT pg_temp.expect_true('WD-5: the average of the two run 2 readings (15.5 and 16) is reported, rounded as the test says',
  (SELECT mode = 'Average' AND value = 15.75 AND reported = '15.750' AND jsonb_array_length(readings) = 2 AND justification LIKE 'Run 1 drifted%'
     FROM batch_review_items(pg_temp.bb(1)) WHERE requested_test_id = pg_temp.rt(8) AND analyte_id = pg_temp.an('WD Cadmium')));
SELECT pg_temp.expect_true('WD-5: only the runs that hold a reported reading count for QC: run 3''s failing CCV (no reported reading) is not listed; run 1''s is',
  batch_used_runs(pg_temp.bb(1)) = '{1,2}' AND pg_temp.problems() NOT LIKE '%(run 3)%' AND pg_temp.problems() LIKE '%CCV-3 WD Cadmium Recovery %: fail%'
  AND EXISTS (SELECT 1 FROM batch_qc_verdicts(pg_temp.bb(1)) WHERE analytical_run = 3 AND verdict = 'Fail'));
SELECT pg_temp.expect_true('The reviewer chooses the reportable reading (a new choice replaces the old; every choice is audited)',
  (SELECT chosen_run_no = 2 AND NOT auto_chosen AND value = 16 FROM batch_review_items(pg_temp.bb(1)) WHERE requested_test_id = pg_temp.rt(8) AND analyte_id = pg_temp.an('WD Lead'))
  AND (SELECT count(*) FROM result_choice WHERE batch_id = pg_temp.bb(1) AND requested_test_id = pg_temp.rt(8) AND analyte_id = pg_temp.an('WD Lead')) = 2);
SELECT pg_temp.expect_error_like('Accepting failed QC needs a justification',
  $$SELECT accept_qc(pg_temp.bb(1), pg_temp.qe('CCV-3'), pg_temp.an('WD Cadmium'), 'Recovery %', '  ')$$, 'Write why');
SELECT pg_temp.expect_error_like('Only failed or waiting QC is accepted',
  $$SELECT accept_qc(pg_temp.bb(1), pg_temp.qe('ICV'), pg_temp.an('WD Lead'), 'Recovery %', 'fine')$$, 'Only a failed');

-- each step approved by the reviewer (migration 020): a recorded mark, not a signature
SELECT pg_temp.expect_true('Approval waits until every step is approved (the problems name the steps)',
  EXISTS (SELECT 1 FROM batch_review_problems(pg_temp.bb(1)) p WHERE p.problem LIKE 'Step "%not approved yet%'));
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('The analyst who did the work cannot approve a step', $$SELECT approve_review_step(pg_temp.rn('weigh'))$$, 'testing.review');
SELECT pg_temp.as_user('wd.sup');
SELECT approve_review_step(s.step_run_id) FROM review_step_runs(pg_temp.bb(1)) s;
SELECT pg_temp.expect_true('The reviewer approves each completed step (who and when are recorded)',
  NOT EXISTS (SELECT 1 FROM review_step_runs(pg_temp.bb(1)) WHERE mark_id IS NULL OR marked_by <> pg_temp.uid('wd.sup'))
  AND NOT EXISTS (SELECT 1 FROM batch_review_problems(pg_temp.bb(1)) p WHERE p.problem LIKE 'Step "%'));
SELECT withdraw_review_step(pg_temp.rn('weigh'));
SELECT pg_temp.expect_true('The reviewer can undo a step approval (it is kept in the audit trail)',
  (SELECT mark_id IS NULL FROM review_step_runs(pg_temp.bb(1)) WHERE step_run_id = pg_temp.rn('weigh'))
  AND EXISTS (SELECT 1 FROM review_step_mark WHERE step_run_id = pg_temp.rn('weigh') AND status = 'Inactive'));
SELECT approve_review_step(pg_temp.rn('weigh'));
SELECT pg_temp.expect_error_like('The QC Review step itself is approved with the batch, not as a step',
  $$SELECT approve_review_step((SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.bb(1) AND ws.step_type = 'QC Review' LIMIT 1))$$, 'Approve batch');

-- return to the analyst once
SELECT pg_temp.user_only('wd.sup');
SELECT pg_temp.expect_error_like('Returning needs a signature', $$SELECT return_batch(pg_temp.bb(1), pg_temp.rn('calc'))$$, 'electronic signature');
SELECT pg_temp.as_user('wd.sup');
SELECT set_config('lims.reason', 'Check the calculation inputs against the bench sheet', false);
SELECT return_batch(pg_temp.bb(1), pg_temp.rn('calc'));
SELECT pg_temp.expect_true('Returned: the calculation reopens with the reviewer''s reason; the batch is back with the analyst',
  (SELECT status = 'In progress' FROM step_run WHERE id = pg_temp.rn('calc')) AND (SELECT status = 'Completed' FROM step_run WHERE id = pg_temp.rn('read'))
  AND (SELECT status = 'In Progress' AND returned_by = pg_temp.uid('wd.sup') AND returned_reason LIKE 'Check the calculation%' FROM test_batch WHERE id = pg_temp.bb(1)));
SELECT pg_temp.expect_true('Returning withdraws the approval of the reopened step; the steps before it keep theirs',
  (SELECT mark_id IS NULL FROM review_step_runs(pg_temp.bb(1)) WHERE step_run_id = pg_temp.rn('calc'))
  AND (SELECT mark_id IS NOT NULL FROM review_step_runs(pg_temp.bb(1)) WHERE step_run_id = pg_temp.rn('read'))
  AND (SELECT mark_id IS NOT NULL FROM review_step_runs(pg_temp.bb(1)) WHERE step_run_id = pg_temp.rn('weigh')));
SELECT pg_temp.as_user('wd.ana');
SELECT set_config('lims.reason', 'Bench work', false);
SELECT complete_step(pg_temp.rn('calc'));
SELECT pg_temp.expect_true('Back for review; the reviewer''s choices are kept', (SELECT status = 'Awaiting Review' FROM test_batch WHERE id = pg_temp.bb(1))
  AND (SELECT chosen_run_no = 2 FROM batch_review_items(pg_temp.bb(1)) WHERE requested_test_id = pg_temp.rt(8) AND analyte_id = pg_temp.an('WD Lead')));

-- accept the failed QC, approve
SELECT pg_temp.as_user('wd.sup');
SELECT accept_qc(pg_temp.bb(1), v.entry_id, v.analyte_id, v.limit_type, 'Closing CCV high after the samples were read; samples bracketed by passing CCVs (SOP 7.4)', v.analytical_run)
  FROM batch_qc_verdicts(pg_temp.bb(1)) v WHERE v.verdict IN ('Fail', 'Waiting') AND qc_verdict_counts(v.entry_id, v.analytical_run, batch_used_runs(pg_temp.bb(1)));
SELECT pg_temp.expect_true('After the return, only the reopened step needs approving again',
  (SELECT count(*) FROM batch_review_problems(pg_temp.bb(1)) p WHERE p.problem LIKE 'Step "%') = 1);
SELECT approve_review_step(s.step_run_id) FROM review_step_runs(pg_temp.bb(1)) s WHERE s.mark_id IS NULL;
SELECT pg_temp.expect_true('Nothing left to resolve', pg_temp.problems() IS NULL);
-- the analyst who did the bench work is also made a reviewer (QA group): still cannot review their own batch
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.uid('wd.ana') FROM lab_group g JOIN lab_site s ON s.id = g.site_id WHERE s.site_code = 'CFL' AND g.group_name = 'QA';
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('Someone who performed a step of the batch cannot review it, even with testing.review',
  $$SELECT approve_batch(pg_temp.bb(1))$$, 'someone else must review');
SELECT pg_temp.as_user('akiddle');
UPDATE group_member SET status = 'Inactive' WHERE user_id = pg_temp.uid('wd.ana') AND group_id = (SELECT g.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id WHERE s.site_code = 'CFL' AND g.group_name = 'QA');
SELECT pg_temp.user_only('wd.sup');
SELECT pg_temp.expect_error_like('Approval needs a signature', $$SELECT approve_batch(pg_temp.bb(1))$$, 'electronic signature');
SELECT pg_temp.as_user('wd.sup');
SELECT approve_batch(pg_temp.bb(1));
SELECT pg_temp.expect_true('Approved: one stored result per sample and analyte (the chosen readings), signed by the reviewer',
  (SELECT count(*) FROM test_result WHERE batch_id = pg_temp.bb(1) AND status = 'Active') = 4
  AND (SELECT value_num = 16 AND run_no = 2 AND reported = '16.0' AND approved_by = pg_temp.uid('wd.sup') AND signature_id IS NOT NULL AND basis = 'Picked' AND stage = 'Final'
         FROM test_result WHERE requested_test_id = pg_temp.rt(8) AND analyte_id = pg_temp.an('WD Lead') AND status = 'Active')
  AND (SELECT basis = 'Average' AND value_num = 15.75 AND jsonb_array_length(averaged) = 2 AND justification LIKE 'Run 1 drifted%'
         FROM test_result WHERE requested_test_id = pg_temp.rt(8) AND analyte_id = pg_temp.an('WD Cadmium') AND status = 'Active')
  AND (SELECT status = 'Approved' AND reviewed_by = pg_temp.uid('wd.sup') FROM test_batch WHERE id = pg_temp.bb(1))
  AND (SELECT r.status = 'Completed' AND r.performed_by = pg_temp.uid('wd.sup') FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.bb(1) AND ws.step_type = 'QC Review'));
SELECT pg_temp.expect_true('Results are compared with the sample''s specification: lead 10 against the client''s 0.5 mg/kg does not conform; cadmium has none',
  (SELECT conformance = 'Does not conform' AND spec_max = 0.5 FROM test_result WHERE requested_test_id = pg_temp.rt(5) AND analyte_id = pg_temp.an('WD Lead'))
  AND (SELECT conformance = 'No specification' FROM test_result WHERE requested_test_id = pg_temp.rt(5) AND analyte_id = pg_temp.an('WD Cadmium')));
SELECT pg_temp.expect_true('The QC accepted keeps its justification and the verdict it had', (SELECT count(*) FROM qc_acceptance WHERE batch_id = pg_temp.bb(1) AND verdict = 'Fail' AND justification LIKE 'Closing CCV%') >= 3);
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('An approved batch is locked', $$UPDATE step_run SET notes = 'late note' WHERE id = pg_temp.rn('weigh')$$, 'Approved');
SELECT pg_temp.expect_error_like('Results are only stored by approval', $$UPDATE test_result SET reported = '1' WHERE batch_id = pg_temp.bb(1)$$, 'QC Review screen');
SELECT pg_temp.expect_true('The order is In Testing (its other tests are not finished)',
  (SELECT o.status::text = 'In Testing' FROM lab_order o JOIN sample s ON s.lab_order_id = o.id JOIN requested_test rt ON rt.sample_id = s.id WHERE rt.id = pg_temp.rt(5)));

-- specification comparison rules
SELECT pg_temp.expect_true('Comparison: the reported (rounded) value; "< LOQ" and ND are below a maximum and fail a minimum; text limits fail on a found result',
  (SELECT conformance FROM spec_conformance(pg_temp.rt(5), pg_temp.an('WD Lead'), 0.5004, NULL, '0.500', 'mg/kg', NULL)) = 'Conforms'
  AND (SELECT conformance FROM spec_conformance(pg_temp.rt(5), pg_temp.an('WD Lead'), 0.004, NULL, '< 0.010', 'mg/kg', NULL)) = 'Conforms'
  AND (SELECT conformance FROM spec_conformance(pg_temp.rt(5), pg_temp.an('WD Lead'), 0.51, NULL, '0.510', 'mg/kg', NULL)) = 'Does not conform'
  AND (SELECT conformance FROM spec_conformance(pg_temp.rt(5), pg_temp.an('WD Lead'), 500, NULL, '500', 'µg/kg', NULL)) = 'Conforms');

-- cancel the re-prep batch
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('An analyst cannot cancel a batch', $$SELECT cancel_batch(pg_temp.bb(2))$$, 'testing.assign or testing.review');
SELECT pg_temp.as_user('wd.sup');
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error_like('Cancelling needs a reason', $$SELECT cancel_batch(pg_temp.bb(2))$$, 'why');
SELECT set_config('lims.reason', 'Digester out of service; rebatch tomorrow', false);
SELECT cancel_batch(pg_temp.bb(2));
SELECT pg_temp.expect_true('Cancelled: the re-prep goes back to the top of the backlog and the other sample back to the backlog',
  (SELECT status = 'Cancelled' AND cancelled_reason LIKE 'Digester%' FROM test_batch WHERE id = pg_temp.bb(2))
  AND EXISTS (SELECT 1 FROM test_pool_view WHERE kind = 'Re-prep' AND test_version_id = pg_temp.v3())
  AND (SELECT count(*) FROM reprep_request WHERE batch_id = pg_temp.bb(2)) = 0);
SELECT pg_temp.expect_error_like('An approved batch cannot be cancelled', $$SELECT cancel_batch(pg_temp.bb(1))$$, 'already approved');

SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
