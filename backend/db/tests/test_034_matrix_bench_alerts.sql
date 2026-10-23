-- Verification for migration 039 (0.21.0): the sample's matrix drives the bench (weights, enrichment amounts and
-- incubation windows per product category; categories and controls that are not weighed), the presumptive positive
-- alert to the client, and readings that are not results (Indeterminate, Signal error) forcing a re-run.
-- Built like Colleen's Salmonella BAX Q7 screen: food, sponge and dry pet food samples, a positive and a negative control.
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
CREATE OR REPLACE FUNCTION pg_temp.uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.cat(n text) RETURNS text LANGUAGE sql AS $$ SELECT id::text FROM product_category WHERE category_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.bt() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test WHERE test_name = 'WD BAX Screen' $$;
CREATE OR REPLACE FUNCTION pg_temp.bv() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_version WHERE test_id = pg_temp.bt() ORDER BY version_no LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.bs(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_step WHERE test_version_id = pg_temp.bv() AND step_key = k AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.bb() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_batch WHERE test_id = pg_temp.bt() ORDER BY batch_code LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.br(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.bb() AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.be(cid text) RETURNS uuid LANGUAGE sql AS $$
  SELECT e.id FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id JOIN sample s ON s.id = rt.sample_id
   WHERE e.batch_id = pg_temp.bb() AND s.client_sample_id = cid AND e.status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.bq(t text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.bb() AND qc_type = t AND status = 'Active' LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.bmiss(k text) RETURNS text LANGUAGE sql AS $$ SELECT COALESCE(string_agg(problem, ' | '), '') FROM step_run_missing(pg_temp.br(k)) $$;
CREATE OR REPLACE FUNCTION pg_temp.lbl(cid text) RETURNS text LANGUAGE sql AS $$ SELECT label FROM batch_entry WHERE id = pg_temp.be(cid) $$;
CREATE OR REPLACE FUNCTION pg_temp.sal() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = 'WD Salmonella' $$;

-- set-up: product categories and matrices (food, sponge swab, dry pet food)
SELECT pg_temp.as_user('akiddle');
INSERT INTO product_category (category_name, sort_order) VALUES ('WD Food', 90), ('WD Sponge', 91), ('WD Pet food', 92);
INSERT INTO matrix (matrix_name, product_category_id) VALUES
 ('WD Granola', pg_temp.cat('WD Food')::uuid), ('WD Sponge swab', pg_temp.cat('WD Sponge')::uuid), ('WD Kibble', pg_temp.cat('WD Pet food')::uuid);

-- the test, as designed in the Workflow Designer
SELECT set_config('lims.gate_039', (SELECT require_workflow_verification::text FROM lab_site WHERE site_code = 'CFL'), false);
UPDATE lab_site SET require_workflow_verification = false WHERE site_code = 'CFL';
SELECT pg_temp.as_user('wd.ana');
INSERT INTO method (site_id, method_name, sop_code) VALUES (pg_temp.cfl(), 'WD Hygiena BAX Q7 Salmonella', 'MC-12.06');
SELECT create_test(pg_temp.cfl(), 'WD BAX Screen', (SELECT d.id FROM department d WHERE d.site_id = pg_temp.cfl() AND d.department_code = 'WDC'), (SELECT id FROM method WHERE method_name = 'WD Hygiena BAX Q7 Salmonella'));
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, result_values, found_values, invalid_values)
VALUES (pg_temp.bv(), pg_temp.sal(), 1, 'Qualitative', '{Negative,"Presumptive positive",Indeterminate,"Signal error"}', '{"Presumptive positive"}', '{Bogus}');
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.bv(), 'batch', 'Batch (one rack per shift)', 'Batching', 1, '{"max_samples": 10, "qc": [{"qc_type": "Positive Control", "qc_class": "Prep", "frequency": "Once", "count": 1, "material": "Strains", "criteria": [{"limit_type": "Presence"}]},
    {"qc_type": "Negative Control", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Absence"}]}]}'),
 (pg_temp.bv(), 'weigh', 'Weigh test portion', 'Weighing', 2, jsonb_build_object('target_mode', 'By product category', 'unit', 'g', 'qc_not_weighed', true, 'by_category', jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.cat('WD Food'), 'min', 24.5, 'max', 25.5), jsonb_build_object('category_id', pg_temp.cat('WD Pet food'), 'min', 367.5, 'max', 382.5),
    jsonb_build_object('category_id', pg_temp.cat('WD Sponge'), 'not_weighed', true)))),
 (pg_temp.bv(), 'enrich', 'Add BPW (1 in 10)', 'Dilution', 3, jsonb_build_object('mode', 'Single', 'aliquot', 25, 'diluent', 225, 'fields_per_entry', 1, 'by_category', jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.cat('WD Pet food'), 'aliquot', 375, 'diluent', 3375), jsonb_build_object('category_id', pg_temp.cat('WD Sponge'), 'aliquot', 1, 'diluent', 90)))),
 (pg_temp.bv(), 'inc', 'Incubate enrichment', 'Incubation', 4, jsonb_build_object('temp_c', 35, 'temp_tolerance', 1, 'duration', 22, 'duration_unit', 'hours', 'window_min', 20, 'window_max', 24,
    'by_category', jsonb_build_array(jsonb_build_object('category_id', pg_temp.cat('WD Pet food'), 'window_min', 22, 'window_max', 26)))),
 (pg_temp.bv(), 'read', 'BAX Q7 run', 'Data Entry', 5, '{"value_label": "BAX result", "require_attachment": false}'),
 (pg_temp.bv(), 'split', 'Reflex to confirmation', 'Split off Test', 6, jsonb_build_object('test_id', (SELECT id FROM test WHERE test_name = 'WD Micro P/A'), 'trigger', 'On finding', 'finding', 'Present',
    'finding_steps', '["read"]'::jsonb, 'consent_required', false, 'notify_client', true)),
 (pg_temp.bv(), 'review', 'QC Review', 'QC Review', 7, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES
 (pg_temp.bs('weigh'), pg_temp.bs('batch')), (pg_temp.bs('enrich'), pg_temp.bs('weigh')), (pg_temp.bs('inc'), pg_temp.bs('enrich')),
 (pg_temp.bs('read'), pg_temp.bs('inc')), (pg_temp.bs('split'), pg_temp.bs('read')), (pg_temp.bs('review'), pg_temp.bs('split'));
INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) SELECT pg_temp.bs('inc'), id, true FROM equipment_type WHERE type_name = 'WD Incubator';
INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) SELECT pg_temp.bs('weigh'), id, true FROM equipment_type WHERE type_name = 'WD Balance' AND site_id = pg_temp.cfl();

