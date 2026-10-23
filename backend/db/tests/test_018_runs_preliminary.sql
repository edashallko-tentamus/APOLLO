-- Verification for migration 021 (WD-5): preliminary release of a timepoint (day 7) before the final result, the
-- steps that fed it locked, the final approval carrying it over; analytical runs on the second reading with the
-- average reported; the order statuses In Review and Approved; a split-off step that needs no customer consent.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Bench work', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.methods_internal', '', false);
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
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.wdc() RETURNS uuid LANGUAGE sql AS $$ SELECT d.id FROM department d WHERE d.site_id = pg_temp.cfl() AND d.department_code = 'WDC' $$;
CREATE OR REPLACE FUNCTION pg_temp.lead() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = 'WD Lead' $$;
CREATE OR REPLACE FUNCTION pg_temp.tv(n text) RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = n ORDER BY v.version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.st(n text, k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_step WHERE test_version_id = pg_temp.tv(n) AND step_key = k AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.sb() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_batch WHERE test_version_id = pg_temp.tv('WD Stability') ORDER BY batch_code LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.sr(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.sb() AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.se() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.sb() AND entry_type = 'Sample' LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.srt() RETURNS uuid LANGUAGE sql AS $$ SELECT requested_test_id FROM batch_entry WHERE id = pg_temp.se() $$;
CREATE OR REPLACE FUNCTION pg_temp.sorder() RETURNS lab_order_status LANGUAGE sql AS $$
  SELECT o.status FROM lab_order o JOIN sample s ON s.lab_order_id = o.id WHERE s.client_sample_id = 'WD-STAB-1' $$;

-- set-up: a two-timepoint test (day 7 released on its own, day 14 the final result), and a fast screen whose split-off
-- needs no consent; both approved, quoted and ordered on new samples of their own orders
SELECT pg_temp.as_user('wd.ana');
SELECT create_test(pg_temp.cfl(), 'WD Stability', pg_temp.wdc(), (SELECT id FROM method WHERE method_name = 'WD Elemental impurities by ICP-MS' AND site_id = pg_temp.cfl() LIMIT 1));
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, loq, lod) VALUES (pg_temp.tv('WD Stability'), pg_temp.lead(), 1, 'Numeric', 'mg/kg', 0.010, 0.005);
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.tv('WD Stability'), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 5, "qc": []}'),
 (pg_temp.tv('WD Stability'), 'read_7', 'Day 7: read', 'Data Entry', 2, '{"value_label": "Reading", "require_attachment": false}'),
 (pg_temp.tv('WD Stability'), 'calc_7', 'Day 7: result', 'Calculation', 3, '{"formula": "{read_7.reading} * 2", "result_unit": "mg/kg"}'),
 (pg_temp.tv('WD Stability'), 'rv_7', 'Day 7: QC Review', 'QC Review', 4, '{"scope": "Timepoint"}'),
 (pg_temp.tv('WD Stability'), 'read_14', 'Day 14: read', 'Data Entry', 5, '{"value_label": "Reading", "require_attachment": false}'),
 (pg_temp.tv('WD Stability'), 'calc_14', 'Day 14: result', 'Calculation', 6, '{"formula": "{read_14.reading} * 2"}'),
 (pg_temp.tv('WD Stability'), 'review', 'QC Review', 'QC Review', 7, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id, dependency_type) VALUES
 (pg_temp.st('WD Stability', 'read_7'), pg_temp.st('WD Stability', 'batch'), 'Sequential'),
 (pg_temp.st('WD Stability', 'calc_7'), pg_temp.st('WD Stability', 'read_7'), 'Sequential'),
 (pg_temp.st('WD Stability', 'rv_7'), pg_temp.st('WD Stability', 'calc_7'), 'Parallel'),
 (pg_temp.st('WD Stability', 'read_14'), pg_temp.st('WD Stability', 'read_7'), 'Sequential'),
 (pg_temp.st('WD Stability', 'calc_14'), pg_temp.st('WD Stability', 'read_14'), 'Sequential'),
 (pg_temp.st('WD Stability', 'review'), pg_temp.st('WD Stability', 'calc_14'), 'Sequential');
