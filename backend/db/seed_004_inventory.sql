-- Sandbox demo data for Inventory (slice 3). Fictional suppliers; dates are relative to today so the
-- warnings (expired, expiring soon, low stock, negative stock, low retained sample) always show.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
-- Since migration 007 inventory changes are signed; demo data is signed as a data load script (recorded as such)
SELECT script_signature('Sandbox demo data');

-- Job roles (interim, until Roles and Permissions) and two more demo people
UPDATE app_user SET job_role = 'QA' WHERE username = 'qa.reviewer';
UPDATE app_user SET job_role = 'Intake' WHERE username = 'intake';
UPDATE app_user SET job_role = 'Account Manager' WHERE username = 'acctmgr';
UPDATE app_user SET job_role = 'General Manager' WHERE username = 'akiddle';
INSERT INTO app_user (username, full_name, job_role) VALUES
 ('labsup', 'Lab Supervisor (demo)', 'Lab Supervisor'), ('analyst', 'Analyst (demo)', 'Analyst')
ON CONFLICT (username) DO NOTHING;
INSERT INTO user_site_access (user_id, site_id)
SELECT u.id, s.id FROM app_user u, lab_site s
 WHERE (u.username = 'labsup' AND s.site_code IN ('CFL','TPS')) OR (u.username = 'analyst' AND s.site_code = 'CFL')
ON CONFLICT (user_id, site_id) DO NOTHING;

-- Chemical list
INSERT INTO chemical (chemical_name, cas_number, synonyms, hazard_notes, analyte_id) VALUES
 ('Nitric acid', '7697-37-2', '{HNO3}', 'Corrosive, oxidizer', NULL),
 ('Hydrochloric acid', '7647-01-0', '{HCl}', 'Corrosive', NULL),
 ('Hydrogen peroxide', '7722-84-1', '{H2O2}', 'Oxidizer', NULL),
 ('Methanol', '67-56-1', '{MeOH}', 'Flammable, toxic', NULL),
 ('Acetonitrile', '75-05-8', '{ACN,MeCN}', 'Flammable', NULL),
 ('Sodium hydroxide', '1310-73-2', '{NaOH}', 'Corrosive', NULL),
 ('Lead', '7439-92-1', '{Pb}', 'Toxic', (SELECT id FROM analyte WHERE analyte_name = 'Lead')),
 ('Cadmium', '7440-43-9', '{Cd}', 'Toxic, carcinogen', (SELECT id FROM analyte WHERE analyte_name = 'Cadmium')),
 ('Arsenic', '7440-38-2', '{As}', 'Toxic, carcinogen', (SELECT id FROM analyte WHERE analyte_name = 'Arsenic')),
 ('Mercury', '7439-97-6', '{Hg}', 'Toxic', (SELECT id FROM analyte WHERE analyte_name = 'Mercury')),
 ('Tryptic Soy Agar', NULL, '{TSA}', NULL, NULL),
 ('Escherichia coli ATCC 8739', NULL, '{"E. coli 8739"}', 'Biosafety level 1', NULL)
ON CONFLICT DO NOTHING;

-- Suppliers and manufacturers (fictional)
INSERT INTO supplier (supplier_name, supplier_type, website, email, phone) VALUES
 ('Northbridge Scientific Supply', 'Supplier', 'northbridge.example.com', 'orders@northbridge.example.com', '800-555-0110'),
 ('Apex Reference Standards', 'Supplier and Manufacturer', 'apexstandards.example.com', 'support@apexstandards.example.com', '800-555-0123'),
 ('Meridian Chemical Co.', 'Manufacturer', 'meridianchem.example.com', NULL, NULL),
 ('Culture Bank Biologicals', 'Supplier and Manufacturer', 'culturebank.example.com', 'service@culturebank.example.com', '800-555-0188')
ON CONFLICT DO NOTHING;
-- (since migration 011 purchases need an approved supplier: the demo suppliers are approved for all labs)
-- (since migration 065 the expiry from the risk class is worked out by Java, so a data load gives it: Class II, 24 months)
INSERT INTO vendor_qualification (supplier_id, risk_class_id, approval_status, approval_date, expiration_date, accreditations, justification)
SELECT s.id, (SELECT id FROM supplier_risk_class WHERE site_id IS NULL AND class_name = 'Class II'), 'Approved', current_date - 200,
       (current_date - 200 + interval '24 months')::date, 'ISO 9001 (demo)', 'Sandbox demo supplier'
  FROM supplier s WHERE NOT EXISTS (SELECT 1 FROM vendor_qualification q WHERE q.supplier_id = s.id);

-- Storage locations (each lab)
DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); tps uuid := (SELECT id FROM lab_site WHERE site_code = 'TPS');
        b uuid; r uuid; m uuid; ret uuid;
