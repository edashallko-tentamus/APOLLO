-- Sandbox demo data for migration 033 (serving size, Part B): CFL's two serving tests, designed by the demo analyst.
--  - "Serving weight (10 units)": a Weighing step with 10 replicate weighings on the top-loading balance; the result
--    is their average (the average unit weight, g). Catalogue price $45 (illustrative).
--  - "Density (g/mL)": the density read and entered. Catalogue price $60 (illustrative).
-- They are approved by the demo Lab Supervisor only when CFL's workflow verification gate is off. With the gate on
-- (fresh databases, and Alex's data as he set it) they stay Drafts: verify them from the version's Review tab
-- (Write the verification protocol, QA approves, execute, QA signs the report), then approve.
-- Skipped whole if the tests already exist, so it never stops the app from starting.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); chem uuid; v_m uuid; t_w uuid; t_d uuid; v_w uuid; v_d uuid;
        a_w uuid; a_d uuid; bal uuid; gate boolean;
BEGIN
    SELECT id INTO chem FROM department WHERE site_id = cfl AND department_code = 'CHEM';
    SELECT id INTO bal FROM equipment_type WHERE site_id = cfl AND type_name = 'Top-loading balance';
    IF cfl IS NULL OR chem IS NULL OR NOT EXISTS (SELECT 1 FROM app_user WHERE username IN ('analyst')) OR NOT EXISTS (SELECT 1 FROM app_user WHERE username = 'labsup')
       OR EXISTS (SELECT 1 FROM test WHERE site_id = cfl AND lower(test_name) IN ('serving weight (10 units)', 'density (g/ml)')) THEN RETURN; END IF;

    IF NOT EXISTS (SELECT 1 FROM analyte WHERE lower(analyte_name) = 'average unit weight') THEN
        INSERT INTO analyte (analyte_name, report_name, analyte_class) VALUES ('Average unit weight', 'Average unit weight', 'Physical/General');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM analyte WHERE lower(analyte_name) = 'density') THEN
        INSERT INTO analyte (analyte_name, report_name, analyte_class) VALUES ('Density', 'Density', 'Physical/General');
    END IF;
    SELECT id INTO a_w FROM analyte WHERE lower(analyte_name) = 'average unit weight';
    SELECT id INTO a_d FROM analyte WHERE lower(analyte_name) = 'density';

    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    INSERT INTO method (site_id, method_name, sop_code) VALUES (cfl, 'Serving weight and density of dietary supplements', 'SOP-CHEM-300') RETURNING id INTO v_m;
    t_w := create_test(cfl, 'Serving weight (10 units)', chem, v_m);
    t_d := create_test(cfl, 'Density (g/mL)', chem, v_m);
    SELECT id INTO v_w FROM test_version WHERE test_id = t_w;
    SELECT id INTO v_d FROM test_version WHERE test_id = t_d;
    INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, rounding_mode, rounding_digits) VALUES
      (v_w, a_w, 1, 'Numeric', 'g', 'Decimal places', 4), (v_d, a_d, 1, 'Numeric', 'g/mL', 'Decimal places', 3);
    INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
      (v_w, 'batch', 'Batch', 'Batching', 1, '{"max_samples": 10, "qc": []}'),
      (v_w, 'weigh', 'Weigh 10 units', 'Weighing', 2, '{"target_mode": "None", "unit": "g", "replicates": 10}'),
      (v_w, 'calc', 'Average unit weight', 'Calculation', 3, '{"formula": "{weigh.weight}", "result_unit": "g", "note": "The average of the 10 units weighed"}'),
      (v_w, 'review', 'QC Review', 'QC Review', 4, '{}'),
      (v_d, 'batch', 'Batch', 'Batching', 1, '{"max_samples": 10, "qc": []}'),
      (v_d, 'read', 'Density', 'Data Entry', 2, '{"value_label": "Density at 20 °C", "value_unit": "g/mL", "require_attachment": false}'),
      (v_d, 'review', 'QC Review', 'QC Review', 3, '{}');
    INSERT INTO workflow_step_dependency (step_id, depends_on_step_id)
    SELECT a.id, b.id FROM (VALUES (v_w, 'weigh', 'batch'), (v_w, 'calc', 'weigh'), (v_w, 'review', 'calc'), (v_d, 'read', 'batch'), (v_d, 'review', 'read')) x(v, s, dep)
      JOIN workflow_step a ON a.test_version_id = x.v AND a.step_key = x.s JOIN workflow_step b ON b.test_version_id = x.v AND b.step_key = x.dep;
    IF bal IS NOT NULL THEN
        INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) SELECT id, bal, true FROM workflow_step WHERE test_version_id = v_w AND step_key = 'weigh';
    END IF;

    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
    PERFORM script_signature('Sandbox demo data');
    UPDATE test SET serving_role = 'Serving weight' WHERE id = t_w;
    UPDATE test SET serving_role = 'Density' WHERE id = t_d;
    UPDATE test_catalog_entry SET base_price = 45, standard_tat = 3, description = 'Serving weight: 10 units weighed one by one, the average unit weight' WHERE test_id = t_w;
    UPDATE test_catalog_entry SET base_price = 60, standard_tat = 3, description = 'Density of a liquid, for results per serving by volume' WHERE test_id = t_d;

    SELECT require_workflow_verification INTO gate FROM lab_site WHERE id = cfl;
    IF NOT COALESCE(gate, false) THEN
        PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
        PERFORM script_signature('Sandbox demo data');
        PERFORM approve_test_version(v_w);
        PERFORM approve_test_version(v_d);
    END IF;
END $$;

COMMIT;
