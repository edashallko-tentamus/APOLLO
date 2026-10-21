-- Verification for migration 052 (0.30.0): waste classifications. The shared starter list; a lab's own; who keeps
-- them; hazard classes from the controlled list; one default per item type per lab (the lab's before the shared);
-- every new inventory item gets its classification (chosen, or the default for its type); another lab's is refused
-- (a transfer takes the receiving lab's default); a retired one cannot be chosen; disposal records it.
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.site_id', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (other error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.wc_site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.wc(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM waste_classification WHERE waste_name = n AND status = 'Active' ORDER BY site_id NULLS LAST LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.wc_grp(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT g.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id WHERE s.site_code = site AND g.group_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.wc_lot(n text, types chemical_type[], site text DEFAULT 'CFL', w uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO inventory_lot (site_id, item_name, chemical_types, receipt_status, quantity_received, unit, received_date, manufacturer_lot, expiration_date, waste_classification_id)
  VALUES (pg_temp.wc_site(site), n, types, 'Received', 1, 'L', current_date, 'WC-' || n, current_date + 365, w) RETURNING id $$;
CREATE OR REPLACE FUNCTION pg_temp.wc_of(lot uuid) RETURNS text LANGUAGE sql AS $$
  SELECT w.waste_name FROM inventory_lot l JOIN waste_classification w ON w.id = l.waste_classification_id WHERE l.id = lot $$;

INSERT INTO app_user (username, full_name) VALUES ('wc.sup', 'WC Supervisor'), ('wc.ana', 'WC Analyst');
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.wc_grp('CFL', 'Lab Supervisor'), (SELECT id FROM app_user WHERE username = 'wc.sup')),
  (pg_temp.wc_grp('CFL', 'Analyst'), (SELECT id FROM app_user WHERE username = 'wc.ana'));
SELECT set_config('lims.site_id', pg_temp.wc_site('CFL')::text, false);

-- 1. the list
SELECT pg_temp.expect_true('Every lab starts with the shared list (12), each with a code WC-',
  (SELECT count(*) >= 12 AND bool_and(waste_code LIKE 'WC-%') FROM waste_classification WHERE site_id IS NULL));
SELECT pg_temp.expect_true('Shared defaults: Media and strains biohazardous, solvents flammable, consumables non-hazardous, reagents to classify from the SDS',
  (SELECT waste_name FROM waste_classification WHERE id = waste_default_for(pg_temp.wc_site('CFL'), '{Media}')) LIKE 'Biohazardous%'
  AND (SELECT waste_name FROM waste_classification WHERE id = waste_default_for(pg_temp.wc_site('CFL'), '{Solvent}')) = 'Non-halogenated flammable solvents'
  AND (SELECT waste_name FROM waste_classification WHERE id = waste_default_for(pg_temp.wc_site('CFL'), '{Consumable}')) = 'Non-hazardous solid waste'
  AND (SELECT needs_review FROM waste_classification WHERE id = waste_default_for(pg_temp.wc_site('CFL'), '{Reagent}')));
SELECT pg_temp.as_user('wc.sup');
SELECT pg_temp.expect_error_like('Shared classifications are kept by system administrators',
  $$UPDATE waste_classification SET container = 'x' WHERE waste_name = 'Sharps' AND site_id IS NULL$$, 'system administrator');
INSERT INTO waste_classification (site_id, waste_name, hazard_classes, epa_codes, waste_stream, default_for)
  VALUES (pg_temp.wc_site('CFL'), 'CFL acetonitrile waste', '{Ignitable,Toxic}', 'D001, U003', 'Acetonitrile (HPLC)', '{Solvent}');
SELECT pg_temp.expect_true('A Lab Supervisor (inventory.lists) adds the lab''s own, with its own default for Solvent',
  (SELECT site_id = pg_temp.wc_site('CFL') FROM waste_classification WHERE waste_name = 'CFL acetonitrile waste'));
SELECT pg_temp.expect_error_like('One default per item type in the lab',
  $$INSERT INTO waste_classification (site_id, waste_name, hazard_classes, default_for) VALUES (pg_temp.wc_site('CFL'), 'CFL methanol waste', '{Ignitable}', '{Solvent}')$$, 'already the default for Solvent');
SELECT pg_temp.expect_error_like('Hazard classes come from the controlled list',
  $$INSERT INTO waste_classification (site_id, waste_name, hazard_classes) VALUES (pg_temp.wc_site('CFL'), 'CFL odd waste', '{Explosive}')$$, 'Unknown hazard class');
SELECT pg_temp.expect_error_like('Non-hazardous, or hazard classes, not both',
  $$INSERT INTO waste_classification (site_id, waste_name, hazard_classes) VALUES (pg_temp.wc_site('CFL'), 'CFL mixed', '{Non-hazardous,Toxic}')$$, 'not both');
SELECT pg_temp.expect_error_like('A classification has hazard classes, or is marked Needs review',
  $$INSERT INTO waste_classification (site_id, waste_name) VALUES (pg_temp.wc_site('CFL'), 'CFL unknown')$$, 'Needs review');
SELECT pg_temp.expect_error_like('Names are unique in the lab',
  $$INSERT INTO waste_classification (site_id, waste_name, hazard_classes) VALUES (pg_temp.wc_site('CFL'), 'cfl ACETONITRILE waste', '{Toxic}')$$, 'waste_classification_name');
SELECT pg_temp.as_user('wc.ana');
SELECT pg_temp.expect_error('An Analyst cannot change the list',
  $$INSERT INTO waste_classification (site_id, waste_name, hazard_classes) VALUES (pg_temp.wc_site('CFL'), 'CFL analyst waste', '{Toxic}')$$);

-- 2. every item has one
SELECT pg_temp.as_user('akiddle');
CREATE TEMP TABLE wc_l AS SELECT pg_temp.wc_lot('WC Acetonitrile', '{Solvent}') AS solvent, pg_temp.wc_lot('WC TSA plates', '{Media}') AS media,
  pg_temp.wc_lot('WC Nitric acid', '{Reagent}') AS reagent, pg_temp.wc_lot('WC Lead standard', '{Reagent}', 'CFL', pg_temp.wc('Heavy metal solutions and standards')) AS chosen;
SELECT pg_temp.expect_true('A new item takes the lab''s own default for its type (CFL acetonitrile waste), else the shared default (media: biohazardous)',
  pg_temp.wc_of((SELECT solvent FROM wc_l)) = 'CFL acetonitrile waste' AND pg_temp.wc_of((SELECT media FROM wc_l)) LIKE 'Biohazardous%');
SELECT pg_temp.expect_true('A reagent defaults to "classify from the SDS" (needs review); a chosen classification is kept',
  pg_temp.wc_of((SELECT reagent FROM wc_l)) LIKE 'Laboratory chemical: classify%' AND pg_temp.wc_of((SELECT chosen FROM wc_l)) = 'Heavy metal solutions and standards');
UPDATE inventory_lot SET waste_classification_id = pg_temp.wc('Corrosive acids') WHERE id = (SELECT reagent FROM wc_l);
SELECT pg_temp.expect_true('The item is classified from its SDS (Corrosive acids)', pg_temp.wc_of((SELECT reagent FROM wc_l)) = 'Corrosive acids');
UPDATE inventory_lot SET waste_classification_id = NULL WHERE id = (SELECT reagent FROM wc_l);
SELECT pg_temp.expect_true('Cleared, it goes back to the default for its type (never none)', pg_temp.wc_of((SELECT reagent FROM wc_l)) LIKE 'Laboratory chemical: classify%');
SELECT set_config('lims.site_id', pg_temp.wc_site('TPS')::text, false);
SELECT pg_temp.expect_true('An item arriving at TPS with CFL''s own classification takes TPS''s default instead (transfers)',
  pg_temp.wc_of(pg_temp.wc_lot('WC Acetonitrile at TPS', '{Solvent}', 'TPS', pg_temp.wc('CFL acetonitrile waste'))) = 'Non-halogenated flammable solvents');
SELECT pg_temp.expect_error_like('Another lab''s classification cannot be chosen for an item',
  $$UPDATE inventory_lot SET waste_classification_id = pg_temp.wc('CFL acetonitrile waste') WHERE item_name = 'WC Acetonitrile at TPS'$$, 'belongs to another lab');
SELECT set_config('lims.site_id', pg_temp.wc_site('CFL')::text, false);
UPDATE waste_classification SET status = 'Inactive' WHERE waste_name = 'Oxidizers' AND site_id IS NULL;
SELECT pg_temp.expect_error_like('A retired classification cannot be chosen',
  $$UPDATE inventory_lot SET waste_classification_id = (SELECT id FROM waste_classification WHERE waste_name = 'Oxidizers') WHERE id = (SELECT media FROM wc_l)$$, 'retired');
UPDATE waste_classification SET status = 'Active' WHERE waste_name = 'Oxidizers' AND site_id IS NULL;

-- 3. disposal records what it was disposed of as
INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reason) VALUES ((SELECT chosen FROM wc_l), 'Disposal', -1, 'Rule test');
SELECT pg_temp.expect_true('Disposing of an item records its waste classification on the disposal',
  (SELECT waste_classification_id = pg_temp.wc('Heavy metal solutions and standards') FROM inventory_transaction WHERE lot_id = (SELECT chosen FROM wc_l) AND txn_type::text = 'Disposal'));
SELECT pg_temp.expect_true('The view counts the items in use and says which are hazardous',
  (SELECT items_in_use >= 1 AND is_hazardous FROM waste_classification_view WHERE waste_name = 'CFL acetonitrile waste')
  AND (SELECT NOT is_hazardous FROM waste_classification_view WHERE waste_name = 'Non-hazardous solid waste' AND site_id IS NULL));
SELECT pg_temp.expect_true('The audit trail names the classification and links to its page',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'waste_classification' AND (audit_record_ref(table_name, record_id, new_row)->>'link') = '#/admin/waste'));
SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.as_user('akiddle');

SELECT test, outcome AS result FROM results;
