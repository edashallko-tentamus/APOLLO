-- Sandbox demo data for migration 019 (WD-4, micro at the bench): Acme Irvine's accepted quote for USP <62> on two of
-- the WD-2 supplements (they wait in the Microbiology backlog), ready-to-use media plates and broths, a S. aureus
-- reference strain and a top-loading balance (the USP <62> weighing step uses one). Skipped whole if the demo records
-- were changed, so it never stops the app from starting.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); acme uuid := (SELECT id FROM client WHERE legal_name = 'Acme Nutrition Irvine Site');
        t62 uuid; v_pv uuid; v_line uuid; micro uuid; v_lot uuid; x record;
BEGIN
    SELECT id INTO t62 FROM test WHERE site_id = cfl AND test_name = 'USP <62> Specified Microorganisms';
    SELECT id INTO micro FROM department WHERE site_id = cfl AND department_code = 'MICRO';
    IF t62 IS NULL OR acme IS NULL OR EXISTS (SELECT 1 FROM project WHERE project_name = 'Supplement micro release (USP <62>)') THEN RETURN; END IF;

    -- the quote, accepted
    INSERT INTO project (client_id, project_name, purpose) VALUES (acme, 'Supplement micro release (USP <62>)', 'Specified microorganisms on finished supplements');
    v_pv := new_project_version((SELECT id FROM project WHERE project_name = 'Supplement micro release (USP <62>)'));
    INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (v_pv, t62, 12);
    UPDATE quoted_test_configuration SET final_price = list_price WHERE project_version_id = v_pv;
    UPDATE project_version SET status = 'Quoted', valid_until = current_date + 60 WHERE id = v_pv;
    UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam.nguyen@example-acme.com') WHERE id = v_pv;
    SELECT id INTO v_line FROM quoted_test_configuration WHERE project_version_id = v_pv;

    -- ordered on the multivitamin and the turmeric capsules (already logged, so they go straight to the backlog)
    FOR x IN SELECT s.id FROM sample s WHERE s.client_sample_id IN ('MV-2201', 'TUR-2202') AND s.status = 'Logged' ORDER BY s.client_sample_id LOOP
        PERFORM order_test(x.id, v_line);
    END LOOP;

    -- ready-to-use media (counted per plate or tube, so each one used comes off the stock)
    INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date, notes)
    SELECT cfl, n, '{Media}', l, q, 'each', current_date + 45, 'Ready-to-use' FROM (VALUES
        ('XLD agar plates', 'HAR-XLD-2609', 100), ('MacConkey agar plates', 'HAR-MAC-2609', 100), ('Mannitol salt agar plates', 'HAR-MSA-2609', 100),
        ('Cetrimide agar plates', 'HAR-CET-2609', 100), ('Sabouraud dextrose agar plates', 'HAR-SDA-2609', 100),
        ('Tryptic soy broth, 90 mL bottles', 'HAR-TSB-2609', 50), ('Rappaport Vassiliadis broth tubes', 'HAR-RV-2609', 50), ('MacConkey broth, 100 mL', 'HAR-MCB-2609', 50)) AS v(n, l, q);

    -- a second reference strain for the positive control (E. coli ATCC 8739 is already in the demo inventory)
    INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date, notes)
    VALUES (cfl, 'Staphylococcus aureus ATCC 6538', '{"Microbiological Strain"}', 'MB-SA-2609', 20, 'each', current_date + 180, 'Working culture vials')
    RETURNING id INTO v_lot;
    INSERT INTO lot_analyte (lot_id, analyte_id) SELECT v_lot, id FROM analyte WHERE analyte_name = 'Staphylococcus aureus';

    -- the balance the USP <62> weighing step uses
    IF EXISTS (SELECT 1 FROM equipment_type WHERE site_id = cfl AND type_name = 'Top-loading balance') AND NOT EXISTS (SELECT 1 FROM equipment WHERE equipment_name = 'Top-loading balance 1') THEN
        INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, serial_number, calibration_required)
        VALUES (cfl, 'Top-loading balance 1', (SELECT id FROM equipment_type WHERE site_id = cfl AND type_name = 'Top-loading balance'), micro, 'Ohaus', 'NVT-2201', false);
        INSERT INTO equipment_owner (equipment_id, group_id)
        SELECT e.id, g.id FROM equipment e, lab_group g WHERE e.equipment_name = 'Top-loading balance 1' AND g.site_id = cfl AND g.group_name = 'Lab Supervisor';
    END IF;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'WD-4 demo data skipped: %', SQLERRM;
END $$;

-- orders whose tests were batched before migration 018 move to In Testing (the order status now follows its tests)
DO $$ BEGIN PERFORM refresh_batch_orders(id) FROM test_batch; EXCEPTION WHEN others THEN RAISE NOTICE 'Order status refresh skipped: %', SQLERRM; END $$;

COMMIT;
