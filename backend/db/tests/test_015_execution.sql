-- Verification for migration 016 (WD-2): chemistry execution. The backlog, autobatch with QC, bench work with
-- equipment and materials gating, signed step completion with a witness, live results and per-analyte QC verdicts,
-- re-analysis and re-prep. Runs after test_011 to test_014 (uses their users, lab, department and "WD Metals").
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Bench work', false);
SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.methods_internal', '', false);
SELECT set_config('lims.testing_internal', '', false);
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
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (wrong error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.user_only(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) || set_config('lims.signature_id', '', false) $$;
CREATE OR REPLACE FUNCTION pg_temp.site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.grp(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT g.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id WHERE s.site_code = site AND g.group_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.dept(site text, code text) RETURNS uuid LANGUAGE sql AS $$
  SELECT d.id FROM department d JOIN lab_site s ON s.id = d.site_id WHERE s.site_code = site AND d.department_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.etype(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT t.id FROM equipment_type t JOIN lab_site s ON s.id = t.site_id WHERE s.site_code = site AND t.type_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.an(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.x_tst(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test WHERE test_name = n AND site_id = pg_temp.site('CFL') $$;
CREATE OR REPLACE FUNCTION pg_temp.x_ver(n text, no int) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_version WHERE test_id = pg_temp.x_tst(n) AND version_no = no $$;
CREATE OR REPLACE FUNCTION pg_temp.x_step(v uuid, k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_step WHERE test_version_id = v AND step_key = k AND status = 'Active' $$;
-- the first WD Metals v3 batch, its step runs and entries
CREATE OR REPLACE FUNCTION pg_temp.b(n int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM test_batch WHERE test_version_id = pg_temp.x_ver('WD Metals', 3) ORDER BY batch_code OFFSET n - 1 LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.run(k text, n int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.b(n) AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.ent(lbl text, n int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.b(n) AND label = lbl $$;
CREATE OR REPLACE FUNCTION pg_temp.at(p int, n int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.b(n) AND position = p $$;
CREATE OR REPLACE FUNCTION pg_temp.lbl(p int, n int DEFAULT 1) RETURNS text LANGUAGE sql AS $$ SELECT label FROM batch_entry WHERE batch_id = pg_temp.b(n) AND position = p $$;
CREATE OR REPLACE FUNCTION pg_temp.x_eq(name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM equipment WHERE equipment_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.x_lot(l text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM inventory_lot WHERE manufacturer_lot = l ORDER BY created_at LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.verdict(lbl text, an text, lt text) RETURNS text LANGUAGE sql AS $$
  SELECT verdict || COALESCE(' ' || measured, '') FROM batch_qc_verdicts(pg_temp.b()) WHERE label = lbl AND analyte_name = an AND limit_type = lt $$;

CREATE OR REPLACE FUNCTION pg_temp.result(lbl text, an text, rn int DEFAULT 1) RETURNS numeric LANGUAGE sql AS $$
  SELECT round(value, 6) FROM batch_results(pg_temp.b()) WHERE entry_id = pg_temp.ent(lbl) AND analyte_id = pg_temp.an(an) AND run_no = rn AND is_final $$;
CREATE OR REPLACE FUNCTION pg_temp.missing(k text) RETURNS text LANGUAGE sql AS $$ SELECT string_agg(problem, ' | ') FROM step_run_missing(pg_temp.run(k)) $$;

-- Permissions
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_true('Analysts and Lab Supervisors do bench work; only supervisors assign batches; Intake neither',
  user_has_permission_at(pg_temp.uid('wd.ana'), 'testing.perform', pg_temp.site('CFL')) AND user_has_permission_at(pg_temp.uid('wd.sup'), 'testing.assign', pg_temp.site('CFL'))
  AND NOT user_has_permission_at(pg_temp.uid('wd.ana'), 'testing.assign', pg_temp.site('CFL')) AND NOT user_has_permission_at(pg_temp.uid('wd.int'), 'testing.perform', pg_temp.site('CFL')));

-- Version 3 of WD Metals with the full QC set (blank, LCS, matrix spike and duplicate, ICV, CCV every 2) and a witnessed digestion
SELECT pg_temp.as_user('wd.ana');
SELECT new_test_version(pg_temp.x_tst('WD Metals'));
UPDATE workflow_step SET config = '{"max_samples": 20, "qc": [
   {"qc_type": "Method Blank", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Blank threshold", "limit_ref": "½ LOQ"}]},
   {"qc_type": "Laboratory Control Sample", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Recovery %", "min": 80, "max": 120}]},
   {"qc_type": "Matrix Spike", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Recovery %", "min": 75, "max": 125}]},
   {"qc_type": "Matrix Spike Duplicate", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Recovery %", "min": 75, "max": 125}, {"limit_type": "RPD", "max": 20}]},
   {"qc_type": "ICV", "qc_class": "Analytical", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Recovery %", "min": 90, "max": 110}]},
   {"qc_type": "CCV", "qc_class": "Analytical", "frequency": "Every N", "every_n": 2, "criteria": [{"limit_type": "Recovery %", "min": 90, "max": 110}]}]}'
 WHERE id = pg_temp.x_step(pg_temp.x_ver('WD Metals', 3), 'batch');
UPDATE workflow_step SET config = config || '{"witness": "Required"}' WHERE id = pg_temp.x_step(pg_temp.x_ver('WD Metals', 3), 'digest');
SELECT pg_temp.expect_true('(version 3 has no errors)', (SELECT count(*) FROM test_version_problems(pg_temp.x_ver('WD Metals', 3)) WHERE severity = 'Error') = 0);
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.x_ver('WD Metals', 3));

-- Three more CFL samples ordered: they pin version 3; LOT-A1 keeps version 2
SELECT pg_temp.as_user('akiddle');
CREATE OR REPLACE FUNCTION pg_temp.line() RETURNS uuid LANGUAGE sql AS $$
  SELECT ol.line_id FROM orderable_lines((SELECT client_id FROM lab_order WHERE order_code = 'LO-000003')) ol WHERE ol.test_id = pg_temp.x_tst('WD Metals') LIMIT 1 $$;
SELECT order_test(s.id, pg_temp.line()) FROM sample s WHERE s.client_sample_id IN ('LOT-A2', 'LOT-M2', 'LOT-N1') ORDER BY s.client_sample_id;
SELECT pg_temp.expect_true('The backlog lists logged tests with a workflow: one for version 2, three for version 3, standard priority, by due date',
  (SELECT count(*) FROM test_pool_view WHERE test_version_id = pg_temp.x_ver('WD Metals', 2)) = 1
  AND (SELECT count(*) FROM test_pool_view WHERE test_version_id = pg_temp.x_ver('WD Metals', 3) AND priority = 'Standard' AND kind = 'New') = 3);

-- Equipment and materials
DO $$ BEGIN
  INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, calibration_required) VALUES
   (pg_temp.site('CFL'), 'WD Balance 1', pg_temp.etype('CFL', 'WD Balance'), pg_temp.dept('CFL', 'WDC'), false),
   (pg_temp.site('CFL'), 'WD Balance 2', pg_temp.etype('CFL', 'WD Balance'), pg_temp.dept('CFL', 'WDC'), true),
   (pg_temp.site('CFL'), 'WD ICP-MS 1', pg_temp.etype('CFL', 'WD ICP-MS'), pg_temp.dept('CFL', 'WDC'), false);
  INSERT INTO equipment_owner (equipment_id, group_id) SELECT id, pg_temp.grp('CFL', 'Lab Supervisor') FROM equipment WHERE equipment_name LIKE 'WD %';
  INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date) VALUES
   (pg_temp.site('CFL'), 'WD Pb/Cd spike 10 mg/L', '{"Reference Standard"}', 'WD-SPK', 100, 'mL', current_date + 100),
   (pg_temp.site('CFL'), 'WD Pb/Cd check standard 50 ppb', '{"Reference Standard"}', 'WD-CHK', 100, 'mL', current_date + 100),
   (pg_temp.site('CFL'), 'WD old standard', '{"Reference Standard"}', 'WD-OLD', 100, 'mL', site_today(pg_temp.site('CFL')) - 1),   -- the lab's yesterday (not UTC's: Claude Code, 2026-10-13)
   (pg_temp.site('TPS'), 'WD TPS standard', '{"Reference Standard"}', 'WD-TPS', 100, 'mL', current_date + 100);
  INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit)
  SELECT l.id, a.id, CASE WHEN l.manufacturer_lot = 'WD-SPK' THEN 10 ELSE 0.05 END, 'mg/L'
    FROM inventory_lot l, analyte a WHERE l.manufacturer_lot IN ('WD-SPK', 'WD-CHK', 'WD-OLD', 'WD-TPS') AND a.analyte_name IN ('WD Lead', 'WD Cadmium');
END $$;

-- Autobatch
SELECT pg_temp.user_only('wd.int');
SELECT pg_temp.expect_error_like('Intake cannot make batches', $$SELECT create_batch(pg_temp.site('CFL'), pg_temp.x_ver('WD Metals', 3))$$, 'testing.perform');
SELECT pg_temp.user_only('wd.ana2');
SELECT pg_temp.expect_error_like('An analyst outside the test''s department cannot batch it', $$SELECT create_batch(pg_temp.site('CFL'), pg_temp.x_ver('WD Metals', 3))$$, 'department');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batches): batches are made from the backlog only
SELECT pg_temp.user_only('wd.ana');
SELECT create_batch(pg_temp.site('CFL'), pg_temp.x_ver('WD Metals', 3));
SELECT create_batch(pg_temp.site('CFL'), pg_temp.x_ver('WD Metals', 2), (SELECT jsonb_agg(jsonb_build_object('requested_test_id', requested_test_id)) FROM test_pool_view WHERE test_version_id = pg_temp.x_ver('WD Metals', 2)));
SELECT pg_temp.expect_true('A batch can be made from chosen backlog items (LOT-A1 on version 2)',
  (SELECT count(*) FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE b.test_version_id = pg_temp.x_ver('WD Metals', 2) AND e.entry_type = 'Sample') = 1);
SELECT pg_temp.expect_true('Autobatch: the three samples, blank, LCS, spike and duplicate, ICV and three CCV brackets (every 2 samples)',
  (SELECT count(*) FILTER (WHERE entry_type = 'Sample') = 3 AND count(*) FILTER (WHERE entry_type = 'QC') = 8 FROM batch_entry WHERE batch_id = pg_temp.b())
  AND (SELECT batch_code ~ '^BAT-\d{6}$' AND status = 'Open' AND assigned_to = pg_temp.uid('wd.ana') FROM test_batch WHERE id = pg_temp.b()));
SELECT pg_temp.expect_true('Run order: ICV, opening CCV, blank, LCS, sample 1, its spike and duplicate, sample 2, CCV, sample 3, closing CCV',
  pg_temp.lbl(1) = 'ICV' AND pg_temp.lbl(2) = 'CCV-1' AND pg_temp.lbl(3) = 'Method Blank' AND pg_temp.lbl(4) = 'Laboratory Control Sample'
  AND (SELECT entry_type FROM batch_entry WHERE id = pg_temp.at(5)) = 'Sample' AND pg_temp.lbl(6) = 'Matrix Spike' AND pg_temp.lbl(7) = 'Matrix Spike Duplicate'
  AND (SELECT entry_type FROM batch_entry WHERE id = pg_temp.at(8)) = 'Sample' AND pg_temp.lbl(9) = 'CCV-2'
  AND (SELECT entry_type FROM batch_entry WHERE id = pg_temp.at(10)) = 'Sample' AND pg_temp.lbl(11) = 'CCV-3');
SELECT pg_temp.expect_true('The spike and its duplicate are made from the first sample', (SELECT bool_and(parent_entry_id = pg_temp.at(5)) FROM batch_entry WHERE batch_id = pg_temp.b() AND qc_type LIKE 'Matrix Spike%'));
SELECT pg_temp.expect_true('One step run per workflow step, all Not started', (SELECT count(*) = 7 AND bool_and(status = 'Not started') FROM step_run WHERE batch_id = pg_temp.b()));
SELECT pg_temp.expect_true('Batched tests leave the backlog', NOT EXISTS (SELECT 1 FROM test_pool_view WHERE test_version_id = pg_temp.x_ver('WD Metals', 3)));
SELECT pg_temp.expect_error_like('Nothing left to batch', $$SELECT create_batch(pg_temp.site('CFL'), pg_temp.x_ver('WD Metals', 3))$$, 'Nothing in the pool');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batches): a batch's status follows its steps
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batches): entries are made with the batch only
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.entries): only the sample a spike is made from changes at the bench

-- Assigning
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batches): reassigning needs testing.assign (the database permission check stays)
SELECT pg_temp.expect_error_like('Use Assign to reassign', $$UPDATE test_batch SET assigned_to = pg_temp.uid('wd.ana2') WHERE id = pg_temp.b()$$, 'Assign');
SELECT pg_temp.as_user('wd.sup');
SELECT set_config('lims.reason', '', false);
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batches): a batch goes only to someone who does bench work
SELECT set_config('lims.reason', 'Bench work', false);
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batches): a supervisor assigns the batch

-- Batching step
SELECT pg_temp.as_user('wd.ana');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.steps): a step starts once the steps before it are completed
UPDATE batch_entry SET parent_entry_id = pg_temp.at(8) WHERE id = pg_temp.ent('Matrix Spike Duplicate');
SELECT pg_temp.expect_true('Before Batching is completed, the spiked sample can be changed', (SELECT parent_entry_id = pg_temp.at(8) FROM batch_entry WHERE id = pg_temp.ent('Matrix Spike Duplicate')));
UPDATE batch_entry SET parent_entry_id = pg_temp.at(5) WHERE id = pg_temp.ent('Matrix Spike Duplicate');
SELECT pg_temp.user_only('wd.ana');
SELECT pg_temp.expect_error_like('Completing a step needs a signature', $$SELECT complete_step(pg_temp.run('batch'))$$, 'electronic signature');
SELECT pg_temp.as_user('wd.ana');
SELECT complete_step(pg_temp.run('batch'));
SELECT pg_temp.expect_true('Batching completed, signed by the analyst', (SELECT status = 'Completed' AND performed_by = pg_temp.uid('wd.ana') AND signature_id IS NOT NULL AND witness_id IS NULL FROM step_run WHERE id = pg_temp.run('batch')));
SELECT pg_temp.expect_error_like('A completed step cannot be completed again', $$SELECT complete_step(pg_temp.run('batch'))$$, 'already completed');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.entries): after Batching the spiked sample is fixed

-- Weighing: values, the balance, the spike
SELECT pg_temp.user_only('wd.ana2');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.steps): someone outside the step's department records nothing
SELECT pg_temp.as_user('wd.ana');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.values): a weight must be above zero
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.values): an entry of another batch is refused
INSERT INTO entry_value (step_run_id, entry_id, value_num) SELECT pg_temp.run('weigh'), id, 0.5 FROM batch_entry WHERE batch_id = pg_temp.b() AND (entry_type = 'Sample' OR qc_class = 'Prep') AND label <> 'Laboratory Control Sample';
SELECT pg_temp.expect_true('The first value starts the step and the batch', (SELECT status = 'In progress' FROM step_run WHERE id = pg_temp.run('weigh'))
  AND (SELECT status = 'In Progress' FROM test_batch WHERE id = pg_temp.b()));
