-- Verification for migration 022 (WD-5.1): a matrix spike is judged against the reviewer's chosen result of the
-- spiked sample. A small test (weigh, read, result; one matrix spike with a recovery limit) on one sample: the sample
-- is read again in duplicate (run 2); until the reviewer chooses, the spike uses the sample's run 1 reading; then the
-- reading picked, then the average. (Load acceptance is in test_017.)
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Bench work', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.methods_internal', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.lead() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = 'WD Lead' $$;
CREATE OR REPLACE FUNCTION pg_temp.sv() RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Spike Basis' ORDER BY v.version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.sst(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_step WHERE test_version_id = pg_temp.sv() AND step_key = k AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.sbb() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_batch WHERE test_version_id = pg_temp.sv() ORDER BY batch_code LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.srun(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.sbb() AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.smp() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.sbb() AND entry_type = 'Sample' $$;
CREATE OR REPLACE FUNCTION pg_temp.ms() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.sbb() AND qc_type = 'Matrix Spike' $$;
CREATE OR REPLACE FUNCTION pg_temp.rec() RETURNS text LANGUAGE sql AS $$
  SELECT measured || ' ' || note FROM batch_qc_verdicts(pg_temp.sbb()) WHERE entry_id = pg_temp.ms() AND limit_type = 'Recovery %' AND analytical_run = 1 $$;

-- set-up: the test, approved, quoted and ordered on one new sample
SELECT pg_temp.as_user('wd.ana');
SELECT create_test(pg_temp.cfl(), 'WD Spike Basis', (SELECT d.id FROM department d WHERE d.site_id = pg_temp.cfl() AND d.department_code = 'WDC'),
  (SELECT id FROM method WHERE method_name = 'WD Elemental impurities by ICP-MS' AND site_id = pg_temp.cfl() LIMIT 1));
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, loq, lod) VALUES (pg_temp.sv(), pg_temp.lead(), 1, 'Numeric', 'mg/kg', 0.010, 0.005);
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.sv(), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 5, "qc": [{"qc_type": "Matrix Spike", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Recovery %", "min": 90, "max": 110}]}]}'),
 (pg_temp.sv(), 'weigh', 'Weigh', 'Weighing', 2, '{"target_mode": "None", "unit": "g"}'),
 (pg_temp.sv(), 'read', 'Read', 'Data Entry', 3, '{"value_label": "Lead", "value_unit": "mg/kg", "require_attachment": false}'),
 (pg_temp.sv(), 'calc', 'Result', 'Calculation', 4, '{"formula": "{read.reading} * 1"}'),
 (pg_temp.sv(), 'review', 'QC Review', 'QC Review', 5, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES
 (pg_temp.sst('weigh'), pg_temp.sst('batch')), (pg_temp.sst('read'), pg_temp.sst('weigh')), (pg_temp.sst('calc'), pg_temp.sst('read')), (pg_temp.sst('review'), pg_temp.sst('calc'));
INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) SELECT pg_temp.sst('weigh'), id, true FROM equipment_type WHERE site_id = pg_temp.cfl() AND type_name = 'WD Balance';
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.sv());
SELECT pg_temp.as_user('akiddle');
UPDATE test_catalog_entry SET base_price = 50 WHERE test_id = (SELECT id FROM test WHERE test_name = 'WD Spike Basis');
INSERT INTO project (client_id, project_name) SELECT client_id, 'WD Spike project' FROM lab_order WHERE order_code = 'LO-000003';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'WD Spike project'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price)
  SELECT pv.id, x.id, 3, 50 FROM project_version pv JOIN project p ON p.id = pv.project_id, test x WHERE p.project_name = 'WD Spike project' AND x.test_name = 'WD Spike Basis';
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Spike project');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam@acme.com') WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Spike project');
INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, quantity_received, quantity_unit, number_of_units)
  SELECT id, 'WD-SPIKE-1', 'Test product', 'Powder', 100, 'g', 1 FROM lab_order WHERE po_number = 'WD-PO-SPLIT';
