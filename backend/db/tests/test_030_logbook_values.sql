-- Verification for migration 035 (L-2): logbook values feed results. A challenge inoculum logbook makes a lot per entry
-- and publishes its CFU added; a recovery test reads {inoc.cfu_added} from the lot scanned at its Inoculate step: the
-- entry is chosen at the scan (a lot past its validity is refused), the result waits for QA's approval, a lot naming
-- another organism is not used for it. A sample weights logbook: the aliquot scanned at Weigh fills the weight and the
-- balance; a typed weight cannot replace it; the reviewer may not be who weighed it; QC Review lists every aliquot.
-- The stored result keeps the values used; correcting the entry flags it; a reviewer (not the corrector) resolves the
-- flag; the release check refuses an open flag or an entry not approved; an entry in use is not voided.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Bench work', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.methods_internal', '', false);
SELECT set_config('lims.logbook_internal', '', false);
SELECT set_config('lims.group_sync', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ~* pat THEN 'PASS: ' ELSE 'FAIL (wrong error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'PASS');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'FAIL: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.sal() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = 'WD Salmonella' $$;
CREATE OR REPLACE FUNCTION pg_temp.lead() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = 'WD Lead' $$;
CREATE OR REPLACE FUNCTION pg_temp.lb(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM logbook WHERE logbook_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.lbv(n text) RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM logbook_version v JOIN logbook l ON l.id = v.logbook_id WHERE l.logbook_name = n ORDER BY v.version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.rv() RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Recovery' ORDER BY v.version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.rst(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_step WHERE test_version_id = pg_temp.rv() AND step_key = k AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.rb() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_batch WHERE test_version_id = pg_temp.rv() ORDER BY batch_code LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.rrun(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.rb() AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.rsmp() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.rb() AND entry_type = 'Sample' $$;
CREATE OR REPLACE FUNCTION pg_temp.calc() RETURNS record LANGUAGE sql AS $$
  SELECT value, waiting FROM batch_results(pg_temp.rb()) WHERE entry_id = pg_temp.rsmp() AND analyte_id = pg_temp.sal() AND step_key = 'calc' $$;
CREATE OR REPLACE FUNCTION pg_temp.inoc_entry(n integer) RETURNS logbook_entry LANGUAGE sql AS $$
  SELECT * FROM logbook_entry WHERE logbook_id = pg_temp.lb('Rule challenge inoculum') ORDER BY created_at OFFSET n - 1 LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.aliq(n integer) RETURNS logbook_entry LANGUAGE sql AS $$
  SELECT * FROM logbook_entry WHERE logbook_id = pg_temp.lb('Rule sample weights') ORDER BY created_at OFFSET n - 1 LIMIT 1 $$;
SELECT set_config('lims.site_id', pg_temp.cfl()::text, false);

-- 1. the logbooks: a challenge inoculum (makes a lot, publishes CFU per mL and CFU added) and sample weights
SELECT pg_temp.as_user('e.sup');
INSERT INTO logbook (site_id, logbook_name, kind, subject, creates_lot, lot_name, validity_hours, review_frequency)
VALUES (pg_temp.cfl(), 'Rule challenge inoculum', 'Inoculum', 'Lot', true, 'Challenge inoculum', 24, 'Daily');
INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, unit, limit_max, formula, publish) VALUES
  (pg_temp.lbv('Rule challenge inoculum'), 'culture_lot', 'Working culture', 'Lot', 10, NULL, NULL, NULL, false),
  (pg_temp.lbv('Rule challenge inoculum'), 'count_1', 'Count 1', 'Number', 20, 'CFU', NULL, NULL, false),
  (pg_temp.lbv('Rule challenge inoculum'), 'count_2', 'Count 2', 'Number', 30, 'CFU', NULL, NULL, false),
  (pg_temp.lbv('Rule challenge inoculum'), 'cfu_per_ml', 'CFU per mL', 'Calculated', 40, 'CFU/mL', NULL, '({count_1} + {count_2}) / 2 / 0.1', true),
  (pg_temp.lbv('Rule challenge inoculum'), 'cfu_added', 'CFU added (0.1 mL)', 'Calculated', 50, 'CFU', 100, '{cfu_per_ml} * 0.1', true),
  (pg_temp.lbv('Rule challenge inoculum'), 'volume_made', 'Volume made', 'Number', 60, 'mL', NULL, NULL, false);
INSERT INTO logbook (site_id, logbook_name, kind, subject, review_route) VALUES (pg_temp.cfl(), 'Rule sample weights', 'Sample weights', 'Sample', 'Batch');
INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, unit) VALUES
  (pg_temp.lbv('Rule sample weights'), 'balance', 'Balance', 'Equipment', 10, NULL), (pg_temp.lbv('Rule sample weights'), 'weight', 'Weight', 'Number', 20, 'g');