SELECT pg_temp.expect_true('Designer: a value that is not a result must be one of the result values',
  EXISTS (SELECT 1 FROM test_version_problems(pg_temp.bv()) WHERE severity = 'Error' AND problem LIKE '%values that are not results must be among its result values%'));
UPDATE test_version_analyte SET invalid_values = '{"Presumptive positive"," Signal error ",""}' WHERE test_version_id = pg_temp.bv();
SELECT pg_temp.expect_true('Designer: a value cannot both mean found and be not a result (the list is tidied: blanks and spaces removed)',
  EXISTS (SELECT 1 FROM test_version_problems(pg_temp.bv()) WHERE severity = 'Error' AND problem LIKE '%cannot both mean "found" and be "not a result"%')
  AND (SELECT invalid_values = '{"Presumptive positive","Signal error"}' FROM test_version_analyte WHERE test_version_id = pg_temp.bv()));
UPDATE test_version_analyte SET invalid_values = '{Indeterminate,"Signal error"}' WHERE test_version_id = pg_temp.bv();
UPDATE workflow_step SET config = jsonb_set(config, '{by_category,0,window_max}', '20') WHERE id = pg_temp.bs('inc');
SELECT pg_temp.expect_true('Designer: a window per product category needs its shortest at or below its longest',
  EXISTS (SELECT 1 FROM test_version_problems(pg_temp.bv()) WHERE step_key = 'inc' AND problem = 'WD Pet food: enter the shortest and longest acceptable time'));
UPDATE workflow_step SET config = jsonb_set(config, '{by_category,0,window_max}', '26') WHERE id = pg_temp.bs('inc');
SELECT pg_temp.expect_true('Designer: no errors; a category that is not weighed needs no weight range (no error for the sponge)',
  NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.bv()) WHERE severity = 'Error'));
