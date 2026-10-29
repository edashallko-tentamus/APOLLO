-- Verification for migration 006 (runs after the 001 to 005 tests): Units and Unit conversions, items without the
-- Chemical list, analytes per item, Solid / Liquid, mixture quantity and concentration, warning results per lot
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
-- Since migration 007 inventory changes are signed: each user in these tests signs as a data load script
SELECT script_signature('Rule test', false);
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
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END
$$;
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.item(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM inventory_lot WHERE item_name = n ORDER BY created_at DESC LIMIT 1 $$;
INSERT INTO app_user (username, full_name, job_role) VALUES ('qa.units', 'QA Units', 'QA');
-- since migration 008 permissions come from groups held at a lab: put QA Units in CFL's QA group
INSERT INTO user_site_access (user_id, site_id) SELECT u.id, pg_temp.cfl() FROM app_user u WHERE u.username = 'qa.units';

-- Units and unit conversions
SELECT pg_temp.expect_true('Units list is delivered with the migration (mass, volume, count, concentration)',
  (SELECT count(*) FROM unit_of_measure WHERE unit_code IN ('g','mL','vial','mg/L','ppm','% w/w','M','CFU/mL')) = 8);
SELECT pg_temp.expect_true('L to mL = 1000', unit_factor('L', 'mL') = 1000);
SELECT pg_temp.expect_true('µg/mL to mg/L = 1 (two steps through the table)', unit_factor('µg/mL', 'mg/L') = 1);
SELECT pg_temp.expect_true('ppm to µg/mL for a liquid = 1', unit_factor('ppm', 'µg/mL', 'Liquid') = 1);
SELECT pg_temp.expect_true('ppm to mg/L for a solid cannot convert', unit_factor('ppm', 'mg/L', 'Solid') IS NULL);
SELECT pg_temp.expect_true('ppm to mg/kg for a solid = 1', unit_factor('ppm', 'mg/kg', 'Solid') = 1);
SELECT pg_temp.expect_true('Grams to millilitres cannot convert', unit_factor('g', 'mL') IS NULL);
SELECT pg_temp.expect_true('% w/v to µg/mL = 10000', round(unit_factor('% w/v', 'µg/mL'), 6) = 10000);
SELECT pg_temp.as_user('inv.tech');
SELECT pg_temp.expect_error('An analyst cannot add a unit', $$INSERT INTO unit_of_measure (unit_code, unit_name, dimension) VALUES ('dram', 'dram', 'Mass')$$);
SELECT pg_temp.as_user('qa.units');
INSERT INTO unit_of_measure (unit_code, unit_name, dimension) VALUES ('dram', 'dram (mass)', 'Mass');
SELECT pg_temp.expect_true('QA can add a unit', EXISTS (SELECT 1 FROM unit_of_measure WHERE unit_code = 'dram'));
SELECT pg_temp.expect_error('Duplicate unit code (any capitals) refused', $$INSERT INTO unit_of_measure (unit_code, unit_name, dimension) VALUES ('ML', 'x', 'Volume')$$);
-- Moved to the Java backend in migration 060 (JUnit: MasterDataRulesTest): A mass unit cannot be converted to a volume unit
-- Moved to the Java backend in migration 060 (JUnit: MasterDataRulesTest): A ppm conversion must say liquid or solid
INSERT INTO unit_conversion (from_unit_id, to_unit_id, factor) SELECT f.id, t.id, 1.7718451953125 FROM unit_of_measure f, unit_of_measure t WHERE f.unit_code = 'dram' AND t.unit_code = 'g';
SELECT pg_temp.expect_true('A new conversion is used straight away (dram to mg)', round(unit_factor('dram', 'mg'), 4) = 1771.8452);
SELECT pg_temp.expect_error('Changing a unit needs a reason', $$UPDATE unit_of_measure SET unit_name = 'drachm' WHERE unit_code = 'dram'$$);
SELECT set_config('lims.reason', 'Testing unit rename', false);
-- Moved to the Java backend in migration 060 (JUnit: MasterDataRulesTest): A unit used on inventory cannot be renamed
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.as_user('akiddle');

-- Items without the Chemical list
SELECT pg_temp.expect_error('A unit not on the Units list is refused',
  $$INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit) VALUES (pg_temp.cfl(), 'Test acid', '{Reagent}', 'T1', 1, 'furlong')$$);
SELECT pg_temp.expect_error('A concentration unit cannot be used as a quantity unit',
  $$INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit) VALUES (pg_temp.cfl(), 'Test acid', '{Reagent}', 'T1', 1, 'mg/L')$$);
SELECT pg_temp.expect_error('CAS number is validated', $$INSERT INTO inventory_lot (site_id, item_name, cas_number, chemical_types, manufacturer_lot, quantity_received, unit)
  VALUES (pg_temp.cfl(), 'Test acid', '7647-01-1', '{Reagent}', 'T1', 1, 'L')$$);