SELECT pg_temp.as_user('e.qa');
SELECT approve_logbook_version(pg_temp.lbv('Rule challenge inoculum')), approve_logbook_version(pg_temp.lbv('Rule sample weights'));
-- Moved to the Java backend in migration 070 (JUnit: LogbookDesignRulesTest): a sample weights logbook is reviewed in the batch
-- 2. the recovery test: {inoc.cfu_added} from the lot scanned at Inoculate
SELECT pg_temp.as_user('wd.ana');
SELECT create_test(pg_temp.cfl(), 'WD Recovery', (SELECT d.id FROM department d WHERE d.site_id = pg_temp.cfl() AND d.department_code = 'WDC'),
  (SELECT id FROM method WHERE method_name = 'WD Elemental impurities by ICP-MS' AND site_id = pg_temp.cfl() LIMIT 1));
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit) VALUES (pg_temp.rv(), pg_temp.sal(), 1, 'Numeric', 'CFU/g'), (pg_temp.rv(), pg_temp.lead(), 2, 'Numeric', 'CFU/g');
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.rv(), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 5, "qc": []}'),
 (pg_temp.rv(), 'weigh', 'Weigh', 'Weighing', 2, '{"target_mode": "None", "unit": "g"}'),
 (pg_temp.rv(), 'inoc', 'Inoculate', 'Preparation', 3, '{"fields": []}'),
 (pg_temp.rv(), 'count', 'Count', 'Data Entry', 4, '{"value_label": "CFU recovered", "require_attachment": false}'),
 (pg_temp.rv(), 'calc', 'Recovery', 'Calculation', 5, jsonb_build_object('formula', '{count.reading} / {inoc.cfu_added} * 100', 'result_unit', '%',
     'overrides', jsonb_build_array(jsonb_build_object('analyte_id', pg_temp.lead(), 'formula', '{count.reading} * 1')))),
 (pg_temp.rv(), 'review', 'QC Review', 'QC Review', 6, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES
 (pg_temp.rst('weigh'), pg_temp.rst('batch')), (pg_temp.rst('inoc'), pg_temp.rst('weigh')), (pg_temp.rst('count'), pg_temp.rst('inoc')),
 (pg_temp.rst('calc'), pg_temp.rst('count')), (pg_temp.rst('review'), pg_temp.rst('calc'));
INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) SELECT pg_temp.rst('weigh'), id, true FROM equipment_type WHERE site_id = pg_temp.cfl() AND type_name = 'WD Balance';
SELECT pg_temp.expect_true('A material step offers the values the lab''s logbooks publish ({inoc.cfu_added}, {inoc.cfu_per_ml})',
  'cfu_added' = ANY (step_token_fields(pg_temp.rst('inoc'))) AND 'cfu_per_ml' = ANY (step_token_fields(pg_temp.rst('inoc'))) AND NOT ('cfu_added' = ANY (step_token_fields(pg_temp.rst('calc')))));
