-- Verification for migration 007 (runs after the 001 to 006 tests): electronic signatures in the Inventory module,
-- the append-only signature and login logs, canned reasons, molar mass, molar and "expressed as" mixture calculations,
-- and mixture components entered in any convertible unit
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN SET CONSTRAINTS ALL IMMEDIATE; EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
  SET CONSTRAINTS ALL DEFERRED; -- back to checking at the end of the save for the rest of the file
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.user_only(u text) RETURNS text LANGUAGE sql AS $$   -- switch user WITHOUT signing
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false)
$$;
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.item(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM inventory_lot WHERE item_name = n ORDER BY created_at DESC LIMIT 1 $$;

-- Signatures are required in the Inventory module (except routine usage)
SELECT pg_temp.expect_error('An inventory item cannot be created without a signature',
  $$INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit) VALUES (pg_temp.cfl(), 'Unsigned acid', '{Reagent}', 'U1', 1, 'L')$$);
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): a storage location is changed only signed (InventoryListsService.saveLocations, bulk upload)
INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference) VALUES (pg_temp.item('DI Water Diluent'), 'Usage', 0.01, 'unsigned routine usage');
SELECT pg_temp.expect_true('Routine usage needs no signature (still attributed and audited)',
  EXISTS (SELECT 1 FROM audit_log a WHERE a.table_name = 'inventory_transaction' AND a.new_row->>'reference' = 'unsigned routine usage' AND a.signature_id IS NULL));
SELECT pg_temp.expect_error('An adjustment is not routine usage: it needs a signature',
  $$INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reason) VALUES (pg_temp.item('DI Water Diluent'), 'Adjustment', -0.01, 'count')$$);
DO $$ DECLARE s uuid; BEGIN
  s := sign_action('Created by', 'New inventory item Signed acid', 'Inventory', NULL);
  INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit) VALUES (pg_temp.cfl(), 'Signed acid', '{Reagent}', 'S1', 1, 'L');
END $$;
SELECT pg_temp.expect_true('A signed save works, and its audit entries point to the signature (meaning, printed name, method)',
  EXISTS (SELECT 1 FROM audit_log a JOIN signature_event s ON s.id = a.signature_id
           WHERE a.table_name = 'inventory_lot' AND a.record_id = pg_temp.item('Signed acid') AND s.meaning = 'Created by'
             AND s.full_name = 'Alex Kiddle' AND s.method = 'User ID and password'));
-- (the test runner runs a whole file as one transaction; the app runs every save in its own, so it starts unsigned)
SELECT pg_temp.expect_true('The signature records what was signed and in which module',
  EXISTS (SELECT 1 FROM signature_event WHERE action = 'New inventory item Signed acid' AND module = 'Inventory' AND meaning = 'Created by'));
SELECT script_signature('Rule test', false);
SELECT pg_temp.user_only('inv.tech');
SELECT pg_temp.expect_error('A signature by one person cannot be used by another',
  $$UPDATE inventory_lot SET notes = 'x' WHERE id = pg_temp.item('Signed acid')$$);
SELECT pg_temp.user_only('akiddle');
SELECT pg_temp.expect_error('Signatures cannot be changed', $$UPDATE signature_event SET meaning = 'Approved by'$$);
SELECT pg_temp.expect_error('Signatures cannot be deleted', $$DELETE FROM signature_event$$);
INSERT INTO signature_event (user_id, full_name, meaning, action, method) SELECT id, 'Someone else', 'Approved by', 'test', 'Data load script' FROM app_user WHERE username = 'inv.tech';
SELECT pg_temp.expect_true('Nobody can sign in someone else''s name (stored as the person signing, with their real name)',
  (SELECT user_id = (SELECT id FROM app_user WHERE username = 'akiddle') AND full_name = 'Alex Kiddle' FROM signature_event WHERE action = 'test'));
SELECT set_config('lims.reason', 'Moved', false);
SELECT set_config('lims.signature_id', '', false);
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): where a sample is stored is changed only signed (InventoryListsService.saveSampleStorage)
SELECT set_config('lims.reason', '', false);
INSERT INTO auth_event (username, event) VALUES ('akiddle', 'Login failed');
SELECT pg_temp.expect_error('The login log cannot be changed', $$UPDATE auth_event SET event = 'Logged in'$$);