SELECT pg_temp.expect_true('Missing: the LCS weight and the balance', pg_temp.missing('weigh') LIKE 'Laboratory Control Sample: no weight%record the balance used%');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.equipment): an instrument the step does not use is refused
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.equipment): a balance out of calibration is refused
INSERT INTO entry_equipment (step_run_id, equipment_id) VALUES (pg_temp.run('weigh'), pg_temp.x_eq('WD Balance 1'));
INSERT INTO entry_value (step_run_id, entry_id, value_num) VALUES (pg_temp.run('weigh'), pg_temp.ent('Laboratory Control Sample'), 0.5);
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.materials): an expired lot cannot be used
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.materials): another lab's lot cannot be used
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.materials): a material needs the amount used
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.materials): the amount must convert to the lot's unit
INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit)
  SELECT pg_temp.run('weigh'), id, pg_temp.x_lot('WD-SPK'), 'Spike', 500, 'µL' FROM batch_entry WHERE batch_id = pg_temp.b() AND qc_type IN ('Laboratory Control Sample', 'Matrix Spike', 'Matrix Spike Duplicate');
SELECT pg_temp.expect_true('(the spike volume is kept in the Units list spelling)', (SELECT volume_unit FROM entry_material WHERE entry_id = pg_temp.ent('Laboratory Control Sample') LIMIT 1) = 'µL');
SELECT pg_temp.expect_true('Each spike comes off the lot''s stock (500 µL = 0.5 mL, three entries: 100 - 1.5 = 98.5 mL), as Usage naming the batch and entry',
  lot_on_hand(pg_temp.x_lot('WD-SPK')) = 98.5
  AND (SELECT count(*) = 3 AND bool_and(t.txn_type = 'Usage' AND t.quantity_change = -0.5 AND t.reference LIKE 'BAT-% Weigh: %' AND t.created_by = pg_temp.uid('wd.ana'))
         FROM entry_material em JOIN inventory_transaction t ON t.id = em.usage_txn_id WHERE em.lot_id = pg_temp.x_lot('WD-SPK')));
INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.run('weigh'), pg_temp.ent('Method Blank'), pg_temp.x_lot('WD-SPK'), 'Spike', 2, 'mL');
UPDATE entry_material SET status = 'Inactive' WHERE entry_id = pg_temp.ent('Method Blank') AND purpose = 'Spike';
SELECT pg_temp.expect_true('A material removed while its step is open puts its stock back (a linked correcting movement)',
  lot_on_hand(pg_temp.x_lot('WD-SPK')) = 98.5
  AND (SELECT r.quantity_change = 2 AND r.corrects_txn_id = em.usage_txn_id FROM entry_material em JOIN inventory_transaction r ON r.id = em.return_txn_id WHERE em.entry_id = pg_temp.ent('Method Blank')));
SELECT pg_temp.expect_error_like('Stock cannot be put back outside the bench',
  $$INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, corrects_txn_id)
    SELECT lot_id, 'Usage', 0.5, id FROM inventory_transaction WHERE lot_id = pg_temp.x_lot('WD-SPK') AND txn_type = 'Usage' AND quantity_change < 0 LIMIT 1$$, 'puts stock back');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.materials): a recorded amount is removed and added again, never edited
SELECT complete_step(pg_temp.run('weigh'));
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.steps): a completed step's data cannot change

-- Digestion: fields, and a required witness
UPDATE step_run SET fields = '{"digest_final_volume_ml": "50"}' WHERE id = pg_temp.run('digest');
SELECT pg_temp.expect_true('Missing: the Program field', pg_temp.missing('digest') = 'Fill in Program');
UPDATE step_run SET fields = '{"digest_final_volume_ml": "50", "program": "Soil-1"}' WHERE id = pg_temp.run('digest');
SELECT pg_temp.expect_error_like('A step that requires a witness cannot be completed alone', $$SELECT complete_step(pg_temp.run('digest'))$$, 'needs a witness');
SELECT pg_temp.expect_error_like('The witness must be someone else', $$SELECT sign_witness(pg_temp.uid('wd.ana'), 'Witness')$$, 'someone else');
SELECT pg_temp.expect_error_like('The witness must do bench work in the lab',
  $$SELECT complete_step(pg_temp.run('digest'), sign_witness(pg_temp.uid('wd.int'), 'Witness digestion'))$$, 'testing.perform');