INSERT INTO inventory_lot (site_id, item_name, cas_number, chemical_types, manufacturer_lot, quantity_received, unit, concentration, concentration_unit)
  VALUES (pg_temp.cfl(), 'Hydrochloric acid 1N', '7647-01-0', '{Reagent}', 'HCL-1', 1, 'l', 1.02, 'n');
SELECT pg_temp.expect_true('Item saved with its own name and CAS; units stored in the list''s spelling; Liquid from the unit',
  (SELECT unit = 'L' AND concentration_unit = 'N' AND physical_form = 'Liquid' AND cas_number = '7647-01-0' FROM inventory_lot WHERE id = pg_temp.item('Hydrochloric acid 1N')));
SELECT pg_temp.expect_error('A Reference Standard must name an analyte',
  $$INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit) VALUES (pg_temp.cfl(), 'Mystery standard', '{Reference Standard}', 'MS1', 100, 'mL')$$);
DO $$ DECLARE v uuid; BEGIN
  INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date, received_date)
  VALUES (pg_temp.cfl(), 'Lead Standard 1000 ppm', '{Reference Standard}', 'PB-1000', 100, 'mL', current_date + 60, current_date - 30) RETURNING id INTO v;
  INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit) SELECT v, id, 1000, 'ppm' FROM analyte WHERE analyte_name = 'Lead';
END $$;
SELECT pg_temp.expect_true('Reference Standard saved with its analyte and concentration',
  (SELECT analytes_text = 'Lead 1000 ppm' AND conc_display = '1000 ppm' AND cas_display = '7439-92-1' FROM inventory_lot_view WHERE id = pg_temp.item('Lead Standard 1000 ppm')));
SELECT pg_temp.expect_error('Consumables have no analytes',
  $$INSERT INTO lot_analyte (lot_id, analyte_id) SELECT l.id, a.id FROM inventory_lot l, analyte a WHERE l.chemical_types = '{Consumable}' AND a.analyte_name = 'Lead' LIMIT 1$$);
SELECT pg_temp.expect_error('A concentration needs a unit',
  $$INSERT INTO lot_analyte (lot_id, analyte_id, concentration) SELECT pg_temp.item('Hydrochloric acid 1N'), id, 5 FROM analyte WHERE analyte_name = 'Arsenic'$$);
INSERT INTO chemical (chemical_name, cas_number, analyte_id) SELECT 'Mercury (legacy)', '7439-97-6', id FROM analyte WHERE analyte_name = 'Mercury';
INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, manufacturer_lot, quantity_received, unit, concentration, concentration_unit)
  SELECT pg_temp.cfl(), id, '{Reference Standard}', 'HG-1', 100, 'mL', 1000, 'µg/mL' FROM chemical WHERE chemical_name = 'Mercury (legacy)';
SELECT pg_temp.expect_true('An old-style lot (Chemical list) gets the chemical''s name and CAS and is linked to its analyte; all lots have names',
  (SELECT bool_and(l.item_name IS NOT NULL) FROM inventory_lot l)
  AND (SELECT item_name = 'Mercury (legacy)' AND cas_display = '7439-97-6' AND analytes_text = 'Mercury 1000 µg/mL' FROM inventory_lot_view WHERE manufacturer_lot = 'HG-1'));

-- In-house mixture: quantity made defaults to the liquid total; concentration calculated per analyte
INSERT INTO inventory_lot (site_id, item_name, chemical_types, physical_form, manufacturer_lot, quantity_received, unit, expiration_date)
  VALUES (pg_temp.cfl(), 'DI Water Diluent', '{Solvent}', 'Liquid', 'DIW-1', 4, 'L', current_date + 365);
SELECT pg_temp.expect_true('Default quantity made = 5 mL + 495 mL = 500 mL',
  mixture_default_quantity(jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('Lead Standard 1000 ppm'), 'quantity', 5),
                                             jsonb_build_object('lot_id', pg_temp.item('DI Water Diluent'), 'quantity', 0.495)), 'mL') = 500);
SELECT prepare_mixture(pg_temp.cfl(), 'Lead Working Solution 10 ppm', '{Reference Standard}', 'Liquid', 500, 'mL', NULL, NULL, NULL,
  jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('Lead Standard 1000 ppm'), 'quantity', 5),
                    jsonb_build_object('lot_id', pg_temp.item('DI Water Diluent'), 'quantity', 0.495)),
  jsonb_build_array(jsonb_build_object('analyte_id', (SELECT id FROM analyte WHERE analyte_name = 'Lead'), 'unit', 'ppm', 'target', 10, 'tolerance_pct', 5)));