-- Canned reasons
SELECT pg_temp.user_only('inv.tech');
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): an analyst cannot add a canned reason (AdminService REASONS keeper)
SELECT pg_temp.user_only('qa.units');
INSERT INTO reason_code (module, reason_text) VALUES ('Inventory', 'Spill or breakage');
SELECT pg_temp.expect_true('QA can add a canned reason', EXISTS (SELECT 1 FROM reason_code WHERE reason_text = 'Spill or breakage'));
SELECT pg_temp.expect_error('The same reason twice in one module is refused', $$INSERT INTO reason_code (module, reason_text) VALUES ('Inventory', 'spill or breakage')$$);
-- Moved to the Java backend in migration 060 (JUnit: ReasonCodeRulesTest): Reasons belong to a known module

-- Molar mass (QA, Lab Supervisors and administrators; signed; with a source)
SELECT pg_temp.user_only('inv.tech'); SELECT script_signature('Rule test', false);
SELECT set_config('lims.reason', 'Adding molar mass', false);
SELECT pg_temp.expect_error('An analyst cannot set a molar mass', $$UPDATE analyte SET molar_mass = 207.2, molar_mass_source = 'IUPAC' WHERE analyte_name = 'Lead'$$);
SELECT pg_temp.user_only('inv.sup');
SELECT pg_temp.expect_error('A molar mass change needs a signature', $$UPDATE analyte SET molar_mass = 207.2, molar_mass_source = 'IUPAC' WHERE analyte_name = 'Lead'$$);
SELECT script_signature('Rule test', false);
-- Moved to the Java backend in migration 060 (JUnit: MasterDataRulesTest): A molar mass needs its source
UPDATE analyte SET molar_mass = 207.2, molar_mass_source = 'IUPAC standard atomic weights 2021' WHERE analyte_name = 'Lead';
SELECT pg_temp.expect_true('A Lab Supervisor sets a molar mass with its source and a signature', (SELECT molar_mass = 207.2 FROM analyte WHERE analyte_name = 'Lead'));
UPDATE analyte SET report_name = report_name WHERE analyte_name = 'Lead';
SELECT pg_temp.user_only('akiddle'); SELECT script_signature('Rule test', false);
INSERT INTO analyte (analyte_name, report_name, analyte_class, cas_number, molar_mass, molar_mass_source) VALUES ('Sodium', 'Sodium', 'Chemical', '7440-23-5', 22.99, 'IUPAC standard atomic weights 2021');
SELECT set_config('lims.reason', '', false);

-- Mixtures: components in any convertible unit; molar and "expressed as" concentrations
SELECT pg_temp.expect_true('Units that can replace L include mL, µL and gal but not g',
  (SELECT bool_and(x IN (SELECT convertible_units('L', 'Liquid'))) FROM unnest(ARRAY['mL','µL','gal']) x) AND 'g' NOT IN (SELECT convertible_units('L', 'Liquid')));
DO $$ DECLARE v uuid; BEGIN
  INSERT INTO inventory_lot (site_id, item_name, chemical_types, physical_form, manufacturer_lot, quantity_received, unit, expiration_date)
  VALUES (pg_temp.cfl(), 'Lead nitrate 0.001 M', '{Reference Standard}', 'Liquid', 'PBM-1', 100, 'mL', current_date + 100) RETURNING id INTO v;
  INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit) SELECT v, id, 0.001, 'M' FROM analyte WHERE analyte_name = 'Lead';
  INSERT INTO inventory_lot (site_id, item_name, chemical_types, physical_form, manufacturer_lot, quantity_received, unit, expiration_date)
  VALUES (pg_temp.cfl(), 'Sodium chloride solution 1000 mg/L', '{Reference Standard}', 'Liquid', 'NACL-1', 100, 'mL', current_date + 100) RETURNING id INTO v;
  INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit, expressed_as, formula_weight, analyte_per_unit)
  SELECT v, id, 1000, 'mg/L', 'Sodium chloride (NaCl)', 58.44, 1 FROM analyte WHERE analyte_name = 'Sodium';
  INSERT INTO inventory_lot (site_id, item_name, chemical_types, physical_form, manufacturer_lot, quantity_received, unit, concentration, concentration_unit)
  VALUES (pg_temp.cfl(), 'Lead standard 0.1 N', '{Reference Standard}', 'Liquid', 'PBN-1', 100, 'mL', NULL, NULL) RETURNING id INTO v;
  INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit) SELECT v, id, 0.1, 'N' FROM analyte WHERE analyte_name = 'Lead';