SELECT pg_temp.expect_error_like('A signature that is not a witness signature is refused',
  $$SELECT complete_step(pg_temp.run('digest'), (SELECT id FROM signature_event WHERE user_id = pg_temp.uid('wd.sup') ORDER BY signed_at DESC LIMIT 1))$$, 'not valid');
SELECT complete_step(pg_temp.run('digest'), sign_witness(pg_temp.uid('wd.ana2'), 'Witness digestion'));
SELECT pg_temp.expect_true('Digestion completed by the analyst and witnessed by a colleague (outside the department), both signed',
  (SELECT r.performed_by = pg_temp.uid('wd.ana') AND r.witness_id = pg_temp.uid('wd.ana2') AND w.meaning = 'Witnessed by' AND w.user_id = pg_temp.uid('wd.ana2') AND s.user_id = pg_temp.uid('wd.ana')
     FROM step_run r JOIN signature_event w ON w.id = r.witness_signature_id JOIN signature_event s ON s.id = r.signature_id WHERE r.id = pg_temp.run('digest')));
SELECT pg_temp.expect_true('(the analyst''s own session is unchanged after the witness signs)', current_setting('lims.user_id') = pg_temp.uid('wd.ana')::text);

-- Dilution
INSERT INTO entry_value (step_run_id, entry_id, data) SELECT pg_temp.run('dil'), id, '{"fields": [{"aliquot": 10, "diluent": 40}]}'
  FROM batch_entry WHERE batch_id = pg_temp.b() AND (entry_type = 'Sample' OR qc_class = 'Prep');