SELECT pg_temp.expect_true('The design accepts the formula reading the lot''s value (no Error)', NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.rv()) p WHERE p.severity = 'Error'));
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.rv());
SELECT pg_temp.as_user('akiddle');
UPDATE test_catalog_entry SET base_price = 50 WHERE test_id = (SELECT id FROM test WHERE test_name = 'WD Recovery');
INSERT INTO project (client_id, project_name) SELECT client_id, 'WD Recovery project' FROM lab_order WHERE order_code = 'LO-000003';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'WD Recovery project'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price)
  SELECT pv.id, x.id, 3, 50 FROM project_version pv JOIN project p ON p.id = pv.project_id, test x WHERE p.project_name = 'WD Recovery project' AND x.test_name = 'WD Recovery';
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Recovery project');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam@acme.com') WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Recovery project');
INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, quantity_received, quantity_unit, number_of_units)
  SELECT id, x.cs, 'Recovery test product', 'Powder', 100, 'g', 1 FROM lab_order, (VALUES ('WD-REC-1'), ('WD-REC-2')) x(cs) WHERE po_number = 'WD-PO-SPLIT';
SELECT order_test((SELECT id FROM sample WHERE client_sample_id = 'WD-REC-1'),
  (SELECT q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id WHERE p.project_name = 'WD Recovery project'));
SELECT log_samples(ARRAY(SELECT id FROM sample WHERE client_sample_id = 'WD-REC-1'));

-- 3. the aliquots (weighed by p.qa, who also reviews: so someone else must review the batch) and the inocula
SELECT pg_temp.as_user('p.qa');
SELECT pg_temp.expect_ok('An aliquot of WD-REC-1 is weighed on WD Balance 1 (signed)',
  $$INSERT INTO logbook_entry (logbook_id, sample_id, entry_values) VALUES (pg_temp.lb('Rule sample weights'), (SELECT id FROM sample WHERE client_sample_id = 'WD-REC-1'), '{"balance": "WD Balance 1", "weight": 10.04}')$$);
INSERT INTO logbook_entry (logbook_id, sample_id, entry_values) VALUES (pg_temp.lb('Rule sample weights'), (SELECT id FROM sample WHERE client_sample_id = 'WD-REC-1'), '{"balance": "WD Balance 1", "weight": 10.11}');
INSERT INTO logbook_entry (logbook_id, sample_id, entry_values) VALUES (pg_temp.lb('Rule sample weights'), (SELECT id FROM sample WHERE client_sample_id = 'WD-REC-2'), '{"balance": "WD Balance 1", "weight": 9.98}');
SELECT pg_temp.expect_true('The aliquot holds the balance (its id) and weight; reviewed in the batch, so not in QA''s queue',
  (SELECT entry_values->>'balance' = (SELECT id::text FROM equipment WHERE equipment_name = 'WD Balance 1') FROM pg_temp.aliq(1))
  AND NOT EXISTS (SELECT 1 FROM logbook_entry_view WHERE logbook_id = pg_temp.lb('Rule sample weights') AND review_due IS NOT NULL));
SELECT pg_temp.as_user('e.ana');
SELECT pg_temp.expect_ok('A challenge inoculum is made from the Salmonella culture (48 and 52 CFU: 500 per mL, 50 added)',
  $$INSERT INTO logbook_entry (logbook_id, entry_values) VALUES (pg_temp.lb('Rule challenge inoculum'), jsonb_build_object('culture_lot', (SELECT lot_code FROM inventory_lot WHERE item_name = 'WD Salmonella Typhimurium ATCC 14028'), 'count_1', 48, 'count_2', 52, 'volume_made', 5))$$);
INSERT INTO logbook_entry (logbook_id, entry_at, entry_values) VALUES (pg_temp.lb('Rule challenge inoculum'), now() - interval '25 hours',
  jsonb_build_object('culture_lot', (SELECT lot_code FROM inventory_lot WHERE item_name = 'WD Salmonella Typhimurium ATCC 14028'), 'count_1', 40, 'count_2', 44, 'volume_made', 5));