SELECT pg_temp.expect_true('Prepared concentration calculated: 5 mL of 1000 ppm in 500 mL = 10 ppm',
  (SELECT la.concentration = 10 AND la.concentration_unit = 'ppm' AND la.calculated AND la.calc_note LIKE '%density 1 g/mL%'
     FROM lot_analyte la WHERE la.lot_id = pg_temp.item('Lead Working Solution 10 ppm')));
SELECT pg_temp.expect_true('Mixture is an In-house mixture and a Reference Standard; expiry defaults to the earliest component',
  (SELECT chemical_types @> '{In-house mixture,Reference Standard}' AND expiration_date = current_date + 60 FROM inventory_lot WHERE id = pg_temp.item('Lead Working Solution 10 ppm')));
SELECT pg_temp.expect_true('Target 10 ppm ± 5% conforms',
  EXISTS (SELECT 1 FROM lot_rule_results(pg_temp.item('Lead Working Solution 10 ppm')) WHERE rule_name LIKE 'Prepared concentration%' AND result = 'Conforms'));
SELECT pg_temp.expect_true('Components were drawn from stock (5 mL and 0.495 L)',
  lot_on_hand(pg_temp.item('Lead Standard 1000 ppm')) = 95 AND lot_on_hand(pg_temp.item('DI Water Diluent')) = 3.505);
SELECT pg_temp.expect_true('The calculation scales: 6 mL of 1000 ppm in 500 mL = 12 ppm',
  EXISTS (SELECT 1 FROM mixture_concentrations(jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('Lead Standard 1000 ppm'), 'quantity', 6)), 500, 'mL', 'Liquid', '{}') m
           WHERE abs(m.concentration - 12) < 0.000001 AND m.concentration_unit = 'ppm'));
DO $$ BEGIN
  INSERT INTO inventory_lot (site_id, item_name, chemical_types, physical_form, manufacturer_lot, quantity_received, unit, received_date)
    VALUES (pg_temp.cfl(), 'Lead in rice reference material', '{Reference Standard}', 'Solid', 'RM-1', 50, 'g', current_date);
  INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit) SELECT pg_temp.item('Lead in rice reference material'), id, 1000, 'mg/kg' FROM analyte WHERE analyte_name = 'Lead';
END $$;
INSERT INTO inventory_lot (site_id, item_name, chemical_types, physical_form, manufacturer_lot, quantity_received, unit) VALUES (pg_temp.cfl(), 'Blank rice flour', '{Reagent}', 'Solid', 'RF-1', 1, 'kg');
SELECT pg_temp.expect_true('Solid mixture: 1 g at 1000 mg/kg + 9 g blank = 100 mg/kg',
  (SELECT concentration = 100 AND concentration_unit = 'mg/kg' FROM mixture_concentrations(
     jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('Lead in rice reference material'), 'quantity', 1), jsonb_build_object('lot_id', pg_temp.item('Blank rice flour'), 'quantity', 0.009)),
     10, 'g', 'Solid', '{}')));
INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit) SELECT pg_temp.item('Hydrochloric acid 1N'), id, 1, 'M' FROM analyte WHERE analyte_name = 'Arsenic';
-- (since migration 007 a molar concentration is calculated when the analyte has a molar mass; see test_007)
SELECT pg_temp.expect_true('A molar concentration without a molar mass: reported as not calculated, not guessed',
  (SELECT concentration IS NULL AND calc_note LIKE 'Not calculated%no molar mass%' FROM mixture_concentrations(
     jsonb_build_array(jsonb_build_object('lot_id', pg_temp.item('Hydrochloric acid 1N'), 'quantity', 0.01)), 100, 'mL', 'Liquid', '{}')));

-- Reorder copies the item, warnings per lot
SELECT reorder_lot(pg_temp.item('Lead Standard 1000 ppm'), 100, 'test reorder');
SELECT pg_temp.expect_true('Reorder copies the name and analyte', (SELECT receipt_status = 'Requested' AND analytes_text = 'Lead 1000 ppm' FROM inventory_lot_view
  WHERE item_name = 'Lead Standard 1000 ppm' AND notes = 'test reorder'));
SELECT pg_temp.expect_true('Lot warnings: expiry Alert within 30 days is not raised at 60 days; quantity conforms',
  (SELECT bool_and(result = 'Conforms') FROM lot_rule_results(pg_temp.item('DI Water Diluent'))));
SELECT pg_temp.expect_true('Audit entries for units and analyte lines are readable and linked',
  audit_record_ref('unit_of_measure', gen_random_uuid(), '{"unit_code":"dram"}')->>'link' = '#/admin/units?find=dram'
  AND (SELECT audit_record_ref('lot_analyte', la.id, to_jsonb(la))->>'label' LIKE 'Lot INV-% analyte Lead' FROM lot_analyte la WHERE la.lot_id = pg_temp.item('Lead Working Solution 10 ppm')));

SELECT rpad(left(test, 74), 76) || outcome AS result FROM results;
SELECT 1 AS done;