SELECT pg_temp.expect_true('The design''s fingerprint includes the values that are not results',
  (test_version_definition(pg_temp.bv())->'invalid_values'->>(pg_temp.sal()::text)) = '["Indeterminate", "Signal error"]'
  AND NOT (test_version_definition((SELECT id FROM test_version WHERE test_id = (SELECT id FROM test WHERE test_name = 'WD Micro Screen') LIMIT 1)) ? 'invalid_values'));
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.bv());
SELECT pg_temp.as_user('akiddle');
UPDATE lab_site SET require_workflow_verification = current_setting('lims.gate_039')::boolean WHERE site_code = 'CFL';

-- the quote (screen and confirmation), a Positive alerts contact, three samples by matrix
UPDATE test_catalog_entry SET base_price = 45 WHERE test_id = pg_temp.bt();
INSERT INTO project (client_id, project_name) SELECT client_id, 'WD BAX project' FROM lab_order WHERE po_number = 'PO-7781';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'WD BAX project'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price)
  SELECT pv.id, x.id, 3, 45 FROM project_version pv JOIN project p ON p.id = pv.project_id, test x WHERE p.project_name = 'WD BAX project' AND x.test_name IN ('WD BAX Screen', 'WD Micro P/A');
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD BAX project');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam@acme.com') WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD BAX project');
INSERT INTO contact (first_name, last_name, email) VALUES ('Dana', 'WD Alert', 'dana.alert@acme.example');
INSERT INTO client_contact (client_id, contact_id, roles) SELECT o.client_id, c.id, '{ALERT}' FROM lab_order o, contact c WHERE o.po_number = 'PO-7781' AND c.email = 'dana.alert@acme.example';
INSERT INTO sample (lab_order_id, client_sample_id, matrix) SELECT o.id, x.cid, x.m FROM lab_order o, (VALUES ('BAX-F', 'WD Granola'), ('BAX-S', 'WD Sponge swab'), ('BAX-P', 'WD Kibble')) AS x(cid, m) WHERE o.po_number = 'PO-7781';
SELECT order_test(s.id, (SELECT q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id
   WHERE p.project_name = 'WD BAX project' AND q.test_id = pg_temp.bt())) FROM sample s WHERE s.client_sample_id IN ('BAX-F', 'BAX-S', 'BAX-P') ORDER BY s.client_sample_id;
SELECT log_samples(ARRAY(SELECT id FROM sample WHERE client_sample_id IN ('BAX-F', 'BAX-S', 'BAX-P')));
SELECT pg_temp.expect_true('A sample''s product category comes from its matrix', sample_product_category((SELECT id FROM sample WHERE client_sample_id = 'BAX-P'))::text = pg_temp.cat('WD Pet food'));

-- the batch: weights only from the samples that are weighed
SELECT pg_temp.as_user('wd.ana');
SELECT create_batch(pg_temp.cfl(), pg_temp.bv());
SELECT complete_step(pg_temp.br('batch'));
SELECT pg_temp.expect_true('Weighing waits for the food and pet food weights only: not the sponge (not weighed), not the controls',
  pg_temp.bmiss('weigh') LIKE '%' || pg_temp.lbl('BAX-F') || ': no weight%' AND pg_temp.bmiss('weigh') LIKE '%' || pg_temp.lbl('BAX-P') || ': no weight%'
  AND pg_temp.bmiss('weigh') NOT LIKE '%' || pg_temp.lbl('BAX-S') || '%' AND pg_temp.bmiss('weigh') NOT LIKE '%Control%');
SELECT pg_temp.expect_true('entry_is_weighed: the sponge and the controls are not weighed; the food is',
  NOT entry_is_weighed((SELECT config FROM workflow_step WHERE id = pg_temp.bs('weigh')), pg_temp.be('BAX-S'))
  AND NOT entry_is_weighed((SELECT config FROM workflow_step WHERE id = pg_temp.bs('weigh')), pg_temp.bq('Positive Control'))
  AND entry_is_weighed((SELECT config FROM workflow_step WHERE id = pg_temp.bs('weigh')), pg_temp.be('BAX-F')));
SELECT pg_temp.expect_true('The balance is needed for the weighed samples only',
  pg_temp.bmiss('weigh') LIKE '%' || pg_temp.lbl('BAX-F') || ': record the balance used%' AND pg_temp.bmiss('weigh') NOT LIKE '%' || pg_temp.lbl('BAX-S') || ': record the balance%');