SELECT pg_temp.expect_true('Its lot is made, named after the culture, holding its organism; published: CFU added 50',
  (SELECT (e.entry_values->>'cfu_added')::numeric = 50 AND l.item_name LIKE 'Challenge inoculum: WD Salmonella%' FROM pg_temp.inoc_entry(1) e JOIN inventory_lot l ON l.id = e.lot_id));

-- 4. the bench
SELECT pg_temp.as_user('wd.ana');
SELECT create_batch(pg_temp.cfl(), pg_temp.rv());
SELECT complete_step(pg_temp.rrun('batch'));
SELECT pg_temp.expect_error_like('An aliquot of a sample not in the batch is refused', $$SELECT scan_aliquot(pg_temp.rrun('weigh'), (pg_temp.aliq(3)).entry_code)$$, 'which is not in');
SELECT pg_temp.expect_ok('Scanning the aliquot at Weigh fills the weight and the balance', $$SELECT scan_aliquot(pg_temp.rrun('weigh'), lower((pg_temp.aliq(1)).entry_code))$$);
SELECT pg_temp.expect_true('... 10.04 g, linked to the aliquot, and WD Balance 1 recorded for the sample',
  (SELECT value_num = 10.04 AND logbook_entry_id = (pg_temp.aliq(1)).id AND data->>'aliquot' = (pg_temp.aliq(1)).entry_code FROM entry_value WHERE step_run_id = pg_temp.rrun('weigh') AND entry_id = pg_temp.rsmp() AND status = 'Active')
  AND EXISTS (SELECT 1 FROM entry_equipment q JOIN equipment e ON e.id = q.equipment_id WHERE q.step_run_id = pg_temp.rrun('weigh') AND q.entry_id = pg_temp.rsmp() AND e.equipment_name = 'WD Balance 1' AND q.status = 'Active'));
SELECT pg_temp.expect_error_like('A typed weight cannot replace the aliquot''s', $$UPDATE entry_value SET value_num = 10.5 WHERE step_run_id = pg_temp.rrun('weigh') AND entry_id = pg_temp.rsmp() AND status = 'Active'$$, 'comes from aliquot');
SELECT pg_temp.expect_error_like('A weight is linked to an aliquot only by scanning it',
  $$UPDATE entry_value SET logbook_entry_id = (pg_temp.aliq(3)).id WHERE step_run_id = pg_temp.rrun('weigh') AND entry_id = pg_temp.rsmp() AND status = 'Active'$$, 'scanning the aliquot');
SELECT pg_temp.expect_ok('A repeat weighing (the second aliquot) is scanned in its place', $$SELECT scan_aliquot(pg_temp.rrun('weigh'), (pg_temp.aliq(2)).entry_code)$$);
SELECT pg_temp.expect_true('QC Review lists both aliquots of the sample: the one used (10.11 g) and the one replaced, with who weighed them and the balance''s calibration',
  (SELECT count(*) = 2 AND count(*) FILTER (WHERE used AND weight = 10.11) = 1 AND count(*) FILTER (WHERE NOT used AND weight = 10.04) = 1
          AND bool_and(weighed_by_name IS NOT NULL AND calibration IS NOT NULL AND balance_code IS NOT NULL) FROM batch_aliquots(pg_temp.rb())));
SELECT complete_step(pg_temp.rrun('weigh'));
SELECT pg_temp.expect_error_like('A lot past its validity window is refused at the scan',
  $$INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.rrun('inoc'), NULL, (pg_temp.inoc_entry(2)).lot_id, 'Strain', 0.1, 'mL')$$, 'past its validity|expired');
SELECT pg_temp.expect_ok('The fresh inoculum is scanned at Inoculate (0.1 mL)',
  $$INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.rrun('inoc'), NULL, (pg_temp.inoc_entry(1)).lot_id, 'Strain', 0.1, 'mL')$$);
