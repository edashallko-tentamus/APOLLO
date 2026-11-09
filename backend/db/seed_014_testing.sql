-- Sandbox demo data for migration 016 (WD-2, chemistry execution): Acme Irvine accepts a heavy metals quote and sends
-- six supplements to CFL (one rush); a multi-element spiking solution and an ICP-MS check standard with their
-- concentrations; a second ICP-MS and a microwave digester. The demo analyst has batched the first four
-- samples (Batching signed, weighing under way); the other two wait in the Chemistry backlog.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); acme uuid := (SELECT id FROM client WHERE legal_name = 'Acme Nutrition Irvine Site');
        t_icp uuid; v_line uuid; v_pv uuid; v_order uuid; v_ids uuid[] := '{}'; v_s uuid; x record; v_batch uuid; v_lot uuid; chem uuid; e record;
BEGIN
    SELECT id INTO t_icp FROM test WHERE site_id = cfl AND test_name = 'Heavy Metals (Pb, Cd, As, Hg) by ICP-MS';
    IF t_icp IS NULL OR acme IS NULL OR EXISTS (SELECT 1 FROM test_batch) THEN RETURN; END IF;
    SELECT id INTO chem FROM department WHERE site_id = cfl AND department_code = 'CHEM';

    -- the client's accepted quote for heavy metals release testing (the "Supplement release" draft stays a draft for the designer demo)
    IF NOT EXISTS (SELECT 1 FROM project WHERE project_name = 'Supplement heavy metals (USP <232>/<233>)') THEN
        INSERT INTO project (client_id, project_name, purpose) VALUES (acme, 'Supplement heavy metals (USP <232>/<233>)', 'Heavy metals on finished supplements');
        v_pv := new_project_version((SELECT id FROM project WHERE project_name = 'Supplement heavy metals (USP <232>/<233>)'));
        INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (v_pv, t_icp, 12);
        UPDATE quoted_test_configuration SET final_price = list_price WHERE project_version_id = v_pv;
        UPDATE project_version SET status = 'Quoted', valid_until = current_date + 60 WHERE id = v_pv;
        UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam.nguyen@example-acme.com') WHERE id = v_pv;
    END IF;
    SELECT line_id INTO v_line FROM orderable_lines(acme) WHERE test_id = t_icp LIMIT 1;
    IF v_line IS NULL THEN RETURN; END IF;

    -- six supplements for heavy metals
    INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, po_number, status)
    SELECT acme, cfl, ct.id, 'Online', 'PO-45102', 'Submitted' FROM contact ct WHERE ct.email = 'sam.nguyen@example-acme.com' RETURNING id INTO v_order;
    FOR x IN SELECT * FROM (VALUES (1, 'MV-2201', 'Multivitamin tablets', 'Tablet'), (2, 'TUR-2202', 'Turmeric capsules', 'Capsule'), (3, 'ASH-2203', 'Ashwagandha root powder', 'Powder'),
                                   (4, 'SPI-2204', 'Spirulina tablets', 'Tablet'), (5, 'GRN-2205', 'Greens blend powder', 'Powder'), (6, 'MAG-2206', 'Magnesium glycinate capsules', 'Capsule')) v(n, cid, d, m) ORDER BY n LOOP
        INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, quantity_received, quantity_unit, number_of_units, condition, receipt_temperature)
        VALUES (v_order, x.cid, x.d, x.m, 120, 'g', 1, 'Acceptable', 21.0) RETURNING id INTO v_s;
        PERFORM order_test(v_s, v_line);
        v_ids := v_ids || v_s;
    END LOOP;
    UPDATE requested_test SET rush_tier_id = (SELECT rt.id FROM rush_fee_tier rt JOIN rush_fee_schedule s ON s.id = rt.schedule_id WHERE s.schedule_name = 'Chemistry Rush' AND rt.tier_name = '48 Hour')
     WHERE sample_id = v_ids[5] AND test_id = t_icp;
    PERFORM log_samples(v_ids);

    -- the spiking solution and the check standard, with their concentrations
    INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date, notes)
    VALUES (cfl, 'Multi-element spike (Pb, Cd, As, Hg) 10 mg/L', '{"Reference Standard"}', 'IV-SPK-2609', 100, 'mL', current_date + 180, 'Spikes the LCS and matrix spikes: 0.5 mL into 0.5 g = 10 mg/kg')
    RETURNING id INTO v_lot;
    INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit)
    SELECT v_lot, id, CASE WHEN analyte_name = 'Mercury' THEN 1 ELSE 10 END, 'mg/L' FROM analyte WHERE analyte_name IN ('Lead', 'Cadmium', 'Arsenic', 'Mercury');
    INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date, notes)
    VALUES (cfl, 'ICP-MS check standard (Pb, Cd, As, Hg) 50 µg/L', '{"Reference Standard"}', 'IV-CHK-2609', 250, 'mL', current_date + 90, 'ICV and CCV')
    RETURNING id INTO v_lot;
    INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit)
    SELECT v_lot, id, CASE WHEN analyte_name = 'Mercury' THEN 5 ELSE 50 END, 'µg/L' FROM analyte WHERE analyte_name IN ('Lead', 'Cadmium', 'Arsenic', 'Mercury');

    -- a second ICP-MS (ICP-MS 1 is due for maintenance, so the hourly job tags it out and the bench refuses it)
    IF NOT EXISTS (SELECT 1 FROM equipment WHERE equipment_name = 'ICP-MS 2 (heavy metals)') AND EXISTS (SELECT 1 FROM equipment_type WHERE site_id = cfl AND type_name = 'ICP-MS') THEN
        INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, serial_number, calibration_required)
        VALUES (cfl, 'ICP-MS 2 (heavy metals)', (SELECT id FROM equipment_type WHERE site_id = cfl AND type_name = 'ICP-MS'), chem, 'Agilent', 'ICPMS-7900-B', false);
        INSERT INTO equipment_owner (equipment_id, group_id)
        SELECT e2.id, g.id FROM equipment e2, lab_group g WHERE e2.equipment_name = 'ICP-MS 2 (heavy metals)' AND g.site_id = cfl AND g.group_name = 'Lab Supervisor';
    END IF;
    -- a microwave digester for the digestion step
    IF EXISTS (SELECT 1 FROM equipment_type WHERE site_id = cfl AND type_name = 'Microwave digester') AND NOT EXISTS (SELECT 1 FROM equipment WHERE equipment_name = 'Microwave digester 1') THEN
        INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, serial_number, calibration_required)
        VALUES (cfl, 'Microwave digester 1', (SELECT id FROM equipment_type WHERE site_id = cfl AND type_name = 'Microwave digester'), chem, 'CEM', 'MARS6-2291', false);
        INSERT INTO equipment_owner (equipment_id, group_id)
        SELECT e2.id, g.id FROM equipment e2, lab_group g WHERE e2.equipment_name = 'Microwave digester 1' AND g.site_id = cfl AND g.group_name = 'Lab Supervisor';
    END IF;

    -- the demo analyst batches the first four (the rush first), signs Batching and starts weighing
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    v_batch := create_batch(cfl, (SELECT id FROM test_version WHERE test_id = t_icp AND status = 'Effective'),
        (SELECT jsonb_agg(jsonb_build_object('requested_test_id', p.requested_test_id))
           FROM (SELECT requested_test_id FROM test_pool_view WHERE test_id = t_icp ORDER BY priority_rank, due_date, sample_code LIMIT 4) p));
    PERFORM complete_step((SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_key = 'batch'));
    FOR e IN SELECT be.* FROM batch_entry be WHERE be.batch_id = v_batch AND (be.entry_type = 'Sample' OR be.qc_class = 'Prep') ORDER BY be.position LIMIT 5 LOOP
        INSERT INTO entry_value (step_run_id, entry_id, value_num)
        VALUES ((SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_key = 'weigh'), e.id, 0.4980 + e.position * 0.0013);
    END LOOP;
    INSERT INTO entry_equipment (step_run_id, equipment_id)
    SELECT r.id, (SELECT id FROM equipment WHERE equipment_name = 'Analytical balance 1') FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_key = 'weigh';
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
EXCEPTION WHEN others THEN
    -- demo data only: if this database's demo records were changed so the example cannot be built, skip it whole
    -- (never stop the app from starting)
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
    RAISE NOTICE 'WD-2 demo data skipped: %', SQLERRM;
END $$;


-- Canned reasons for bench corrections, reopening, re-analysis and re-prep (QA can change the list: Admin > Canned reasons)
INSERT INTO reason_code (module, reason_text, sort_order)
SELECT 'Testing', r, n FROM (VALUES ('Typing error', 10), ('Value entered on the wrong row', 20), ('Instrument drift or failed check standard', 30),
        ('QC failure', 40), ('Preparation error (spill, incomplete digestion)', 50), ('Result outside the calibration range', 60), ('Analyst''s check before review', 70)) AS x(r, n)
 WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = 'Testing' AND lower(c.reason_text) = lower(x.r));

COMMIT;
