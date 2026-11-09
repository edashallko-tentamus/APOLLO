-- Sandbox demo data for slice 3.1 (inventory items without the Chemical list), modelled on Alex's mock-ups:
-- Sodium Standard 1000 ppm (low stock, expiring), DI water diluent, and Sodium Working Solution 10 ppm prepared
-- from them (target 10 ppm ± 5%). Also links the demo E. coli strain to its analyte. Fictional.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

INSERT INTO analyte (analyte_name, report_name, analyte_class, cas_number, synonyms)
SELECT 'Sodium', 'Sodium (Na)', 'Chemical', '7440-23-5', '{Na}' WHERE NOT EXISTS (SELECT 1 FROM analyte WHERE lower(analyte_name) = 'sodium');

-- the demo E. coli strain (logged from the old Chemical list) names its analyte
INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit)
SELECT l.id, a.id, NULL, NULL FROM inventory_lot l, analyte a
 WHERE l.item_name = 'Escherichia coli ATCC 8739' AND a.analyte_name = 'E. coli'
   AND NOT EXISTS (SELECT 1 FROM lot_analyte x WHERE x.lot_id = l.id)
ON CONFLICT DO NOTHING;

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL');
        apex uuid := (SELECT id FROM supplier WHERE supplier_name = 'Apex Reference Standards');
        nb uuid := (SELECT id FROM supplier WHERE supplier_name = 'Northbridge Scientific Supply');
        fr uuid := (SELECT id FROM storage_location WHERE location_code = 'CHEM-FR-01' AND site_id = (SELECT id FROM lab_site WHERE site_code = 'CFL'));
        sh uuid := (SELECT id FROM storage_location WHERE location_code = 'CHEM-SH-A' AND site_id = (SELECT id FROM lab_site WHERE site_code = 'CFL'));
        na uuid := (SELECT id FROM analyte WHERE analyte_name = 'Sodium');
        l_na uuid; l_w uuid;
BEGIN
    IF cfl IS NULL OR na IS NULL OR EXISTS (SELECT 1 FROM inventory_lot WHERE item_name = 'Sodium Standard 1000 ppm') THEN RETURN; END IF;
    INSERT INTO inventory_lot (site_id, item_name, cas_number, chemical_types, physical_form, supplier_id, manufacturer_id, catalog_number, manufacturer_lot,
                               quantity_received, unit, purity_pct, received_date, expiration_date, retest_date, storage_condition, storage_location_id)
    VALUES (cfl, 'Sodium Standard 1000 ppm', '7440-23-5', '{Reference Standard}', 'Liquid', apex, apex, 'ICP-NA-1000', 'LOT-90112',
            1, 'L', 99.9, current_date - 70, current_date + 25, current_date + 20, 'Refrigerated (2-8 °C)', fr) RETURNING id INTO l_na;
    INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit) VALUES (l_na, na, 1000, 'ppm');
    INSERT INTO inventory_lot (site_id, item_name, chemical_types, physical_form, supplier_id, catalog_number, manufacturer_lot,
                               quantity_received, unit, received_date, expiration_date, storage_condition, storage_location_id)
    VALUES (cfl, 'DI Water Diluent', '{Solvent}', 'Liquid', nb, 'DIW-ASTM1-4L', 'DIW-2610', 4, 'L', current_date - 5, current_date + 180,
            'Ambient (15-25 °C)', sh) RETURNING id INTO l_w;
    INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference, txn_at)
    VALUES (l_na, 'Usage', 0.815, 'ICP-OES calibration standards', now() - interval '6 days');
    PERFORM prepare_mixture(cfl, 'Sodium Working Solution 10 ppm', '{Reference Standard}', 'Liquid', 500, 'mL', NULL, 'Refrigerated (2-8 °C)', fr,
        jsonb_build_array(jsonb_build_object('lot_id', l_na, 'quantity', 0.005), jsonb_build_object('lot_id', l_w, 'quantity', 0.495)),
        jsonb_build_array(jsonb_build_object('analyte_id', na, 'unit', 'ppm', 'target', 10, 'tolerance_pct', 5)),
        'Prepared per work instruction WI-ICP-012 (placeholder)');
END $$;

COMMIT;
