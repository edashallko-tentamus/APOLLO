-- Verification for migration 048: a dilution for each analytical run, and the analyst's pick of the reported reading.
-- One sample of a small test (weigh, dilute, read, result = reading x dilution factor): run 1 read at 1 + 9 (x10);
-- over range, so it is diluted a further 1 + 9 and read again in run 2 (x100). Each reading keeps its own run's factor.
-- The analyst picks run 2 with a note; QC Review reports it unless the reviewer chooses otherwise.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Bench work', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.methods_internal', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (wrong error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'PASS');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'FAIL: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.lead() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = 'WD Lead' $$;
CREATE OR REPLACE FUNCTION pg_temp.dv() RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Run Dilution' ORDER BY v.version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.dst(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_step WHERE test_version_id = pg_temp.dv() AND step_key = k AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.dbb() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_batch WHERE test_version_id = pg_temp.dv() ORDER BY batch_code LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.drun(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.dbb() AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.dsmp() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.dbb() AND entry_type = 'Sample' $$;
CREATE OR REPLACE FUNCTION pg_temp.dres(rn integer) RETURNS numeric LANGUAGE sql AS $$
  SELECT value FROM batch_results(pg_temp.dbb()) WHERE entry_id = pg_temp.dsmp() AND run_no = rn AND is_final $$;
CREATE OR REPLACE FUNCTION pg_temp.ditem(OUT chosen_run_no integer, OUT value numeric, OUT justification text, OUT auto_chosen boolean) LANGUAGE sql AS $$
  SELECT chosen_run_no, value, justification, auto_chosen FROM batch_review_items(pg_temp.dbb()) LIMIT 1 $$;

-- set-up: the test, approved, quoted and ordered on one new sample
SELECT pg_temp.as_user('wd.ana');
SELECT create_test(pg_temp.cfl(), 'WD Run Dilution', (SELECT d.id FROM department d WHERE d.site_id = pg_temp.cfl() AND d.department_code = 'WDC'),
  (SELECT id FROM method WHERE method_name = 'WD Elemental impurities by ICP-MS' AND site_id = pg_temp.cfl() LIMIT 1));
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, loq, lod) VALUES (pg_temp.dv(), pg_temp.lead(), 1, 'Numeric', 'mg/kg', 0.010, 0.005);
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.dv(), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 5, "qc": []}'),
 (pg_temp.dv(), 'weigh', 'Weigh', 'Weighing', 2, '{"target_mode": "None", "unit": "g"}'),
 (pg_temp.dv(), 'dilute', 'Dilute', 'Dilution', 3, '{"mode": "Single", "aliquot": 1, "diluent": 9, "fields_per_entry": 2}'),
 (pg_temp.dv(), 'read', 'Read', 'Data Entry', 4, '{"value_label": "Lead", "value_unit": "mg/L", "require_attachment": false}'),
 (pg_temp.dv(), 'calc', 'Result', 'Calculation', 5, '{"formula": "{read.reading} * {dilute.factor}"}'),
 (pg_temp.dv(), 'review', 'QC Review', 'QC Review', 6, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES
 (pg_temp.dst('weigh'), pg_temp.dst('batch')), (pg_temp.dst('dilute'), pg_temp.dst('weigh')), (pg_temp.dst('read'), pg_temp.dst('dilute')),
 (pg_temp.dst('calc'), pg_temp.dst('read')), (pg_temp.dst('review'), pg_temp.dst('calc'));
INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) SELECT pg_temp.dst('weigh'), id, true FROM equipment_type WHERE site_id = pg_temp.cfl() AND type_name = 'WD Balance';
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.dv());
SELECT pg_temp.as_user('akiddle');
UPDATE test_catalog_entry SET base_price = 50 WHERE test_id = (SELECT id FROM test WHERE test_name = 'WD Run Dilution');
INSERT INTO project (client_id, project_name) SELECT client_id, 'WD Dilution project' FROM lab_order WHERE order_code = 'LO-000003';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'WD Dilution project'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price)
  SELECT pv.id, x.id, 3, 50 FROM project_version pv JOIN project p ON p.id = pv.project_id, test x WHERE p.project_name = 'WD Dilution project' AND x.test_name = 'WD Run Dilution';
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Dilution project');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam@acme.com') WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Dilution project');
INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, quantity_received, quantity_unit, number_of_units)
  SELECT id, 'WD-DIL-1', 'Test product', 'Powder', 100, 'g', 1 FROM lab_order WHERE po_number = 'WD-PO-SPLIT';
SELECT order_test((SELECT id FROM sample WHERE client_sample_id = 'WD-DIL-1'),
  (SELECT q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id WHERE p.project_name = 'WD Dilution project'));
SELECT log_samples(ARRAY(SELECT id FROM sample WHERE client_sample_id = 'WD-DIL-1'));

-- the bench: run 1 at 1 + 9 (x10), reading 50 -> 500
SELECT pg_temp.as_user('wd.ana');
SELECT create_batch(pg_temp.cfl(), pg_temp.dv());
SELECT complete_step(pg_temp.drun('batch'));
INSERT INTO entry_value (step_run_id, entry_id, value_num) VALUES (pg_temp.drun('weigh'), pg_temp.dsmp(), 0.5);
INSERT INTO entry_equipment (step_run_id, equipment_id) SELECT pg_temp.drun('weigh'), id FROM equipment WHERE equipment_name = 'WD Balance 1';
SELECT complete_step(pg_temp.drun('weigh'));
INSERT INTO entry_value (step_run_id, entry_id, data) VALUES (pg_temp.drun('dilute'), pg_temp.dsmp(), '{"fields": [{"aliquot": 1, "diluent": 9}]}');
SELECT complete_step(pg_temp.drun('dilute'));
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) VALUES (pg_temp.drun('read'), pg_temp.dsmp(), pg_temp.lead(), 50);
SELECT pg_temp.expect_true('Run 1: reading 50 at x10 gives 500', pg_temp.dres(1) = 500);