INSERT INTO entry_value (step_run_id, entry_id, value_num) VALUES (pg_temp.br('weigh'), pg_temp.be('BAX-F'), 25.12), (pg_temp.br('weigh'), pg_temp.be('BAX-P'), 375.40);
INSERT INTO entry_equipment (step_run_id, equipment_id) SELECT pg_temp.br('weigh'), id FROM equipment WHERE equipment_name = 'WD Balance 1';
SELECT pg_temp.expect_true('With the two weights in, nothing is missing', pg_temp.bmiss('weigh') = '');
SELECT complete_step(pg_temp.br('weigh'));
INSERT INTO entry_value (step_run_id, entry_id, data) VALUES
 (pg_temp.br('enrich'), pg_temp.be('BAX-F'), '{"fields": [{"aliquot": 25, "diluent": 225}]}'), (pg_temp.br('enrich'), pg_temp.be('BAX-S'), '{"fields": [{"aliquot": 1, "diluent": 90}]}'),
 (pg_temp.br('enrich'), pg_temp.be('BAX-P'), '{"fields": [{"aliquot": 375, "diluent": 3375}]}'),
 (pg_temp.br('enrich'), pg_temp.bq('Positive Control'), '{"fields": [{"aliquot": 25, "diluent": 225}]}'), (pg_temp.br('enrich'), pg_temp.bq('Negative Control'), '{"fields": [{"aliquot": 25, "diluent": 225}]}');
INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) SELECT pg_temp.br('enrich'), pg_temp.bq('Positive Control'), id, 'Strain', 1, 'each' FROM inventory_lot WHERE manufacturer_lot = 'WD-ST';
SELECT complete_step(pg_temp.br('enrich'));

-- incubation: a window per product category
SELECT pg_temp.expect_true('The window of a load: food and pet food together share 22 to 24 h; pet food alone 22 to 26; controls alone the step''s 20 to 24',
  (SELECT window_min = 22 AND window_max = 24 FROM incubation_window((SELECT config FROM workflow_step WHERE id = pg_temp.bs('inc')), pg_temp.bb(), ARRAY[pg_temp.be('BAX-F'), pg_temp.be('BAX-P')]))
  AND (SELECT window_min = 22 AND window_max = 26 FROM incubation_window((SELECT config FROM workflow_step WHERE id = pg_temp.bs('inc')), pg_temp.bb(), ARRAY[pg_temp.be('BAX-P')]))
  AND (SELECT window_min = 20 AND window_max = 24 FROM incubation_window((SELECT config FROM workflow_step WHERE id = pg_temp.bs('inc')), pg_temp.bb(), ARRAY[pg_temp.bq('Positive Control')])));
INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature)
  SELECT pg_temp.br('inc'), e.id, ARRAY[pg_temp.be('BAX-F'), pg_temp.be('BAX-S'), pg_temp.bq('Positive Control'), pg_temp.bq('Negative Control')],
         clock_timestamp() - interval '23 hours', clock_timestamp() - interval '1 minute', 35.2 FROM equipment e WHERE e.equipment_name = 'WD Incubator 35';
INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature)
  SELECT pg_temp.br('inc'), e.id, ARRAY[pg_temp.be('BAX-P')], clock_timestamp() - interval '25 hours', clock_timestamp() - interval '1 minute', 35.0 FROM equipment e WHERE e.equipment_name = 'WD Incubator 35';
SELECT pg_temp.expect_true('Pet food incubated 25 h is within its own window (22 to 26); food at 23 h within 20 to 24: no flag on either load',
  (SELECT count(*) FROM incubation_load_view WHERE batch_id = pg_temp.bb() AND check_text IS NOT NULL) = 0 AND pg_temp.bmiss('inc') = '');
UPDATE incubation_load SET time_in = time_in - interval '2 hours' WHERE step_run_id = pg_temp.br('inc') AND entry_ids @> ARRAY[pg_temp.be('BAX-F')];
SELECT pg_temp.expect_true('Food at 25 h is outside its window (20 to 24): flagged, with the step''s window in the text',
  (SELECT check_text FROM incubation_load_view WHERE batch_id = pg_temp.bb() AND entry_ids @> ARRAY[pg_temp.be('BAX-F')]) LIKE 'incubated 25.0 hours, outside 20 to 24 hours%');