SELECT pg_temp.expect_true('Dilution factor 5 from 10 + 40; two steps multiply (10 + 40, then 1 + 1 = 10)',
  dilution_factor('{"fields": [{"aliquot": 10, "diluent": 40}]}') = 5 AND round(dilution_factor('{"fields": [{"aliquot": 10, "diluent": 40}, {"aliquot": 1, "diluent": 1}]}'), 6) = 10
  AND dilution_final_volume('{"fields": [{"aliquot": 10, "diluent": 40}, {"aliquot": 1, "diluent": 1}]}') = 2);
SELECT complete_step(pg_temp.run('dil'));

-- Readings (µg/L): samples 20, 30, 12; spike 40, duplicate 38; LCS 19; blank Pb 0.008, Cd 0.012; ICV 49; CCVs 51, 50, 60
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num)
  SELECT pg_temp.run('read'), e.id, a.id,
         CASE WHEN e.label = 'Method Blank' THEN CASE WHEN a.analyte_name = 'WD Lead' THEN 0.008 ELSE 0.012 END
              WHEN e.position = 5 THEN 20 WHEN e.position = 8 THEN 30 WHEN e.position = 10 THEN 12
              ELSE CASE e.label WHEN 'Matrix Spike' THEN 40 WHEN 'Matrix Spike Duplicate' THEN 38 WHEN 'Laboratory Control Sample' THEN 19 WHEN 'ICV' THEN 49
                                WHEN 'CCV-1' THEN 51 WHEN 'CCV-2' THEN 50 WHEN 'CCV-3' THEN 60 END END
    FROM batch_entry e, analyte a WHERE e.batch_id = pg_temp.b() AND a.analyte_name IN ('WD Lead', 'WD Cadmium');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.values): a second reading needs a re-analysis first
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.values): a reading for an analyte not on the test is refused
SELECT pg_temp.expect_true('Missing: the raw data file, the instrument and the check standards',
  pg_temp.missing('read') LIKE '%Attach the raw data%' AND pg_temp.missing('read') LIKE '%Record the instrument used%' AND pg_temp.missing('read') LIKE '%ICV: record the check standard used%');

CREATE OR REPLACE FUNCTION pg_temp.missing_without_lcs_spike() RETURNS text LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN   -- (rule test only: take the LCS spike away for a moment, behind the bench rules, and put it back)
  PERFORM set_testing_internal(true);
  UPDATE entry_material SET status = 'Inactive' WHERE entry_id = pg_temp.ent('Laboratory Control Sample') AND purpose = 'Spike';
  t := pg_temp.missing('read');
  UPDATE entry_material SET status = 'Active' WHERE entry_id = pg_temp.ent('Laboratory Control Sample') AND purpose = 'Spike';
  PERFORM set_testing_internal(false);
  RETURN t;
END $$;
SELECT pg_temp.expect_true('A spiked QC (its criteria judge a recovery) needs its spike recorded before the readings are complete',
  pg_temp.missing_without_lcs_spike() LIKE '%Laboratory Control Sample: record the spike (lot and volume)%' AND pg_temp.missing('read') NOT LIKE '%record the spike%');

