-- Sandbox demo data for migration 021 (WD-5, preliminary results): a small stability test, "Vitamin C stability (demo)",
-- assayed on day 0, day 7 and day 14. Day 7 has its own QC Review (a timepoint) that releases the day 0 assay and the
-- day 7 "% of initial" as preliminary results; day 14 is the final result. Acme Irvine sends one batch of Vitamin C
-- tablets; the demo analyst has done day 0 and day 7, so day 7 is ready for review. Skipped whole if the demo records
-- were changed, so it never stops the app from starting.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); acme uuid := (SELECT id FROM client WHERE legal_name = 'Acme Nutrition Irvine Site');
        chem uuid; v_m uuid; t_vc uuid; v uuid; v_pv uuid; v_line uuid; v_order uuid; v_s uuid; v_batch uuid; e uuid; vc uuid;
BEGIN
    SELECT id INTO chem FROM department WHERE site_id = cfl AND department_code = 'CHEM';
    IF chem IS NULL OR acme IS NULL OR EXISTS (SELECT 1 FROM test WHERE test_name = 'Vitamin C stability (demo)') THEN RETURN; END IF;

    -- the analyte (master data)
    IF NOT EXISTS (SELECT 1 FROM analyte WHERE analyte_name = 'Vitamin C') THEN
        INSERT INTO analyte (analyte_name, report_name, analyte_class, cas_number, synonyms) VALUES ('Vitamin C', 'Vitamin C (ascorbic acid)', 'Chemical', '50-81-7', '{Ascorbic acid}');
    END IF;
    SELECT id INTO vc FROM analyte WHERE analyte_name = 'Vitamin C';

    -- the test, designed by the demo analyst and approved by the demo Lab Supervisor
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    INSERT INTO method (site_id, method_name, sop_code) VALUES (cfl, 'Vitamin C by HPLC (stability)', 'SOP-CHEM-210') RETURNING id INTO v_m;
    t_vc := create_test(cfl, 'Vitamin C stability (demo)', chem, v_m);
    SELECT id INTO v FROM test_version WHERE test_id = t_vc;
    UPDATE test_version SET procedure_text = 'Assay on day 0, then % of the day 0 assay on day 7 and day 14 (stored at 40 °C / 75 % RH). Day 7 is reviewed and released on its own as a preliminary result.' WHERE id = v;
    INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, loq, lod) VALUES (v, vc, 1, 'Numeric', '%', 1, 0.5);
    INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
     (v, 'batch', 'Batch', 'Batching', 1, '{"max_samples": 10, "qc": []}'),
     (v, 'read_0', 'Day 0: assay', 'Data Entry', 2, '{"value_label": "Vitamin C", "value_unit": "mg/g", "require_attachment": false}'),
     (v, 'calc_0', 'Day 0: result', 'Calculation', 3, '{"formula": "{read_0.reading} * 1", "result_unit": "mg/g", "note": "The day 0 assay"}'),
     (v, 'read_7', 'Day 7: assay', 'Data Entry', 4, '{"value_label": "Vitamin C", "value_unit": "mg/g", "require_attachment": false}'),
     (v, 'calc_7', 'Day 7: % of initial', 'Calculation', 5, '{"formula": "{read_7.reading} / {calc_0.result} * 100", "result_unit": "%"}'),
     (v, 'rv_7', 'Day 7: QC Review', 'QC Review', 6, '{"scope": "Timepoint"}'),
     (v, 'read_14', 'Day 14: assay', 'Data Entry', 7, '{"value_label": "Vitamin C", "value_unit": "mg/g", "require_attachment": false}'),
     (v, 'calc_14', 'Day 14: % of initial', 'Calculation', 8, '{"formula": "{read_14.reading} / {calc_0.result} * 100", "result_unit": "%"}'),
     (v, 'review', 'QC Review', 'QC Review', 9, '{}');
    INSERT INTO workflow_step_dependency (step_id, depends_on_step_id, dependency_type)
    SELECT (SELECT id FROM workflow_step WHERE test_version_id = v AND step_key = d.a), (SELECT id FROM workflow_step WHERE test_version_id = v AND step_key = d.b), d.t::dependency_type
      FROM (VALUES ('read_0', 'batch', 'Sequential'), ('calc_0', 'read_0', 'Sequential'), ('read_7', 'read_0', 'Sequential'), ('calc_7', 'read_7', 'Sequential'),
                   ('calc_7', 'calc_0', 'Sequential'), ('rv_7', 'calc_7', 'Parallel'), ('read_14', 'read_7', 'Sequential'), ('calc_14', 'read_14', 'Sequential'),
                   ('calc_14', 'calc_0', 'Sequential'), ('review', 'calc_14', 'Sequential')) AS d(a, b, t);
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM approve_test_version(v);

    -- quoted, accepted and ordered on one batch of tablets
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
    PERFORM script_signature('Sandbox demo data');
    UPDATE test_catalog_entry SET base_price = 450 WHERE test_id = t_vc;
    INSERT INTO project (client_id, project_name, purpose) VALUES (acme, 'Vitamin C tablets accelerated stability', 'Day 0, 7 and 14 at 40 °C / 75 % RH');
    v_pv := new_project_version((SELECT id FROM project WHERE project_name = 'Vitamin C tablets accelerated stability'));
    INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (v_pv, t_vc, 3);
    UPDATE quoted_test_configuration SET final_price = list_price WHERE project_version_id = v_pv;
    UPDATE project_version SET status = 'Quoted', valid_until = current_date + 60 WHERE id = v_pv;
    UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam.nguyen@example-acme.com') WHERE id = v_pv;
    SELECT line_id INTO v_line FROM orderable_lines(acme) WHERE test_id = t_vc LIMIT 1;
    INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, po_number, status)
    SELECT acme, cfl, ct.id, 'Online', 'PO-45180', 'Submitted' FROM contact ct WHERE ct.email = 'sam.nguyen@example-acme.com' RETURNING id INTO v_order;
    INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, quantity_received, quantity_unit, number_of_units, condition, receipt_temperature)
    VALUES (v_order, 'VC-2207', 'Vitamin C 500 mg tablets (stability pull set)', 'Tablet', 60, 'g', 1, 'Acceptable', 21.0) RETURNING id INTO v_s;
    PERFORM order_test(v_s, v_line);
    PERFORM log_samples(ARRAY[v_s]);

    -- the demo analyst batches it and does day 0 and day 7: day 7 is ready for its review
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    v_batch := create_batch(cfl, v);
    SELECT id INTO e FROM batch_entry WHERE batch_id = v_batch AND entry_type = 'Sample' LIMIT 1;
    PERFORM complete_step((SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_key = 'batch'));
    INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num)
    VALUES ((SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_key = 'read_0'), e, vc, 498.0);
    PERFORM complete_step((SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_key = 'read_0'));
    PERFORM complete_step((SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_key = 'calc_0'));
    INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num)
    VALUES ((SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_key = 'read_7'), e, vc, 489.0);
    PERFORM complete_step((SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_key = 'read_7'));
    PERFORM complete_step((SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_key = 'calc_7'));
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
EXCEPTION WHEN others THEN
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
    RAISE NOTICE 'WD-5 demo data skipped: %', SQLERRM;
END $$;

COMMIT;