UPDATE incubation_load SET time_in = time_in + interval '2 hours' WHERE step_run_id = pg_temp.br('inc') AND entry_ids @> ARRAY[pg_temp.be('BAX-F')];
SELECT complete_step(pg_temp.br('inc'));

-- the BAX run: a signal error on the sponge and on the positive control; a presumptive positive on the pet food
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_text) VALUES
 (pg_temp.br('read'), pg_temp.be('BAX-F'), pg_temp.sal(), 'Negative'), (pg_temp.br('read'), pg_temp.be('BAX-S'), pg_temp.sal(), 'Signal error'),
 (pg_temp.br('read'), pg_temp.be('BAX-P'), pg_temp.sal(), 'Presumptive positive'),
 (pg_temp.br('read'), pg_temp.bq('Positive Control'), pg_temp.sal(), 'Signal error'), (pg_temp.br('read'), pg_temp.bq('Negative Control'), pg_temp.sal(), 'Negative');
SELECT pg_temp.expect_true('Readings that are not results are listed (the sponge and the positive control), not yet read again',
  (SELECT count(*) FROM batch_invalid_readings(pg_temp.bb()) WHERE NOT replaced) = 2);
SELECT pg_temp.expect_true('A control whose reading is not a result is Invalid (not passed or failed); the negative control passes',
  (SELECT verdict FROM batch_qc_verdicts(pg_temp.bb()) WHERE entry_id = pg_temp.bq('Positive Control')) = 'Invalid'
  AND (SELECT verdict FROM batch_qc_verdicts(pg_temp.bb()) WHERE entry_id = pg_temp.bq('Negative Control')) = 'Pass');
SELECT complete_step(pg_temp.br('read'));

-- the reflex: the presumptive positive orders the confirmation and alerts the client's Positive alerts contact
SELECT complete_step(pg_temp.br('split'));
SELECT pg_temp.expect_true('The pet food''s presumptive positive raises the split-off (ordered at once from the quote); the signal error does not',
  (SELECT count(*) FROM split_request WHERE batch_id = pg_temp.bb()) = 1
  AND (SELECT status = 'Ordered' FROM split_request WHERE entry_id = pg_temp.be('BAX-P')));
SELECT pg_temp.expect_true('Alert: one email to the Positive alerts contact, queued by the analyst who completed the step, saying confirmation has started',
  (SELECT count(*) FROM email_outbox eo JOIN split_request sr ON sr.id = eo.split_request_id WHERE sr.batch_id = pg_temp.bb()) = 1
  AND (SELECT eo.to_address = 'dana.alert@acme.example' AND eo.template = 'Presumptive Result' AND eo.subject LIKE 'Presumptive result: WD Salmonella Presumptive positive in BAX-P%'
         AND eo.body LIKE '%Confirmation (WD Micro P/A) has been started%' AND eo.created_by = pg_temp.uid('wd.ana') AND eo.lab_order_id IS NOT NULL
         FROM email_outbox eo JOIN split_request sr ON sr.id = eo.split_request_id WHERE sr.batch_id = pg_temp.bb()));
SELECT pg_temp.expect_true('The sample page shows who was alerted and when', (SELECT jsonb_array_length(split_alerts(id)) = 1 AND split_alerts(id)->0->>'to_name' = 'Dana WD Alert' FROM split_request WHERE batch_id = pg_temp.bb()));
SELECT pg_temp.expect_true('Without Positive alerts contacts the alert goes to the Receives Report contacts, else the ordering contact',
  (SELECT count(*) FROM alert_recipients((SELECT id FROM lab_order WHERE po_number = 'PO-7781'))) = 1
  AND (SELECT count(*) FROM alert_recipients((SELECT id FROM lab_order WHERE order_code = 'LO-000003'))) >= 1);