SELECT create_test(pg_temp.cfl(), 'WD Split Fast', pg_temp.wdc(), (SELECT id FROM method WHERE method_name = 'WD Elemental impurities by ICP-MS' AND site_id = pg_temp.cfl() LIMIT 1));
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, result_values, found_values)
VALUES (pg_temp.tv('WD Split Fast'), (SELECT id FROM analyte WHERE analyte_name = 'WD Salmonella'), 1, 'Qualitative', '{ND,D}', '{D}');
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.tv('WD Split Fast'), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 5, "qc": []}'),
 (pg_temp.tv('WD Split Fast'), 'read', 'Read', 'Data Entry', 2, '{"value_label": "Reading", "require_attachment": false}'),
 (pg_temp.tv('WD Split Fast'), 'ident', 'Identification', 'Split off Test', 3, jsonb_build_object('test_id', (SELECT id FROM test WHERE test_name = 'WD Micro P/A'), 'trigger', 'On finding',
    'finding', 'Present', 'finding_steps', '["read"]'::jsonb, 'consent_required', false)),
 (pg_temp.tv('WD Split Fast'), 'review', 'QC Review', 'QC Review', 4, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES
 (pg_temp.st('WD Split Fast', 'read'), pg_temp.st('WD Split Fast', 'batch')), (pg_temp.st('WD Split Fast', 'ident'), pg_temp.st('WD Split Fast', 'read')),
 (pg_temp.st('WD Split Fast', 'review'), pg_temp.st('WD Split Fast', 'ident'));
SELECT pg_temp.expect_true('(both tests have no errors)', NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.tv('WD Stability')) WHERE severity = 'Error')
  AND NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.tv('WD Split Fast')) WHERE severity = 'Error'));
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.tv('WD Stability'));
SELECT approve_test_version(pg_temp.tv('WD Split Fast'));
SELECT pg_temp.as_user('akiddle');
UPDATE test_catalog_entry SET base_price = 50 WHERE test_id IN (SELECT id FROM test WHERE test_name IN ('WD Stability', 'WD Split Fast'));
INSERT INTO project (client_id, project_name) SELECT client_id, 'WD Stability project' FROM lab_order WHERE order_code = 'LO-000003';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'WD Stability project'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price)
  SELECT pv.id, x.id, 3, 50 FROM project_version pv JOIN project p ON p.id = pv.project_id, test x WHERE p.project_name = 'WD Stability project' AND x.test_name IN ('WD Stability', 'WD Split Fast');
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Stability project');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam@acme.com') WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Stability project');
INSERT INTO lab_order (client_id, site_id, ordering_contact_id, po_number)
  SELECT client_id, site_id, ordering_contact_id, x.po FROM lab_order, (VALUES ('WD-PO-STAB'), ('WD-PO-SPLIT')) AS x(po) WHERE order_code = 'LO-000003';
INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, quantity_received, quantity_unit, number_of_units)
  SELECT o.id, x.cid, 'Test product', 'Powder', 100, 'g', 1 FROM lab_order o JOIN (VALUES ('WD-PO-STAB', 'WD-STAB-1'), ('WD-PO-SPLIT', 'WD-SPLIT-1')) AS x(po, cid) ON x.po = o.po_number;
SELECT order_test(s.id, (SELECT q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id
                          JOIN test t ON t.id = q.test_id WHERE p.project_name = 'WD Stability project' AND t.test_name = x.tn))
  FROM sample s JOIN (VALUES ('WD-STAB-1', 'WD Stability'), ('WD-SPLIT-1', 'WD Split Fast')) AS x(cid, tn) ON x.cid = s.client_sample_id;
SELECT log_samples(ARRAY(SELECT id FROM sample WHERE client_sample_id IN ('WD-STAB-1', 'WD-SPLIT-1')));

-- the bench: batch and day 7 done; the batch is still in progress (day 14 is ahead)
SELECT pg_temp.as_user('wd.ana');
SELECT create_batch(pg_temp.cfl(), pg_temp.tv('WD Stability'));
SELECT complete_step(pg_temp.sr('batch'));
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) VALUES (pg_temp.sr('read_7'), pg_temp.se(), pg_temp.lead(), 5);
SELECT complete_step(pg_temp.sr('read_7'));
SELECT complete_step(pg_temp.sr('calc_7'));
SELECT pg_temp.expect_true('Order status: In Testing once its test is batched', pg_temp.sorder() = 'In Testing');
SELECT pg_temp.expect_true('Day 7 is a timepoint review: ready once the steps before it are completed, releasing the day 7 result (not the final one)',
  (SELECT ready AND NOT released AND keys = '{calc_7}' FROM batch_timepoints(pg_temp.sb()) WHERE step_key = 'rv_7')
  AND (SELECT count(*) FROM batch_timepoints(pg_temp.sb())) = 1
  AND (SELECT status = 'In Progress' FROM test_batch WHERE id = pg_temp.sb()));