BEGIN
    INSERT INTO storage_location (site_id, location_code, location_name, location_type, supported_conditions)
    VALUES (cfl, 'CFL-MAIN', 'CFL main building', 'Building', '{}') RETURNING id INTO b;
    INSERT INTO storage_location (site_id, location_code, location_name, location_type, parent_location_id, supported_conditions)
    VALUES (cfl, 'CHEM', 'Chemistry lab', 'Room', b, '{}') RETURNING id INTO r;
    INSERT INTO storage_location (site_id, location_code, location_name, location_type, parent_location_id, supported_conditions) VALUES
     (cfl, 'CHEM-SH-A', 'Reagent shelf A', 'Shelf', r, '{"Ambient (15-25 °C)"}'),
     (cfl, 'CHEM-FR-01', 'Standards fridge 1', 'Refrigerator', r, '{"Refrigerated (2-8 °C)"}'),
     (cfl, 'CHEM-FLAM', 'Flammables cabinet', 'Cabinet', r, '{"Flammables cabinet","Ambient (15-25 °C)"}'),
     (cfl, 'CHEM-CORR', 'Acids and bases cabinet', 'Cabinet', r, '{"Corrosives cabinet","Ambient (15-25 °C)"}');
    INSERT INTO storage_location (site_id, location_code, location_name, location_type, parent_location_id, supported_conditions)
    VALUES (cfl, 'MICRO', 'Microbiology lab', 'Room', b, '{}') RETURNING id INTO m;
    INSERT INTO storage_location (site_id, location_code, location_name, location_type, parent_location_id, supported_conditions) VALUES
     (cfl, 'MICRO-FR-01', 'Media fridge', 'Refrigerator', m, '{"Refrigerated (2-8 °C)"}'),
     (cfl, 'MICRO-FZ-80', 'Culture freezer (-80)', 'Freezer', m, '{"Ultra-low (-80 °C)"}');
    INSERT INTO storage_location (site_id, location_code, location_name, location_type, parent_location_id, supported_conditions, holds_samples)
    VALUES (cfl, 'RET', 'Sample retain room', 'Room', b, '{}', true) RETURNING id INTO ret;
    INSERT INTO storage_location (site_id, location_code, location_name, location_type, parent_location_id, supported_conditions, holds_samples) VALUES
     (cfl, 'RET-SH-01', 'Retain shelf 1', 'Shelf', ret, '{"Ambient (15-25 °C)"}', true),
     (cfl, 'RET-SH-02', 'Retain shelf 2', 'Shelf', ret, '{"Ambient (15-25 °C)"}', true),
     (cfl, 'RET-FR-01', 'Retain fridge', 'Refrigerator', ret, '{"Refrigerated (2-8 °C)"}', true);

    INSERT INTO storage_location (site_id, location_code, location_name, location_type, supported_conditions)
    VALUES (tps, 'TPS-LAB', 'TPS laboratory', 'Room', '{}') RETURNING id INTO r;
    INSERT INTO storage_location (site_id, location_code, location_name, location_type, parent_location_id, supported_conditions, holds_samples) VALUES
     (tps, 'TPS-FR-01', 'Standards fridge', 'Refrigerator', r, '{"Refrigerated (2-8 °C)"}', false),
     (tps, 'TPS-FLAM', 'Flammables cabinet', 'Cabinet', r, '{"Flammables cabinet","Ambient (15-25 °C)"}', false),
     (tps, 'TPS-CORR', 'Acids cabinet', 'Cabinet', r, '{"Corrosives cabinet","Ambient (15-25 °C)"}', false),
     (tps, 'TPS-RET', 'Retain cabinet', 'Cabinet', r, '{"Ambient (15-25 °C)"}', true);
END $$;

-- Warning thresholds (never block work)
INSERT INTO threshold_rule (rule_name, subject, rule_type, value) VALUES
 ('Low stock: below 20% of the amount received', 'Lot Quantity', 'Percentage of Base', 20),
 ('Expiring within 30 days', 'Lot Expiry', 'Days Until/Since', 30),
 ('Low retained sample: below 25% of the amount received', 'Sample Retain', 'Percentage of Base', 25);