SELECT pg_temp.expect_true('The scan picked its logbook entry (the only usable one)',
  (SELECT logbook_entry_id = (pg_temp.inoc_entry(1)).id FROM entry_material WHERE step_run_id = pg_temp.rrun('inoc') AND status = 'Active'));
SELECT complete_step(pg_temp.rrun('inoc'));
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) VALUES (pg_temp.rrun('count'), pg_temp.rsmp(), pg_temp.sal(), 46), (pg_temp.rrun('count'), pg_temp.rsmp(), pg_temp.lead(), 3);
SELECT pg_temp.expect_true('The recovery waits for QA to approve the inoculum''s entry (the bench work does not wait)',
  (SELECT x.value IS NULL AND x.waiting LIKE 'Waiting for QA to approve ' || (pg_temp.inoc_entry(1)).entry_code || '%' FROM pg_temp.calc() AS x(value numeric, waiting text)));
SELECT pg_temp.expect_true('A lot naming another organism is not used for an analyte it does not name',
  (SELECT waiting LIKE 'Waiting for the lot that gives cfu_added at "Inoculate" (for WD Lead)' FROM material_value(pg_temp.rrun('inoc'), pg_temp.rsmp(), pg_temp.lead(), 'cfu_added')));
SELECT pg_temp.as_user('e.qa');
SELECT approve_logbook_entries(ARRAY[(pg_temp.inoc_entry(1)).id]);
SELECT pg_temp.expect_true('Approved, the inoculum feeds the recovery: 46 / 50 x 100 = 92 %',
  (SELECT x.value = 92 AND x.waiting IS NULL FROM pg_temp.calc() AS x(value numeric, waiting text)));
SELECT pg_temp.as_user('wd.ana');
SELECT complete_step(pg_temp.rrun('count'));
SELECT complete_step(pg_temp.rrun('calc'));

-- 5. review: who weighed does not approve; the result keeps what it used
SELECT pg_temp.as_user('wd.sup');
SELECT approve_review_step(r.id) FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.rb() AND ws.step_type <> 'QC Review';
SELECT pg_temp.as_user('p.qa');
SELECT pg_temp.expect_error_like('The person who weighed the aliquot cannot approve the batch', $$SELECT approve_batch(pg_temp.rb())$$, 'You weighed');
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.expect_ok('Another reviewer approves it (signed)', $$SELECT approve_batch(pg_temp.rb())$$);
SELECT pg_temp.expect_true('The stored recovery is 92 % and keeps the inoculum''s values and the aliquot''s',
  (SELECT tr.value_num = 92 FROM test_result tr WHERE tr.batch_id = pg_temp.rb() AND tr.analyte_id = pg_temp.sal() AND tr.status = 'Active')
  AND (SELECT count(*) = 2 AND bool_or(u.via = 'Material' AND (u.entry_values->>'cfu_added')::numeric = 50) AND bool_or(u.via = 'Aliquot' AND (u.entry_values->>'weight')::numeric = 10.11)
         FROM logbook_result_use u JOIN test_result tr ON tr.id = u.test_result_id WHERE tr.batch_id = pg_temp.rb() AND tr.analyte_id = pg_temp.sal()));
SELECT pg_temp.expect_true('Approving the batch reviewed the aliquot used (Approved in the batch); the replaced one stays recorded',
  (SELECT status = 'Approved' AND approved_in_batch_id = pg_temp.rb() FROM pg_temp.aliq(2)) AND (SELECT status = 'Recorded' FROM pg_temp.aliq(1)));
SELECT pg_temp.expect_true('Nothing stops its release', logbook_release_problem((SELECT requested_test_id FROM test_result WHERE batch_id = pg_temp.rb() LIMIT 1)) IS NULL);
SELECT pg_temp.expect_true('The entry''s page lists the result that used it', EXISTS (SELECT 1 FROM logbook_entry_uses((pg_temp.inoc_entry(1)).id) u WHERE u.analyte_name = 'WD Salmonella' AND u.reported IS NOT NULL));