-- releasing day 7
SELECT pg_temp.expect_error_like('Only a reviewer (testing.review) releases a timepoint', $$SELECT release_timepoint(pg_temp.sr('rv_7'))$$, 'testing.review');
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.expect_error_like('The steps before the timepoint are each approved first', $$SELECT release_timepoint(pg_temp.sr('rv_7'))$$, 'not approved yet');
SELECT approve_review_step(pg_temp.sr('batch')), approve_review_step(pg_temp.sr('read_7')), approve_review_step(pg_temp.sr('calc_7'));
SELECT pg_temp.expect_error_like('A step that does not feed a ready timepoint waits for the final review',
  $$SELECT approve_review_step(pg_temp.sr('read_14'))$$, 'steps are approved once');
SELECT pg_temp.expect_error_like('The final QC Review is not a timepoint release', $$SELECT release_timepoint(pg_temp.sr('review'))$$, 'Only a timepoint review');
SELECT pg_temp.user_only('wd.sup');
SELECT pg_temp.expect_error_like('Releasing needs a signature', $$SELECT release_timepoint(pg_temp.sr('rv_7'))$$, 'electronic signature');
SELECT pg_temp.as_user('wd.sup');
CREATE TEMP TABLE wd_rel AS SELECT release_timepoint(pg_temp.sr('rv_7')) AS n;
SELECT pg_temp.expect_true('Released: one preliminary result (day 7: 5 x 2 = 10 mg/kg), signed by the reviewer; the day 7 review is completed',
  (SELECT n FROM wd_rel) = 1
  AND (SELECT stage = 'Preliminary' AND result_key = 'calc_7' AND value_num = 10 AND basis = 'Single' AND signature_id IS NOT NULL AND approved_by = pg_temp.uid('wd.sup')
         AND released_step_run_id = pg_temp.sr('rv_7') FROM test_result WHERE requested_test_id = pg_temp.srt() AND status = 'Active')
  AND (SELECT status = 'Completed' AND performed_by = pg_temp.uid('wd.sup') FROM step_run WHERE id = pg_temp.sr('rv_7'))
  AND (SELECT result_name = 'Day 7: result' AND released_by_step = 'Day 7: QC Review' FROM test_result_view WHERE requested_test_id = pg_temp.srt() AND status = 'Active'));
SELECT pg_temp.expect_error_like('A timepoint is released once', $$SELECT release_timepoint(pg_temp.sr('rv_7'))$$, 'already released');
SELECT pg_temp.expect_true('A preliminary result does not make the order Approved', pg_temp.sorder() = 'In Testing');
SELECT pg_temp.expect_error_like('The approval of a step that fed released results stands', $$SELECT withdraw_review_step(pg_temp.sr('read_7'))$$, 'its approval stands');
SELECT pg_temp.as_user('wd.ana');
SELECT set_config('lims.reason', 'Typo', false);
SELECT pg_temp.expect_error_like('A step that fed released results cannot be reopened', $$SELECT reopen_step(pg_temp.sr('calc_7'))$$, 'already released as preliminary');
SELECT pg_temp.expect_error_like('Nor read again in a new analytical run', $$SELECT add_analytical_run(pg_temp.sr('read_7'), ARRAY[pg_temp.se()], 1)$$, 'already released as preliminary');
SELECT pg_temp.as_user('wd.sup');
SELECT set_config('lims.reason', 'Instrument down', false);
SELECT pg_temp.expect_error_like('A batch with released results cannot be cancelled', $$SELECT cancel_batch(pg_temp.sb())$$, 'preliminary results');

-- day 14, read in two analytical runs (the second in duplicate)
SELECT pg_temp.as_user('wd.ana');
SELECT set_config('lims.reason', 'Bench work', false);
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) VALUES (pg_temp.sr('read_14'), pg_temp.se(), pg_temp.lead(), 6);
SELECT pg_temp.expect_error_like('A new run names the samples to read again', $$SELECT add_analytical_run(pg_temp.sr('read_14'), '{}'::uuid[], 2)$$, 'Choose the samples');
SELECT set_config('lims.reason', 'Low internal standard recovery', false);
SELECT pg_temp.expect_true('Analytical run 2 added at day 14', add_analytical_run(pg_temp.sr('read_14'), ARRAY[pg_temp.se()], 2) = 2);
SELECT set_config('lims.reason', 'Bench work', false);
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num) VALUES (pg_temp.sr('read_14'), pg_temp.se(), pg_temp.lead(), 2, 6.2), (pg_temp.sr('read_14'), pg_temp.se(), pg_temp.lead(), 3, 6.4);
SELECT complete_step(pg_temp.sr('read_14'));
SELECT complete_step(pg_temp.sr('calc_14'));
SELECT pg_temp.expect_true('Order status: In Review when no test is left at the bench and a batch waits for QC Review', pg_temp.sorder() = 'In Review');