-- Lots, stock movements, a mixture, a reorder, an order and a transfer
DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); tps uuid := (SELECT id FROM lab_site WHERE site_code = 'TPS');
        nb uuid := (SELECT id FROM supplier WHERE supplier_name = 'Northbridge Scientific Supply');
        apex uuid := (SELECT id FROM supplier WHERE supplier_name = 'Apex Reference Standards');
        mer uuid := (SELECT id FROM supplier WHERE supplier_name = 'Meridian Chemical Co.');
        cb uuid := (SELECT id FROM supplier WHERE supplier_name = 'Culture Bank Biologicals');
        loc_corr uuid := (SELECT id FROM storage_location WHERE location_code = 'CHEM-CORR');
        loc_fr uuid := (SELECT id FROM storage_location WHERE location_code = 'CHEM-FR-01');
        loc_flam uuid := (SELECT id FROM storage_location WHERE location_code = 'CHEM-FLAM');
        loc_sh uuid := (SELECT id FROM storage_location WHERE location_code = 'CHEM-SH-A');
        loc_mfr uuid := (SELECT id FROM storage_location WHERE location_code = 'MICRO-FR-01');
        loc_mfz uuid := (SELECT id FROM storage_location WHERE location_code = 'MICRO-FZ-80');
        ch_hno3 uuid := (SELECT id FROM chemical WHERE chemical_name = 'Nitric acid');
        l_hno3 uuid; l_pb uuid; l_cd uuid; l_as uuid; l_meoh uuid; l_acn uuid; l_hcl uuid; v uuid;