-- over range: diluted a further 1 + 9 and read again in run 2
SELECT set_config('lims.reason', 'Over the calibration range: diluted further', false);
SELECT pg_temp.expect_error_like('A further dilution needs an aliquot above zero', $$SELECT add_analytical_run_diluted(pg_temp.drun('read'), ARRAY[pg_temp.dsmp()], 1, 0, 9)$$, 'aliquot above zero');
SELECT pg_temp.expect_true('Run 2 is added with the further dilution (signed with the run)', add_analytical_run_diluted(pg_temp.drun('read'), ARRAY[pg_temp.dsmp()], 1, 1, 9) = 2);
SELECT set_config('lims.reason', 'Bench work', false);
SELECT pg_temp.expect_true('... the sample''s dilution for run 2 is run 1''s with one more 1 + 9 (factor 100), kept beside run 1''s',
  dilution_factor(entry_dilution_data(pg_temp.drun('dilute'), pg_temp.dsmp(), 2)) = 100 AND dilution_factor(entry_dilution_data(pg_temp.drun('dilute'), pg_temp.dsmp(), 1)) = 10
  AND (SELECT count(*) FROM entry_value WHERE step_run_id = pg_temp.drun('dilute') AND entry_id = pg_temp.dsmp() AND status = 'Active') = 2);
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num) VALUES (pg_temp.drun('read'), pg_temp.dsmp(), pg_temp.lead(), 2, 4.8);
SELECT pg_temp.expect_true('Each reading keeps its own run''s dilution: run 1 still 500 (x10), run 2 480 (x100)', pg_temp.dres(1) = 500 AND pg_temp.dres(2) = 480);
SELECT set_config('lims.testing_internal', '1', false);
SELECT pg_temp.expect_error_like('A dilution for a run that does not exist is refused',
  $$INSERT INTO entry_value (step_run_id, entry_id, run_no, data) VALUES (pg_temp.drun('dilute'), pg_temp.dsmp(), 3, '{"fields": [{"aliquot": 1, "diluent": 1}]}')$$, 'does not exist');
SELECT set_config('lims.testing_internal', '', false);

-- the analyst's pick
SELECT pg_temp.expect_true('Two readings and nobody has picked: QC Review waits for a choice', (pg_temp.ditem()).chosen_run_no IS NULL);
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('A pick needs a note', $$SELECT set_analyst_pick(pg_temp.dsmp(), 2, NULL, ' ')$$, 'Say why');
SELECT pg_temp.expect_error_like('Only a reading that exists', $$SELECT set_analyst_pick(pg_temp.dsmp(), 3, NULL, 'x')$$, 'does not exist');
SELECT pg_temp.expect_error_like('Readings are picked for samples, not records changed by hand', $$INSERT INTO analyst_pick (batch_id, requested_test_id, entry_id, run_no, note)
  SELECT batch_id, requested_test_id, id, 1, 'x' FROM batch_entry WHERE id = pg_temp.dsmp()$$, '');
SELECT pg_temp.expect_ok('The analyst picks run 2: run 1 was over the calibration range', $$SELECT set_analyst_pick(pg_temp.dsmp(), 2, NULL, 'Run 1 over the calibration range; run 2 diluted x100')$$);
SELECT pg_temp.expect_true('QC Review reports run 2 (480), with the analyst''s note', (pg_temp.ditem()).chosen_run_no = 2 AND (pg_temp.ditem()).value = 480
  AND (pg_temp.ditem()).justification LIKE 'Picked by the analyst (%): Run 1 over the calibration range%' AND NOT (pg_temp.ditem()).auto_chosen);
SELECT pg_temp.expect_ok('Picking again replaces the pick', $$SELECT set_analyst_pick(pg_temp.dsmp(), 2, NULL, 'Run 2: within range')$$);
SELECT pg_temp.expect_true('... one pick stays active', (SELECT count(*) FROM analyst_pick WHERE batch_id = pg_temp.dbb() AND status = 'Active') = 1);
SELECT pg_temp.as_user('e.qa');
SELECT pg_temp.expect_error_like('Without testing.pick_run, no pick', $$SELECT set_analyst_pick(pg_temp.dsmp(), 1, NULL, 'x')$$, 'testing.pick_run');
SELECT pg_temp.as_user('wd.ana');
SELECT complete_step(pg_temp.drun('read'));
SELECT complete_step(pg_temp.drun('calc'));
SELECT pg_temp.expect_error_like('Once the batch waits for QC Review the reviewer chooses', $$SELECT set_analyst_pick(pg_temp.dsmp(), 1, NULL, 'x')$$, 'the reviewer chooses');

-- the reviewer's choice wins
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.expect_ok('The reviewer chooses run 1 instead, with a justification',
  $$SELECT choose_result(pg_temp.dbb(), (SELECT requested_test_id FROM batch_entry WHERE id = pg_temp.dsmp()), pg_temp.lead(), pg_temp.dsmp(), 1, 'Run 1 is within the extended range')$$);
SELECT pg_temp.expect_true('... QC Review reports run 1 (500) with the reviewer''s justification', (pg_temp.ditem()).chosen_run_no = 1 AND (pg_temp.ditem()).value = 500
  AND (pg_temp.ditem()).justification = 'Run 1 is within the extended range');

SELECT format('%-104s %s', test, outcome) AS result FROM results;