-- QC Review: the readings that are not results stop approval; they cannot be chosen
SELECT pg_temp.expect_true('(the batch waits for review)', (SELECT status = 'Awaiting Review' FROM test_batch WHERE id = pg_temp.bb()));
SELECT pg_temp.as_user('wd.sup');
SELECT approve_review_step(s.step_run_id) FROM review_step_runs(pg_temp.bb()) s;
SELECT pg_temp.expect_true('Approval waits: the sponge''s "Signal error" is not a result, and the positive control must be read again',
  (SELECT string_agg(problem, ' | ') FROM batch_review_problems(pg_temp.bb())) LIKE '%' || (SELECT sample_code FROM sample WHERE client_sample_id = 'BAX-S') || ' WD Salmonella: "Signal error" is not a result: read it again in a new analytical run%'
  AND (SELECT string_agg(problem, ' | ') FROM batch_review_problems(pg_temp.bb())) LIKE '%Positive Control% WD Salmonella Presence: reading Signal error is not a result%');
SELECT pg_temp.expect_error_like('A reading that is not a result cannot be chosen',
  $$SELECT choose_result(pg_temp.bb(), (SELECT requested_test_id FROM batch_entry WHERE id = pg_temp.be('BAX-S')), pg_temp.sal(), pg_temp.be('BAX-S'), 1, 'try')$$, 'is not a result and cannot be reported');
SELECT pg_temp.expect_error_like('Approval is refused', $$SELECT approve_batch(pg_temp.bb())$$, 'not a result');

-- the analyst reads the sponge and the positive control again (a new analytical run)
SELECT pg_temp.as_user('wd.ana');
SELECT set_config('lims.reason', 'Signal error on the BAX Q7: re-run per MC-12.06 8.5.2', false);
SELECT add_analytical_run(pg_temp.br('read'), ARRAY[pg_temp.be('BAX-S'), pg_temp.bq('Positive Control')], 1);
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_text) VALUES
 (pg_temp.br('read'), pg_temp.be('BAX-S'), pg_temp.sal(), 2, 'Negative'), (pg_temp.br('read'), pg_temp.bq('Positive Control'), pg_temp.sal(), 2, 'Presumptive positive');
SELECT set_config('lims.reason', 'Bench work', false);
SELECT complete_step(pg_temp.br('read'));
SELECT pg_temp.expect_true('Read again: both are marked replaced; the control''s run 2 passes',
  (SELECT bool_and(replaced) FROM batch_invalid_readings(pg_temp.bb()))
  AND (SELECT verdict FROM batch_qc_verdicts(pg_temp.bb()) WHERE entry_id = pg_temp.bq('Positive Control') AND run_no = 2) = 'Pass');
SELECT pg_temp.as_user('wd.sup');
SELECT approve_review_step(s.step_run_id) FROM review_step_runs(pg_temp.bb()) s WHERE s.mark_id IS NULL;
SELECT pg_temp.expect_true('The sponge''s valid reading is chosen by itself (the "Signal error" is never a candidate); nothing left to resolve',
  (SELECT chosen_run_no = 2 AND auto_chosen AND value_text = 'Negative' AND jsonb_array_length(candidates) = 1 FROM batch_review_items(pg_temp.bb())
     WHERE requested_test_id = (SELECT requested_test_id FROM batch_entry WHERE id = pg_temp.be('BAX-S')))
  AND NOT EXISTS (SELECT 1 FROM batch_review_problems(pg_temp.bb())));
SELECT approve_batch(pg_temp.bb());
SELECT pg_temp.expect_true('Approved: the sponge is reported Negative (run 2), the pet food Presumptive positive',
  (SELECT r.value_text FROM test_result r JOIN batch_entry e ON e.requested_test_id = r.requested_test_id WHERE r.batch_id = pg_temp.bb() AND e.id = pg_temp.be('BAX-S') AND r.status = 'Active') = 'Negative'
  AND (SELECT r.value_text FROM test_result r JOIN batch_entry e ON e.requested_test_id = r.requested_test_id WHERE r.batch_id = pg_temp.bb() AND e.id = pg_temp.be('BAX-P') AND r.status = 'Active') = 'Presumptive positive');

-- a new version keeps the values that are not results
SELECT pg_temp.as_user('wd.ana');
SELECT new_test_version(pg_temp.bt());
SELECT pg_temp.expect_true('A new version keeps the analyte''s values that are not results',
  (SELECT a.invalid_values = '{Indeterminate,"Signal error"}' FROM test_version_analyte a JOIN test_version v ON v.id = a.test_version_id
    WHERE v.test_id = pg_temp.bt() AND v.version_no = 2 AND a.status = 'Active'));

SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