-- 6. a correction after use flags the result; release waits for a reviewer and QA
SELECT pg_temp.as_user('e.ana');
SELECT pg_temp.expect_error_like('An entry used by a result cannot be voided', $$SELECT void_logbook_entry((pg_temp.inoc_entry(1)).id, 'Wrong logbook')$$, 'cannot be voided');
SELECT pg_temp.as_user('e.sup');
SELECT set_config('lims.reason', 'Count 2 mistyped', false);
SELECT pg_temp.expect_ok('The inoculum''s count is corrected by a Lab Supervisor (reason and signature)',
  $$UPDATE logbook_entry SET entry_values = entry_values || '{"count_2": 62}' WHERE id = (pg_temp.inoc_entry(1)).id$$);
SELECT set_config('lims.reason', 'Bench work', false);
SELECT pg_temp.expect_true('The stored result is flagged (what it used, and the corrected values), and the entry goes back to QA',
  (SELECT f.status = 'Open' AND (f.used_values->>'cfu_added')::numeric = 50 AND (f.corrected_values->>'cfu_added')::numeric = 55
     FROM logbook_result_flag f JOIN test_result tr ON tr.id = f.test_result_id WHERE tr.batch_id = pg_temp.rb() AND tr.analyte_id = pg_temp.sal())
  AND (SELECT status = 'Recorded' FROM pg_temp.inoc_entry(1)));
SELECT pg_temp.expect_true('The stored result itself is not changed (92 %)', (SELECT value_num = 92 FROM test_result WHERE batch_id = pg_temp.rb() AND analyte_id = pg_temp.sal() AND status = 'Active'));
SELECT pg_temp.expect_true('Release is refused while the flag is open', logbook_release_problem((SELECT requested_test_id FROM test_result WHERE batch_id = pg_temp.rb() LIMIT 1)) LIKE '%was corrected after WD Salmonella used it%');
SELECT pg_temp.expect_error_like('Flags are made and resolved only by their steps', $$UPDATE logbook_result_flag SET status = 'Resolved'$$, 'Resolve');
SELECT pg_temp.expect_error_like('The person who corrected it does not resolve the flag (even with testing.review)',
  $$SELECT resolve_logbook_flag((SELECT f.id FROM logbook_result_flag f JOIN test_result tr ON tr.id = f.test_result_id WHERE tr.batch_id = pg_temp.rb() LIMIT 1), 'Fine')$$, 'someone else reviews');
SELECT pg_temp.as_user('e.ana');
SELECT pg_temp.expect_error_like('An analyst without testing.review does not resolve it',
  $$SELECT resolve_logbook_flag((SELECT f.id FROM logbook_result_flag f JOIN test_result tr ON tr.id = f.test_result_id WHERE tr.batch_id = pg_temp.rb() LIMIT 1), 'Fine')$$, 'testing.review');
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.expect_ok('A reviewer resolves it with a note',
  $$SELECT resolve_logbook_flag((SELECT f.id FROM logbook_result_flag f JOIN test_result tr ON tr.id = f.test_result_id WHERE tr.batch_id = pg_temp.rb() LIMIT 1), 'Recovery 84 %, still within 50 to 200 %: the result stands')$$);
SELECT pg_temp.expect_true('Release now waits for QA to approve the corrected entry', logbook_release_problem((SELECT requested_test_id FROM test_result WHERE batch_id = pg_temp.rb() LIMIT 1)) LIKE '%is not approved by QA%');
SELECT pg_temp.as_user('e.qa');
SELECT approve_logbook_entries(ARRAY[(pg_temp.inoc_entry(1)).id]);
SELECT pg_temp.expect_true('Approved again: nothing stops the release', logbook_release_problem((SELECT requested_test_id FROM test_result WHERE batch_id = pg_temp.rb() LIMIT 1)) IS NULL);

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
