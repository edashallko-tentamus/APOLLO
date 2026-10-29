-- Verification for migration 033 (serving size, Part B): replicate weighings averaged; the Serving weight and Density
-- tests; "Results per serving" ordering the serving test at its catalogue price; the approved result fed back to the
-- sample (unit weight x the label's count; the density); amounts per serving through the density; what stops a
-- per-serving result being released; the unplanned request waiting for the client's consent.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.methods_internal', '', false);
SELECT set_config('lims.group_sync', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (wrong error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.sv_as(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.sv_cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.sv_t(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test WHERE test_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.sv_v(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_version WHERE test_id = pg_temp.sv_t(n) ORDER BY version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.sv_st(n text, k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_step WHERE test_version_id = pg_temp.sv_v(n) AND step_key = k AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.sv_b(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_batch WHERE test_id = pg_temp.sv_t(n) ORDER BY batch_code DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.sv_r(n text, k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.sv_b(n) AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.sv_e(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.sv_b(n) AND entry_type = 'Sample' AND status = 'Active' LIMIT 1 $$;

-- three samples whose metals results are approved (per kg): for a solid, a liquid and the unplanned case
CREATE TEMP TABLE sv_smp AS
  SELECT s.id, row_number() OVER (ORDER BY s.created_at) AS n, tr.requested_test_id AS rt, tr.unit
    FROM sample s JOIN LATERAL (SELECT tr.requested_test_id, tr.unit FROM test_result tr JOIN requested_test r ON r.id = tr.requested_test_id
                                 WHERE r.sample_id = s.id AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.result_key IS NULL AND tr.unit IN ('mg/kg','ppm') LIMIT 1) tr ON true
    JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = pg_temp.sv_cfl() AND s.status <> 'Cancelled'
   LIMIT 3;
CREATE OR REPLACE FUNCTION pg_temp.sv_s(k int) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM sv_smp WHERE n = k $$;
CREATE OR REPLACE FUNCTION pg_temp.sv_rt(k int) RETURNS uuid LANGUAGE sql AS $$ SELECT rt FROM sv_smp WHERE n = k $$;
SELECT pg_temp.expect_true('(three CFL samples with approved results per kg)', (SELECT count(*) FROM sv_smp) = 3);

-------------------------------------------------------------------------------
-- 1. THE SERVING TESTS, WITH REPLICATE WEIGHINGS
-------------------------------------------------------------------------------
SELECT pg_temp.sv_as('akiddle');
INSERT INTO analyte (analyte_name, report_name, analyte_class) VALUES ('SV Unit weight', 'Average unit weight', 'Physical/General'), ('SV Density', 'Density', 'Physical/General');
SELECT pg_temp.sv_as('wd.ana');
SELECT create_test(pg_temp.sv_cfl(), 'SV Serving weight', (SELECT d.id FROM department d WHERE d.site_id = pg_temp.sv_cfl() AND d.department_code = 'WDC'), (SELECT id FROM method WHERE site_id = pg_temp.sv_cfl() ORDER BY created_at LIMIT 1));
SELECT create_test(pg_temp.sv_cfl(), 'SV Density', (SELECT d.id FROM department d WHERE d.site_id = pg_temp.sv_cfl() AND d.department_code = 'WDC'), (SELECT id FROM method WHERE site_id = pg_temp.sv_cfl() ORDER BY created_at LIMIT 1));
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, rounding_mode, rounding_digits)
  VALUES (pg_temp.sv_v('SV Serving weight'), (SELECT id FROM analyte WHERE analyte_name = 'SV Unit weight'), 1, 'Numeric', 'g', 'Decimal places', 4),
         (pg_temp.sv_v('SV Density'), (SELECT id FROM analyte WHERE analyte_name = 'SV Density'), 1, 'Numeric', 'g/mL', 'Decimal places', 3);
SELECT pg_temp.expect_error_like('Replicate weighings are 1 to 10',
  $$INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES (pg_temp.sv_v('SV Serving weight'), 'w11', 'Too many', 'Weighing', 9, '{"replicates": 11}')$$, '1 to 10');
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.sv_v('SV Serving weight'), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 10, "qc": []}'),
 (pg_temp.sv_v('SV Serving weight'), 'weigh', 'Weigh 10 units', 'Weighing', 2, '{"target_mode": "None", "unit": "g", "replicates": 10}'),
 (pg_temp.sv_v('SV Serving weight'), 'calc', 'Average unit weight', 'Calculation', 3, '{"formula": "{weigh.weight}", "result_unit": "g"}'),
 (pg_temp.sv_v('SV Serving weight'), 'review', 'QC Review', 'QC Review', 4, '{}'),
 (pg_temp.sv_v('SV Density'), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 10, "qc": []}'),
 (pg_temp.sv_v('SV Density'), 'read', 'Density', 'Data Entry', 2, '{"value_label": "Density", "value_unit": "g/mL", "require_attachment": false}'),
 (pg_temp.sv_v('SV Density'), 'review', 'QC Review', 'QC Review', 3, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES
 (pg_temp.sv_st('SV Serving weight', 'weigh'), pg_temp.sv_st('SV Serving weight', 'batch')), (pg_temp.sv_st('SV Serving weight', 'calc'), pg_temp.sv_st('SV Serving weight', 'weigh')),
 (pg_temp.sv_st('SV Serving weight', 'review'), pg_temp.sv_st('SV Serving weight', 'calc')),
 (pg_temp.sv_st('SV Density', 'read'), pg_temp.sv_st('SV Density', 'batch')), (pg_temp.sv_st('SV Density', 'review'), pg_temp.sv_st('SV Density', 'read'));
INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) SELECT pg_temp.sv_st('SV Serving weight', 'weigh'), id, true FROM equipment_type WHERE site_id = pg_temp.sv_cfl() AND type_name = 'WD Balance';
SELECT pg_temp.expect_true('(both serving tests have no errors)',
  NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.sv_v('SV Serving weight')) WHERE severity = 'Error') AND NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.sv_v('SV Density')) WHERE severity = 'Error'));
-- approved by a supervisor (the verification gate is set aside for these fixtures and put back)
SELECT pg_temp.sv_as('akiddle');
CREATE TEMP TABLE sv_gate AS SELECT require_workflow_verification AS g FROM lab_site WHERE site_code = 'CFL';
UPDATE lab_site SET require_workflow_verification = false WHERE site_code = 'CFL';
SELECT pg_temp.sv_as('wd.sup');
SELECT approve_test_version(pg_temp.sv_v('SV Serving weight'));
SELECT approve_test_version(pg_temp.sv_v('SV Density'));
SELECT pg_temp.sv_as('akiddle');
UPDATE lab_site SET require_workflow_verification = (SELECT g FROM sv_gate) WHERE site_code = 'CFL';
UPDATE test SET serving_role = 'Serving weight' WHERE test_name = 'SV Serving weight';
UPDATE test SET serving_role = 'Density' WHERE test_name = 'SV Density';
UPDATE test_catalog_entry SET base_price = 40 WHERE test_id = pg_temp.sv_t('SV Serving weight');
UPDATE test_catalog_entry SET base_price = 55 WHERE test_id = pg_temp.sv_t('SV Density');
SELECT pg_temp.expect_error_like('A test''s serving role is Serving weight or Density', $$UPDATE test SET serving_role = 'Volume' WHERE test_name = 'SV Density'$$, 'serving_role');

-------------------------------------------------------------------------------
-- 2. RESULTS PER SERVING ORDER THE SERVING TEST (SOLID)
-------------------------------------------------------------------------------
-- Moved to the Java backend in migration 063 (JUnit: OrderRulesTest): The measured unit weight is never typed
-- since 063 the Java backend orders the serving test when "Results per serving" is ticked (JUnit: OrderRulesTest); here the same order is placed
UPDATE sample SET serving_count = 2, serving_count_unit = 'sccapsule', serving_size = 1.2, serving_unit = 'g', report_per_serving = true WHERE id = pg_temp.sv_s(1);
SELECT order_serving_test(pg_temp.sv_s(1), 'Serving weight');
SELECT pg_temp.expect_true('"Results per serving" on a sample served by weight orders the Serving weight test, at its catalogue price ($40, not on the quote)',
  (SELECT r.serving_order AND r.price = 40 AND r.list_price = 40 AND r.status <> 'Cancelled' FROM requested_test r WHERE r.sample_id = pg_temp.sv_s(1) AND r.test_id = pg_temp.sv_t('SV Serving weight')));
UPDATE sample SET report_per_serving = false WHERE id = pg_temp.sv_s(1);
UPDATE sample SET report_per_serving = true WHERE id = pg_temp.sv_s(1);
SELECT order_serving_test(pg_temp.sv_s(1), 'Serving weight');
SELECT pg_temp.expect_true('Ticked again: the serving test is ordered once', (SELECT count(*) FROM requested_test r WHERE r.sample_id = pg_temp.sv_s(1) AND r.test_id = pg_temp.sv_t('SV Serving weight')) = 1);
SELECT pg_temp.expect_true('Until it is approved, the per-serving results are held: "waiting for SV Serving weight"',
  serving_problem(pg_temp.sv_rt(1)) LIKE 'waiting for SV Serving weight%');

-- the bench: 10 weighings, averaged
SELECT pg_temp.sv_as('wd.ana');
SELECT create_batch(pg_temp.sv_cfl(), pg_temp.sv_v('SV Serving weight'));
SELECT complete_step(pg_temp.sv_r('SV Serving weight', 'batch'));
INSERT INTO entry_value (step_run_id, entry_id, run_no, value_num)
  SELECT pg_temp.sv_r('SV Serving weight', 'weigh'), pg_temp.sv_e('SV Serving weight'), g, 0.590 + g * 0.002 FROM generate_series(1, 9) g;
SELECT pg_temp.expect_true('9 of 10 weights: the step says so, and no average is used yet',
  (SELECT string_agg(problem, ' | ') FROM step_run_missing(pg_temp.sv_r('SV Serving weight', 'weigh'))) LIKE '%9 of 10 weights%'
  AND entry_weight(pg_temp.sv_r('SV Serving weight', 'weigh'), pg_temp.sv_e('SV Serving weight')) IS NULL);
SELECT pg_temp.expect_error_like('There is no 11th weighing', $$INSERT INTO entry_value (step_run_id, entry_id, run_no, value_num) VALUES (pg_temp.sv_r('SV Serving weight', 'weigh'), pg_temp.sv_e('SV Serving weight'), 10, 0.6), (pg_temp.sv_r('SV Serving weight', 'weigh'), pg_temp.sv_e('SV Serving weight'), 11, 0.6)$$, 'no weighing 11');
INSERT INTO entry_value (step_run_id, entry_id, run_no, value_num) VALUES (pg_temp.sv_r('SV Serving weight', 'weigh'), pg_temp.sv_e('SV Serving weight'), 10, 0.610);
SELECT pg_temp.expect_true('10 weights (0.592 to 0.610 g): the weight the formula uses is their average, 0.601 g',
  entry_weight(pg_temp.sv_r('SV Serving weight', 'weigh'), pg_temp.sv_e('SV Serving weight')) = 0.601
  AND (SELECT value FROM batch_results(pg_temp.sv_b('SV Serving weight')) WHERE is_final) = 0.601
  AND NOT EXISTS (SELECT 1 FROM step_run_missing(pg_temp.sv_r('SV Serving weight', 'weigh')) WHERE problem LIKE '%weight%'));
INSERT INTO entry_equipment (step_run_id, equipment_id) VALUES (pg_temp.sv_r('SV Serving weight', 'weigh'), (SELECT id FROM equipment WHERE equipment_name = 'WD Balance 1'));
SELECT complete_step(pg_temp.sv_r('SV Serving weight', 'weigh'));
SELECT complete_step(pg_temp.sv_r('SV Serving weight', 'calc'));
SELECT pg_temp.sv_as('wd.sup');
SELECT approve_review_step(s.step_run_id) FROM review_step_runs(pg_temp.sv_b('SV Serving weight')) s;
SELECT approve_batch(pg_temp.sv_b('SV Serving weight'));
SELECT pg_temp.expect_true('Approved: the unit weight goes back to the sample (0.601 g, linked to the result); the serving weight is 2 x 0.601 = 1.202 g',
  (SELECT unit_weight = 0.601 AND unit_weight_unit = 'g' AND unit_weight_result_id IS NOT NULL AND serving_size = 1.202 AND serving_unit = 'g' FROM sample WHERE id = pg_temp.sv_s(1))
  AND EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'sample' AND record_id = pg_temp.sv_s(1) AND reason LIKE '%approved result%' OR (table_name = 'sample' AND record_id = pg_temp.sv_s(1) AND changed_fields ? 'unit_weight')));
SELECT pg_temp.expect_true('Measured and used: nothing holds the per-serving results now; 10 mg/kg in 1.202 g is 0.01202 mg per serving',
  serving_problem(pg_temp.sv_rt(1)) IS NULL AND (SELECT round(value, 6) = 0.01202 AND unit = 'mg per serving' FROM sample_per_serving(10, 'mg/kg', pg_temp.sv_s(1))));
SELECT pg_temp.sv_as('akiddle');
UPDATE sample SET serving_count = 3 WHERE id = pg_temp.sv_s(1);
SELECT pg_temp.expect_true('The label''s count changed to 3: the serving weight follows (1.803 g)', (SELECT serving_size = 1.803 FROM sample WHERE id = pg_temp.sv_s(1)));

-------------------------------------------------------------------------------
-- 3. A LIQUID: THE DENSITY
-------------------------------------------------------------------------------
UPDATE sample SET serving_size = 15, serving_unit = 'mL', report_per_serving = true WHERE id = pg_temp.sv_s(2);
SELECT order_serving_test(pg_temp.sv_s(2), 'Density');
SELECT pg_temp.expect_true('A serving by volume orders the Density test ($55)',
  (SELECT r.serving_order AND r.price = 55 FROM requested_test r WHERE r.sample_id = pg_temp.sv_s(2) AND r.test_id = pg_temp.sv_t('SV Density')));
SELECT pg_temp.sv_as('wd.ana');
SELECT create_batch(pg_temp.sv_cfl(), pg_temp.sv_v('SV Density'));
SELECT complete_step(pg_temp.sv_r('SV Density', 'batch'));
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num) VALUES (pg_temp.sv_r('SV Density', 'read'), pg_temp.sv_e('SV Density'), (SELECT id FROM analyte WHERE analyte_name = 'SV Density'), 1, 1.05);
SELECT complete_step(pg_temp.sv_r('SV Density', 'read'));
SELECT pg_temp.expect_true('Before the density is approved: a result per kg cannot be put per 15 mL',
  (SELECT value IS NULL FROM sample_per_serving(10, 'mg/kg', pg_temp.sv_s(2))) AND serving_problem(pg_temp.sv_rt(2)) LIKE 'waiting for SV Density%');
SELECT pg_temp.sv_as('wd.sup');
SELECT approve_review_step(s.step_run_id) FROM review_step_runs(pg_temp.sv_b('SV Density')) s;
SELECT approve_batch(pg_temp.sv_b('SV Density'));
SELECT pg_temp.expect_true('Approved density 1.05 g/mL: 15 mL is 15.75 g; 10 mg/kg is 0.1575 mg per serving; nothing holds the release',
  (SELECT density = 1.05 AND density_unit = 'g/mL' AND density_result_id IS NOT NULL FROM sample WHERE id = pg_temp.sv_s(2))
  AND (SELECT round(value, 6) = 0.1575 FROM sample_per_serving(10, 'mg/kg', pg_temp.sv_s(2))) AND serving_problem(pg_temp.sv_rt(2)) IS NULL);
SELECT pg_temp.expect_true('A result per volume uses the 15 mL directly (2 mg/mL is 30 mg per serving)', (SELECT value = 30 FROM sample_per_serving(2, 'mg/mL', pg_temp.sv_s(2))));

-------------------------------------------------------------------------------
-- 4. UNPLANNED: A LIMIT PER SERVING NOBODY ASKED THE SERVING FOR
-------------------------------------------------------------------------------
SELECT pg_temp.sv_as('akiddle');
INSERT INTO specification (requested_test_id, analyte_id, max_value, unit, source, basis)
  SELECT pg_temp.sv_rt(3), tr.analyte_id, 1, 'mg', 'Client', 'Per serving' FROM test_result tr
   WHERE tr.requested_test_id = pg_temp.sv_rt(3) AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.result_key IS NULL
     AND NOT EXISTS (SELECT 1 FROM specification sp WHERE sp.requested_test_id = tr.requested_test_id AND sp.analyte_id = tr.analyte_id AND sp.status = 'Active') LIMIT 1;
SELECT pg_temp.expect_true('A limit per serving with no serving on the sample: held ("the sample has no serving")', serving_problem(pg_temp.sv_rt(3)) LIKE 'the sample has no serving%');
UPDATE sample SET serving_size = 1, serving_unit = 'g' WHERE id = pg_temp.sv_s(3);
SELECT pg_temp.expect_true('The label''s 1 g is not enough: held until the serving weight is measured', serving_problem(pg_temp.sv_rt(3)) LIKE 'the serving weight is not measured%');
SELECT request_serving_test(pg_temp.sv_s(3), 'Serving weight', 'Found at report review');
SELECT pg_temp.expect_true('The request for the Serving weight test waits for the client''s consent (no bench step behind it)',
  (SELECT status = 'Awaiting consent' AND serving_role = 'Serving weight' AND step_run_id IS NULL AND test_id = pg_temp.sv_t('SV Serving weight') FROM split_request WHERE sample_id = pg_temp.sv_s(3)));
SELECT pg_temp.expect_true('(it is listed with the sample''s split-off requests)', EXISTS (SELECT 1 FROM split_request_view WHERE sample_id = pg_temp.sv_s(3) AND serving_role = 'Serving weight'));
SELECT pg_temp.expect_error_like('One request at a time', $$SELECT request_serving_test(pg_temp.sv_s(3), 'Serving weight', 'again')$$, 'already waits');
SELECT decide_split_request((SELECT id FROM split_request WHERE sample_id = pg_temp.sv_s(3) AND serving_role = 'Serving weight'), 'Consent given', 'Client agreed by email to the serving weight test');
SELECT pg_temp.expect_true('Consent given: the Serving weight test is ordered at its catalogue price and the request is closed (Ordered)',
  (SELECT status = 'Ordered' AND ordered_requested_test_id IS NOT NULL FROM split_request WHERE sample_id = pg_temp.sv_s(3) AND serving_role = 'Serving weight')
  AND (SELECT r.serving_order AND r.price = 40 FROM requested_test r WHERE r.sample_id = pg_temp.sv_s(3) AND r.test_id = pg_temp.sv_t('SV Serving weight')));
SELECT pg_temp.expect_true('Still held until it is approved', serving_problem(pg_temp.sv_rt(3)) LIKE 'waiting for SV Serving weight%');
SELECT pg_temp.expect_error_like('Once ordered, no second request', $$SELECT request_serving_test(pg_temp.sv_s(3), 'Serving weight', 'x')$$, 'already ordered');

SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