-- the final review: the three day 14 readings averaged; day 7 is carried over
SELECT pg_temp.as_user('wd.sup');
SELECT approve_review_step(s.step_run_id) FROM review_step_runs(pg_temp.sb()) s WHERE s.mark_id IS NULL;
SELECT pg_temp.expect_true('The final review lists the three day 14 readings (RA1-, RA2-) and nothing for day 7 (released)',
  (SELECT string_agg(problem, ' | ') FROM batch_review_problems(pg_temp.sb())) LIKE '%choose the reportable reading%'
  AND (SELECT string_agg(problem, ' | ') FROM batch_review_problems(pg_temp.sb())) NOT LIKE '%Day 7%'
  AND (SELECT jsonb_array_length(candidates) FROM batch_review_items(pg_temp.sb())) = 3);
SELECT average_results(pg_temp.sb(), pg_temp.srt(), pg_temp.lead(), (SELECT jsonb_agg(jsonb_build_object('entry_id', x->>'entry_id', 'run_no', (x->>'run_no')::int)) FROM batch_review_items(pg_temp.sb()) i, jsonb_array_elements(i.candidates) x));
SELECT pg_temp.expect_true('Averaging every reading needs no justification (12, 12.4, 12.8: 12.4)', (SELECT mode = 'Average' AND value = 12.4 FROM batch_review_items(pg_temp.sb())));
SELECT approve_batch(pg_temp.sb());
SELECT pg_temp.expect_true('Approved: the final result (average) and day 7 carried into the final unchanged; the preliminary row is superseded, kept for the record',
  (SELECT stage = 'Final' AND basis = 'Average' AND value_num = 12.4 FROM test_result WHERE requested_test_id = pg_temp.srt() AND result_key IS NULL AND status = 'Active')
  AND (SELECT stage = 'Final' AND value_num = 10 AND carried_from_id IS NOT NULL AND released_step_run_id = pg_temp.sr('rv_7')
         FROM test_result WHERE requested_test_id = pg_temp.srt() AND result_key = 'calc_7' AND status = 'Active')
  AND (SELECT status = 'Superseded' FROM test_result WHERE requested_test_id = pg_temp.srt() AND result_key = 'calc_7' AND stage = 'Preliminary'));
SELECT pg_temp.expect_true('Order status: Approved when every test has final results', pg_temp.sorder() = 'Approved');

-- split off without consent: the identification is ordered at once from the client's accepted quote
SELECT pg_temp.as_user('wd.ana');
SELECT create_batch(pg_temp.cfl(), pg_temp.tv('WD Split Fast'));
SELECT complete_step(r.id) FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id JOIN test_batch b ON b.id = r.batch_id WHERE b.test_version_id = pg_temp.tv('WD Split Fast') AND ws.step_key = 'batch';
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_text)
  SELECT r.id, e.id, (SELECT id FROM analyte WHERE analyte_name = 'WD Salmonella'), 'D' FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id JOIN test_batch b ON b.id = r.batch_id
    JOIN batch_entry e ON e.batch_id = b.id WHERE b.test_version_id = pg_temp.tv('WD Split Fast') AND ws.step_key = 'read';
SELECT complete_step(r.id) FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id JOIN test_batch b ON b.id = r.batch_id WHERE b.test_version_id = pg_temp.tv('WD Split Fast') AND ws.step_key = 'read';
SELECT complete_step(r.id) FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id JOIN test_batch b ON b.id = r.batch_id WHERE b.test_version_id = pg_temp.tv('WD Split Fast') AND ws.step_key = 'ident';
SELECT pg_temp.expect_true('Split off with consent switched off: the test is ordered at once from the accepted quote when the analyst completes the step',
  (SELECT s.status = 'Ordered' AND s.ordered_requested_test_id IS NOT NULL AND s.decision_note LIKE 'Customer consent not needed%' FROM split_request s JOIN sample sm ON sm.id = s.sample_id WHERE sm.client_sample_id = 'WD-SPLIT-1')
  AND EXISTS (SELECT 1 FROM requested_test rt JOIN sample sm ON sm.id = rt.sample_id JOIN test t ON t.id = rt.test_id WHERE sm.client_sample_id = 'WD-SPLIT-1' AND t.test_name = 'WD Micro P/A')
  );

SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