BEGIN
    INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, supplier_id, manufacturer_id, catalog_number, manufacturer_lot, quantity_received, unit, container_count,
                               purity_pct, received_date, expiration_date, storage_condition, storage_location_id)
    VALUES (cfl, ch_hno3, '{Reagent}', nb, mer, 'NA-TM-2.5', 'MC2607114', 5, 'L', 2, 69.5, current_date - 60, current_date + 300, 'Corrosives cabinet', loc_corr)
    RETURNING id INTO l_hno3;
    INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, supplier_id, manufacturer_id, catalog_number, manufacturer_lot, quantity_received, unit,
                               concentration, concentration_unit, received_date, expiration_date, storage_condition, storage_location_id)
    VALUES (cfl, (SELECT id FROM chemical WHERE chemical_name = 'Lead'), '{"Reference Standard"}', apex, apex, 'ICP-PB-1000', 'APX-24-0871', 100, 'mL',
            1000, 'µg/mL', current_date - 90, current_date + 200, 'Refrigerated (2-8 °C)', loc_fr) RETURNING id INTO l_pb;
    INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, supplier_id, manufacturer_id, catalog_number, manufacturer_lot, quantity_received, unit,
                               concentration, concentration_unit, received_date, expiration_date, storage_condition, storage_location_id)
    VALUES (cfl, (SELECT id FROM chemical WHERE chemical_name = 'Cadmium'), '{"Reference Standard"}', apex, apex, 'ICP-CD-1000', 'APX-24-0644', 100, 'mL',
            1000, 'µg/mL', current_date - 300, current_date + 20, 'Refrigerated (2-8 °C)', loc_fr) RETURNING id INTO l_cd;
    INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, supplier_id, manufacturer_id, catalog_number, manufacturer_lot, quantity_received, unit,
                               concentration, concentration_unit, received_date, expiration_date, storage_condition, storage_location_id)
    VALUES (cfl, (SELECT id FROM chemical WHERE chemical_name = 'Arsenic'), '{"Reference Standard"}', apex, apex, 'ICP-AS-1000', 'APX-23-1190', 100, 'mL',
            1000, 'µg/mL', current_date - 400, current_date - 5, 'Refrigerated (2-8 °C)', loc_fr) RETURNING id INTO l_as;
    INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, supplier_id, manufacturer_id, catalog_number, manufacturer_lot, quantity_received, unit,
                               purity_pct, received_date, expiration_date, storage_condition, storage_location_id)
    VALUES (cfl, (SELECT id FROM chemical WHERE chemical_name = 'Methanol'), '{Solvent}', nb, mer, 'MEOH-HPLC-4L', 'MC2605502', 4, 'L', 99.9,
            current_date - 45, current_date + 500, 'Flammables cabinet', loc_flam) RETURNING id INTO l_meoh;
    INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, supplier_id, manufacturer_id, catalog_number, manufacturer_lot, quantity_received, unit,
                               purity_pct, received_date, expiration_date, storage_condition, storage_location_id)
    VALUES (cfl, (SELECT id FROM chemical WHERE chemical_name = 'Acetonitrile'), '{Solvent}', nb, mer, 'ACN-HPLC-4L', 'MC2606219', 4, 'L', 99.9,
            current_date - 30, current_date + 600, 'Flammables cabinet', loc_flam) RETURNING id INTO l_acn;
    INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, supplier_id, manufacturer_id, catalog_number, manufacturer_lot, quantity_received, unit,
                               received_date, expiration_date, storage_condition, storage_location_id)
    VALUES (cfl, (SELECT id FROM chemical WHERE chemical_name = 'Tryptic Soy Agar'), '{Media}', cb, cb, 'TSA-500', 'CB-TSA-2609', 500, 'g',
            current_date - 20, current_date + 160, 'Refrigerated (2-8 °C)', loc_mfr);
    INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, supplier_id, manufacturer_id, catalog_number, manufacturer_lot, quantity_received, unit,
                               received_date, expiration_date, storage_condition, storage_location_id)
    VALUES (cfl, (SELECT id FROM chemical WHERE chemical_name = 'Escherichia coli ATCC 8739'), '{"Microbiological Strain","Reference Standard"}', cb, cb,
            'ATCC-8739-KWIK', 'CB-EC-2511', 2, 'vial', current_date - 100, current_date + 265, 'Ultra-low (-80 °C)', loc_mfz);
    INSERT INTO inventory_lot (site_id, item_description, chemical_types, supplier_id, catalog_number, quantity_received, unit, received_date, storage_condition, storage_location_id)
    VALUES (cfl, 'Pipette tips, 1000 µL, filtered', '{Consumable}', nb, 'TIP-1000F', 10, 'box', current_date - 15, 'Ambient (15-25 °C)', loc_sh);

    -- usage: methanol nearly used up (low stock), acetonitrile over-used (negative: reconcile)
    INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference, txn_at) VALUES
     (l_hno3, 'Usage', 1.2, 'ICP-MS digestions, week 38', now() - interval '20 days'),
     (l_pb, 'Usage', 12, 'Calibration standards', now() - interval '10 days'),
     (l_meoh, 'Usage', 3.6, 'HPLC mobile phase', now() - interval '5 days'),
     (l_acn, 'Usage', 4.3, 'HPLC mobile phase (bottle reading)', now() - interval '3 days');

    -- in-house mixture: ICP calibration mix made from the lead and cadmium standards in nitric acid
    v := make_mixture(cfl, NULL, 'ICP-MS calibration mix, Pb and Cd 10 µg/mL in 2% HNO3', 100, 'mL', 10, 'µg/mL', NULL,
                      'Refrigerated (2-8 °C)', loc_fr,
                      jsonb_build_array(jsonb_build_object('lot_id', l_pb, 'quantity', 1), jsonb_build_object('lot_id', l_cd, 'quantity', 1),
                                        jsonb_build_object('lot_id', l_hno3, 'quantity', 0.002)),
                      'Prepared per work instruction WI-ICP-007 (placeholder)');

    -- reorder of methanol (Requested), and hydrochloric acid ordered (approved by the Lab Supervisor)
    PERFORM reorder_lot(l_meoh, 4, 'Methanol running low');
    INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, supplier_id, manufacturer_id, catalog_number, receipt_status, requested_quantity, unit, storage_condition)
    VALUES (cfl, (SELECT id FROM chemical WHERE chemical_name = 'Hydrochloric acid'), '{Reagent}', nb, mer, 'HCL-TM-2.5', 'Requested', 2.5, 'L', 'Corrosives cabinet')
    RETURNING id INTO l_hcl;
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
    PERFORM script_signature('Sandbox demo data');
    -- (since migration 011: approved in the Purchasing queue and ordered on a purchase order)
    PERFORM approve_purchase_lines(ARRAY[(SELECT purchase_line_id FROM inventory_lot WHERE id = l_hcl)]);
    PERFORM create_purchase_order(ARRAY[(SELECT purchase_line_id FROM inventory_lot WHERE id = l_hcl)], 'FIN-2026-0007', 'NB-SO-55120', 'PO placed with Northbridge');
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
    PERFORM script_signature('Sandbox demo data');

    -- TPS stock, and lead standard on its way from CFL to TPS
    INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, supplier_id, manufacturer_id, catalog_number, manufacturer_lot, quantity_received, unit,
                               purity_pct, received_date, expiration_date, storage_condition, storage_location_id)
    VALUES (tps, ch_hno3, '{Reagent}', nb, mer, 'NA-TM-2.5', 'MC2608002', 2.5, 'L', 69.5, current_date - 10, current_date + 350, 'Corrosives cabinet',
            (SELECT id FROM storage_location WHERE location_code = 'TPS-CORR'));
    PERFORM transfer_lot(l_pb, tps, 20, 'TPS needs lead standard for a method transfer');
END $$;

-- Retained sample and storage for the logged demo samples
UPDATE sample SET storage_location_id = (SELECT id FROM storage_location WHERE location_code = 'RET-SH-01'), storage_condition = 'Ambient (15-25 °C)',
       retained_quantity = 300, retained_unit = 'g' WHERE client_sample_id = 'VAN-0912' AND logged_at IS NOT NULL;
UPDATE sample SET storage_location_id = (SELECT id FROM storage_location WHERE location_code = 'RET-SH-01'), storage_condition = 'Ambient (15-25 °C)',
       retained_quantity = 80, retained_unit = 'g' WHERE client_sample_id = 'CHO-0913' AND logged_at IS NOT NULL;

COMMIT;