SELECT order_test((SELECT id FROM sample WHERE client_sample_id = 'WD-SPIKE-1'),
  (SELECT q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id WHERE p.project_name = 'WD Spike project'));
SELECT log_samples(ARRAY(SELECT id FROM sample WHERE client_sample_id = 'WD-SPIKE-1'));

-- the bench: 0.5 g each, 0.5 mL of the 10 mg/L spike (10 mg/kg spiked); sample 2.0, spike 12.0 mg/kg
SELECT pg_temp.as_user('wd.ana');
SELECT create_batch(pg_temp.cfl(), pg_temp.sv());
SELECT complete_step(pg_temp.srun('batch'));
INSERT INTO entry_value (step_run_id, entry_id, value_num) VALUES (pg_temp.srun('weigh'), pg_temp.smp(), 0.5), (pg_temp.srun('weigh'), pg_temp.ms(), 0.5);
INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit)
  SELECT pg_temp.srun('weigh'), pg_temp.ms(), id, 'Spike', 0.5, 'mL' FROM inventory_lot WHERE manufacturer_lot = 'WD-SPK' ORDER BY created_at LIMIT 1;
INSERT INTO entry_equipment (step_run_id, equipment_id) SELECT pg_temp.srun('weigh'), id FROM equipment WHERE equipment_name = 'WD Balance 1';
SELECT complete_step(pg_temp.srun('weigh'));
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) VALUES (pg_temp.srun('read'), pg_temp.smp(), pg_temp.lead(), 2.0), (pg_temp.srun('read'), pg_temp.ms(), pg_temp.lead(), 12.0);
SELECT pg_temp.expect_true('Read once: the spike recovers (12 - 2) / 10 = 100 %', pg_temp.rec() LIKE '100.0 found 12% - sample 2.0% / spiked 10.0%');
SELECT set_config('lims.reason', 'Sample reading drifted', false);
SELECT add_analytical_run(pg_temp.srun('read'), ARRAY[pg_temp.smp()], 2);
SELECT set_config('lims.reason', 'Bench work', false);
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num) VALUES (pg_temp.srun('read'), pg_temp.smp(), pg_temp.lead(), 2, 2.6), (pg_temp.srun('read'), pg_temp.smp(), pg_temp.lead(), 3, 2.4);
SELECT pg_temp.expect_true('Read again: until the reviewer chooses, the spike uses the sample''s reading in its own run (run 1: 2.0), and says so',
  pg_temp.rec() LIKE '100.0 %sample 2.0%(same run, until the reviewer chooses the sample''s result)%');
SELECT complete_step(pg_temp.srun('read'));
SELECT complete_step(pg_temp.srun('calc'));

-- the reviewer's choice moves the spike's recovery
SELECT pg_temp.as_user('wd.sup');
SELECT choose_result(pg_temp.sbb(), (SELECT requested_test_id FROM batch_entry WHERE id = pg_temp.smp()), pg_temp.lead(), pg_temp.smp(), 2, 'Run 1 drifted');
SELECT pg_temp.expect_true('Picked: the spike is judged against the chosen reading (12 - 2.6) / 10 = 94 %', pg_temp.rec() LIKE '94.0 %sample 2.6%(the reviewer''s chosen result)%');
SELECT average_results(pg_temp.sbb(), (SELECT requested_test_id FROM batch_entry WHERE id = pg_temp.smp()), pg_temp.lead(),
  (SELECT jsonb_agg(jsonb_build_object('entry_id', pg_temp.smp(), 'run_no', g)) FROM generate_series(1, 3) g));
SELECT pg_temp.expect_true('Averaged: the spike is judged against the average (2.0, 2.6, 2.4: 2.333), 96.7 %', pg_temp.rec() LIKE '96.7 %sample 2.33%(the reviewer''s chosen result)%');

SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