-- Live results and QC verdicts
SELECT pg_temp.expect_true('Result = reading x dilution x final volume / 1000 / weight: 20 x 5 x 50 / 1000 / 0.5 = 10 mg/kg, reported 10.0, with its inputs',
  pg_temp.result(pg_temp.lbl(5), 'WD Lead') = 10
  AND (SELECT reported = '10.0' AND (inputs->>'weigh.weight')::numeric = 0.5 AND (inputs->>'dil.factor')::numeric = 5 FROM batch_results(pg_temp.b())
        WHERE entry_id = pg_temp.at(5) AND analyte_id = pg_temp.an('WD Lead') AND is_final));
SELECT pg_temp.expect_true('A check standard has no weight, so it has no calculated result (waiting), which does not hold up the calculation',
  (SELECT waiting LIKE 'Waiting for %{weigh.weight}%' FROM batch_results(pg_temp.b()) WHERE entry_id = pg_temp.ent('ICV') AND analyte_id = pg_temp.an('WD Lead') AND is_final));
SELECT pg_temp.expect_true('Spike recovery: 10 mg/L x 0.5 mL = 0.005 mg in 0.5 g = 10 mg/kg spiked; LCS 9.5 found = 95% Pass',
  pg_temp.verdict('Laboratory Control Sample', 'WD Lead', 'Recovery %') = 'Pass 95.0');
SELECT pg_temp.expect_true('Matrix spike: (20 - 10 in the sample) / 10 = 100%; duplicate (19 - 10) / 10 = 90%; RPD 19 vs 20 = 5.1%',
  pg_temp.verdict('Matrix Spike', 'WD Lead', 'Recovery %') = 'Pass 100.0' AND pg_temp.verdict('Matrix Spike Duplicate', 'WD Lead', 'Recovery %') = 'Pass 90.0'
  AND pg_temp.verdict('Matrix Spike Duplicate', 'WD Lead', 'RPD') = 'Pass 5.1');
SELECT pg_temp.expect_true('Blank against ½ LOQ (0.005 mg/kg), per analyte: Lead 0.004 passes, Cadmium 0.006 fails',
  pg_temp.verdict('Method Blank', 'WD Lead', 'Blank threshold') = 'Pass 0.004000' AND pg_temp.verdict('Method Blank', 'WD Cadmium', 'Blank threshold') = 'Fail 0.006000');
SELECT pg_temp.expect_true('Check standards are not judged until the standard used is recorded', pg_temp.verdict('ICV', 'WD Lead', 'Recovery %') = 'Not judged');
INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit)
  SELECT pg_temp.run('read'), id, pg_temp.x_lot('WD-CHK'), 'Standard', 1, 'mL' FROM batch_entry WHERE batch_id = pg_temp.b() AND qc_type IN ('ICV', 'CCV');
SELECT pg_temp.expect_true('The check standard used comes off its stock too (ICV and three CCVs, 1 mL each)', lot_on_hand(pg_temp.x_lot('WD-CHK')) = 96);
SELECT pg_temp.expect_true('Check standards: reading against the standard (0.05 mg/L = 50 µg/L): ICV 98%, CCV 102% and 100% pass, the closing CCV 120% fails',
  pg_temp.verdict('ICV', 'WD Lead', 'Recovery %') = 'Pass 98.0' AND pg_temp.verdict('CCV-1', 'WD Lead', 'Recovery %') = 'Pass 102.0'
  AND pg_temp.verdict('CCV-2', 'WD Lead', 'Recovery %') = 'Pass 100.0' AND pg_temp.verdict('CCV-3', 'WD Cadmium', 'Recovery %') = 'Fail 120.0');

-- Re-analysis
SELECT pg_temp.user_only('wd.ana');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.analyticalRuns): re-analysis is signed (Java signs it)
SELECT pg_temp.as_user('wd.ana');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.analyticalRuns): re-analysis is single, duplicate or triplicate
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.analyticalRuns): re-analysis is asked for at a reading step
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.analyticalRuns): re-analysis is asked for from the batch
SELECT set_config('lims.reason', 'High internal standard drift', false);
SELECT add_analytical_run(pg_temp.run('read'), ARRAY[pg_temp.at(8)], 2);
SELECT pg_temp.expect_true('Duplicate re-analysis: readings 2 and 3 are expected for that sample; missing until entered', entry_runs(pg_temp.run('read'), pg_temp.at(8)) = 3
  AND pg_temp.missing('read') LIKE '%' || pg_temp.lbl(8) || ': 4 readings missing%'
  AND (SELECT reason = 'High internal standard drift' AND signature_id IS NOT NULL AND first_run_no = 2 FROM reanalysis_request WHERE entry_id = pg_temp.at(8)));
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num)
  SELECT pg_temp.run('read'), pg_temp.at(8), a.id, rn, 29 + rn FROM analyte a, generate_series(2, 3) rn WHERE a.analyte_name IN ('WD Lead', 'WD Cadmium');
SELECT pg_temp.expect_true('Every reading is kept and calculated: 15, 15.5 and 16 mg/kg', pg_temp.result(pg_temp.lbl(8), 'WD Lead', 1) = 15
  AND pg_temp.result(pg_temp.lbl(8), 'WD Lead', 2) = 15.5 AND pg_temp.result(pg_temp.lbl(8), 'WD Lead', 3) = 16);