END $$;
SELECT pg_temp.expect_true('Molar: 10 mL of 0.001 M lead in 100 mL = 0.0001 M x 207.2 g/mol = 20.72 mg/L',
  (SELECT abs(concentration - 20.72) < 0.000001 AND concentration_unit = 'mg/L' FROM mixture_concentrations(
     jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('Lead nitrate 0.001 M'), 'quantity', 10)), 100, 'mL', 'Liquid', '{}')));
SELECT pg_temp.expect_true('Expressed as NaCl: 10 mL of 1000 mg/L NaCl in 100 mL = 100 x 22.99 / 58.44 = 39.34 mg/L sodium',
  (SELECT abs(concentration - 39.3395) < 0.0001 FROM mixture_concentrations(
     jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('Sodium chloride solution 1000 mg/L'), 'quantity', 10)), 100, 'mL', 'Liquid', '{}')));
SELECT pg_temp.expect_true('Normality is not converted (it depends on the reaction): not calculated, with the reason',
  (SELECT concentration IS NULL AND calc_note LIKE '%normality%' FROM mixture_concentrations(
     jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('Lead standard 0.1 N'), 'quantity', 10)), 100, 'mL', 'Liquid', '{}')));
SELECT pg_temp.expect_true('A component entered in mL from a lot kept in L: 495 mL counts as 0.495 L',
  mixture_default_quantity(jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('DI Water Diluent'), 'quantity', 495, 'unit', 'mL')), 'mL') = 495);
SELECT pg_temp.expect_error('A unit that does not convert to the lot''s unit is refused (g for a lot kept in L)',
  $$SELECT mixture_default_quantity(jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('DI Water Diluent'), 'quantity', 5, 'unit', 'g')), 'mL')$$);
SELECT set_config('lims.signature_id', '', false);
DO $$ BEGIN
  PERFORM sign_action('Prepared by', 'Mixture Lead working 2 mg/L', 'Inventory', NULL);
  PERFORM prepare_mixture(pg_temp.cfl(), 'Lead working solution 2.072 mg/L', '{Reference Standard}', 'Liquid', 100, 'mL', NULL, NULL, NULL,
    jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('Lead nitrate 0.001 M'), 'quantity', 1, 'unit', 'mL'),
                      jsonb_build_object('lot_id', pg_temp.item('DI Water Diluent'), 'quantity', 99, 'unit', 'mL')), '[]');
END $$;
SELECT pg_temp.expect_true('Prepared mixture keeps what was entered (99 mL) and draws stock in the lot''s unit (0.099 L)',
  (SELECT quantity_used = 0.099 AND entered_quantity = 99 AND entered_unit = 'mL' FROM lot_component
    WHERE lot_id = pg_temp.item('Lead working solution 2.072 mg/L') AND component_lot_id = pg_temp.item('DI Water Diluent')));
SELECT pg_temp.expect_true('... and its molar standard gives 2.072 mg/L lead',
  (SELECT abs(concentration - 2.072) < 0.000001 FROM lot_analyte la JOIN analyte a ON a.id = la.analyte_id
    WHERE la.lot_id = pg_temp.item('Lead working solution 2.072 mg/L') AND a.analyte_name = 'Lead'));
SELECT pg_temp.expect_true('Canned reason audit entries are readable', audit_record_ref('reason_code', gen_random_uuid(), '{"module":"Inventory","reason_text":"Spill"}')->>'label' = 'Canned reason (Inventory): Spill');

SELECT rpad(left(test, 74), 76) || outcome AS result FROM results;
SELECT 1 AS done;