-- WD-5: the re-analysis is analytical run 2: the sample's two readings (RA1-, RA2-) plus the run's own ICV and CCVs
SELECT pg_temp.expect_true('WD-5: the re-analysis opened analytical run 2 (signed, with its reason) holding the sample''s readings 2 and 3 and one reading of each ICV and CCV',
  analytical_runs(pg_temp.run('read')) = 2
  AND (SELECT reason = 'High internal standard drift' AND signature_id IS NOT NULL FROM analytical_run WHERE step_run_id = pg_temp.run('read') AND run_no = 2)
  AND reading_run(pg_temp.run('read'), pg_temp.at(8), 3) = 2 AND reading_run(pg_temp.run('read'), pg_temp.at(8), 1) = 1
  AND (SELECT count(*) FROM reanalysis_request x JOIN batch_entry e ON e.id = x.entry_id WHERE x.step_run_id = pg_temp.run('read') AND e.qc_class = 'Analytical' AND x.runs = 1) = 4
  AND pg_temp.missing('read') LIKE '%Run 2: ICV: 2 readings missing%' AND pg_temp.missing('read') LIKE '%Attach the raw data (the instrument export) of run 2%');
SELECT pg_temp.expect_true('WD-5: re-readings are labelled RA1-, RA2- (numbered on per sample)', reading_label(pg_temp.lbl(8), 2) = 'RA1-' || pg_temp.lbl(8) AND reading_label(pg_temp.lbl(8), 3) = 'RA2-' || pg_temp.lbl(8));
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num)
  SELECT pg_temp.run('read'), e.id, a.id, 2, 50 FROM batch_entry e, analyte a WHERE e.batch_id = pg_temp.b() AND e.qc_type IN ('ICV', 'CCV') AND a.analyte_name IN ('WD Lead', 'WD Cadmium');
SELECT pg_temp.expect_true('WD-5: QC is judged per analytical run: run 2''s closing CCV passes (100%) while run 1''s fails (120%)',
  (SELECT verdict || ' ' || measured FROM batch_qc_verdicts(pg_temp.b()) WHERE label = 'RA1-CCV-3' AND analyte_name = 'WD Cadmium' AND analytical_run = 2) = 'Pass 100.0'
  AND pg_temp.verdict('CCV-3', 'WD Cadmium', 'Recovery %') = 'Fail 120.0');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.equipment): equipment and raw data belong to an analytical run that exists
INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('wd-icpms-run2.csv', 'text/csv', 0, '', convert_to('Sample,Pb,Cd', 'UTF8'));
INSERT INTO step_attachment (step_run_id, document_id, label, analytical_run_no) SELECT pg_temp.run('read'), id, 'ICP-MS export, run 2', 2 FROM document_file WHERE file_name = 'wd-icpms-run2.csv';
INSERT INTO entry_equipment (step_run_id, equipment_id, analytical_run_no) VALUES (pg_temp.run('read'), pg_temp.x_eq('WD ICP-MS 1'), 2);

-- Completing the reading step: raw data, instrument
SELECT set_config('lims.reason', 'Bench work', false);
INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('wd-icpms-export.csv', 'text/csv', 0, '', convert_to('Sample,Pb,Cd', 'UTF8'));
INSERT INTO step_attachment (step_run_id, document_id, label) SELECT pg_temp.run('read'), id, 'ICP-MS export' FROM document_file WHERE file_name = 'wd-icpms-export.csv';
INSERT INTO entry_equipment (step_run_id, equipment_id) VALUES (pg_temp.run('read'), pg_temp.x_eq('WD ICP-MS 1'));
SELECT pg_temp.expect_true('(nothing missing at the reading step)', pg_temp.missing('read') IS NULL);
SELECT complete_step(pg_temp.run('read'));
SELECT complete_step(pg_temp.run('calc'));
SELECT pg_temp.expect_true('All bench steps done: the batch waits for QC Review (WD-3); QC Review is not done at the bench',
  (SELECT status = 'Awaiting Review' FROM test_batch WHERE id = pg_temp.b()) AND pg_temp.missing('review') LIKE '%reviewer%');

-- Reopening and corrections
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.steps): a step does not reopen while a later step is completed
SELECT set_config('lims.reason', '', false);
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.steps): reopening needs a reason
SELECT set_config('lims.reason', 'Transcription check', false);
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.steps): reopened: the step and the batch are back in progress
SELECT add_analytical_run(pg_temp.run('read'), ARRAY[pg_temp.at(10)], 1);
SELECT pg_temp.expect_true('A re-analysis reopens the reading step and the calculation after it',
  (SELECT status FROM step_run WHERE id = pg_temp.run('read')) = 'In progress' AND (SELECT status FROM step_run WHERE id = pg_temp.run('calc')) = 'In progress'
  AND (SELECT status FROM step_run WHERE id = pg_temp.run('dil')) = 'Completed' AND (SELECT status = 'In Progress' FROM test_batch WHERE id = pg_temp.b()));
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error_like('Correcting a reading needs a reason', $$UPDATE entry_value SET value_num = 32 WHERE step_run_id = pg_temp.run('read') AND entry_id = pg_temp.at(8) AND run_no = 2 AND analyte_id = pg_temp.an('WD Lead')$$, 'reason');
SELECT set_config('lims.reason', 'Typing error', false);
UPDATE entry_value SET value_num = 32 WHERE step_run_id = pg_temp.run('read') AND entry_id = pg_temp.at(8) AND run_no = 2 AND analyte_id = pg_temp.an('WD Lead');
SELECT pg_temp.expect_true('A corrected reading is audited with its reason and recalculated', pg_temp.result(pg_temp.lbl(8), 'WD Lead', 2) = 16
  AND EXISTS (SELECT 1 FROM audit_log a JOIN entry_value ev ON ev.id = a.record_id WHERE ev.entry_id = pg_temp.at(8) AND a.reason = 'Typing error'));

-- Re-prep
SELECT set_config('lims.reason', 'Digest incomplete (particles)', false);
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.entries): QC is not re-prepared
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.entries): re-prep is single, duplicate or triplicate
CREATE TEMP TABLE wd_reprep AS SELECT pg_temp.at(10) AS entry_id, pg_temp.lbl(10) AS label, (SELECT requested_test_id FROM batch_entry WHERE id = pg_temp.at(10)) AS rt;
-- the re-prep (Java's BatchMakingService.reprep since migration 067), written here as Java writes it
INSERT INTO reprep_request (requested_test_id, origin_entry_id, replicates, reason) SELECT rt, entry_id, 2, current_reason() FROM wd_reprep;
UPDATE batch_entry SET status = 'Superseded', superseded_reason = 'Re-prep: ' || current_reason() WHERE id = (SELECT entry_id FROM wd_reprep);
SELECT pg_temp.expect_true('Re-prep: the entry is superseded with the reason and keeps its data; the test is back at the top of the backlog, in duplicate',
  (SELECT status = 'Superseded' AND superseded_reason LIKE 'Re-prep: Digest incomplete%' FROM batch_entry WHERE id = (SELECT entry_id FROM wd_reprep))
  AND EXISTS (SELECT 1 FROM entry_value WHERE entry_id = (SELECT entry_id FROM wd_reprep))
  AND (SELECT kind = 'Re-prep' AND priority = 'Re-prep' AND priority_rank = 0 AND replicates = 2 FROM test_pool_view WHERE requested_test_id = (SELECT rt FROM wd_reprep)));
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.values): a superseded entry takes no more data
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.entries): an entry is re-prepared once
SELECT pg_temp.expect_true('The superseded sample drops out of the results', NOT EXISTS (SELECT 1 FROM batch_results(pg_temp.b()) WHERE entry_id = (SELECT entry_id FROM wd_reprep)));
SELECT create_batch(pg_temp.site('CFL'), pg_temp.x_ver('WD Metals', 3));
SELECT pg_temp.expect_true('The re-prep batch: two preparations of the sample (WD-5: labelled RP1- and RP2-), with fresh QC (two CCV brackets for two samples); the re-prep is marked batched',
  (SELECT count(*) FROM batch_entry WHERE batch_id = pg_temp.b(2) AND entry_type = 'Sample' AND requested_test_id = (SELECT rt FROM wd_reprep) AND replicate_no IN (1, 2)) = 2
  AND (SELECT string_agg(label, ',' ORDER BY position) FROM batch_entry WHERE batch_id = pg_temp.b(2) AND entry_type = 'Sample') LIKE 'RP1-%,RP2-%'
  AND (SELECT count(*) FROM batch_entry WHERE batch_id = pg_temp.b(2) AND entry_type = 'QC') = 7
  AND (SELECT status = 'Batched' AND batch_id = pg_temp.b(2) FROM reprep_request WHERE requested_test_id = (SELECT rt FROM wd_reprep))
  AND NOT EXISTS (SELECT 1 FROM test_pool_view WHERE requested_test_id = (SELECT rt FROM wd_reprep)));

-- The batch list and the audit trail
SELECT pg_temp.expect_true('The batch list counts samples, QC and steps, and names the next step',
  (SELECT sample_count = 2 AND qc_count = 8 AND steps_done = 4 AND steps_total = 7 AND next_step = 'ICP-MS reading' FROM test_batch_view WHERE id = pg_temp.b()));
SELECT pg_temp.expect_true('Audit entries name the batch and link to it',
  (SELECT audit_record_ref('test_batch', b.id, to_jsonb(b))->>'link' = '#/testing/batches/' || b.id FROM test_batch b WHERE b.id = pg_temp.b())
  AND (SELECT audit_record_ref('entry_value', ev.id, to_jsonb(ev))->>'label' LIKE 'Value for % in BAT-%' FROM entry_value ev WHERE ev.entry_id = pg_temp.at(5) LIMIT 1));

SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
