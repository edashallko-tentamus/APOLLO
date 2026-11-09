-- Verification for migration 005 (Inventory): who maintains lists and approves reorders, lab access,
-- storage conditions, lot rules, stock movements, mixtures, reorder / receive / transfer / dispose,
-- Supplier COA records, warning thresholds, sample storage and retained quantity, audit references
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
-- Since migration 007 inventory changes are signed: each user in these tests signs as a data load script
SELECT script_signature('Rule test', false);
SELECT set_config('lims.reason', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END
$$;
CREATE OR REPLACE FUNCTION pg_temp.lot(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM inventory_lot WHERE notes = code $$;
CREATE OR REPLACE FUNCTION pg_temp.site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;

UPDATE app_user SET is_admin = true WHERE username = 'akiddle';
INSERT INTO app_user (username, full_name, job_role) VALUES ('inv.sup', 'Inventory Supervisor', 'Lab Supervisor'), ('inv.tech', 'Inventory Analyst', 'Analyst');
SELECT set_config('lims.reason', 'Test setup', false);
INSERT INTO user_site_access (user_id, site_id) SELECT u.id, s.id FROM app_user u, lab_site s
 WHERE (u.username = 'inv.sup' AND s.site_code IN ('CFL','TPS')) OR (u.username = 'inv.tech' AND s.site_code = 'CFL')
ON CONFLICT (user_id, site_id) DO UPDATE SET status = 'Active';
SELECT set_config('lims.reason', '', false);

-- Job roles and who maintains the lists
SELECT pg_temp.as_user('inv.tech');
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): an analyst cannot add to the Chemical list (InventoryListsService.saveChemicals)
SELECT set_config('lims.reason', 'Promote myself', false);
SELECT pg_temp.expect_error('Only an administrator can change a job role', $$UPDATE app_user SET job_role = 'QA' WHERE username = 'inv.tech'$$);
SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error('Changing a job role needs a reason', $$UPDATE app_user SET job_role = 'QA' WHERE username = 'inv.tech'$$);
SELECT set_config('lims.reason', 'Moved to QA for the day', false);
UPDATE app_user SET job_role = 'QA' WHERE username = 'inv.tech';
SELECT pg_temp.expect_true('Job role change is in the audit trail with its reason',
  EXISTS (SELECT 1 FROM audit_log a JOIN app_user u ON u.id = a.record_id WHERE a.table_name = 'app_user' AND u.username = 'inv.tech'
          AND a.reason = 'Moved to QA for the day' AND a.changed_fields->'job_role'->>'new' = 'QA'));
SELECT pg_temp.as_user('inv.tech');
SELECT set_config('lims.reason', '', false);
INSERT INTO chemical (chemical_name, cas_number) VALUES ('Nitric acid', '7697-37-2'), ('Methanol', '67-56-1'), ('Lead', '7439-92-1'), ('Cadmium', '7440-43-9');
SELECT pg_temp.expect_true('QA can add to the Chemical list', (SELECT count(*) FROM chemical) >= 4);
SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', 'Back to analyst', false);
UPDATE app_user SET job_role = 'Analyst' WHERE username = 'inv.tech';
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error('Duplicate chemical name (any capitals) rejected', $$INSERT INTO chemical (chemical_name) VALUES ('METHANOL')$$);
SELECT pg_temp.expect_error('Duplicate CAS number rejected', $$INSERT INTO chemical (chemical_name, cas_number) VALUES ('Methyl alcohol', '67-56-1')$$);
SELECT pg_temp.expect_error('Invalid CAS number rejected', $$INSERT INTO chemical (chemical_name, cas_number) VALUES ('Fakeium', '1234-56-7')$$);
INSERT INTO supplier (supplier_name) VALUES ('Test Supplier Co.');

-- Storage locations
INSERT INTO storage_location (site_id, location_code, location_name, location_type, supported_conditions)
VALUES (pg_temp.site('CFL'), 'LAB-1', 'Lab 1', 'Room', '{}'), (pg_temp.site('TPS'), 'TPS-1', 'TPS lab', 'Room', '{}');
INSERT INTO storage_location (site_id, location_code, location_name, location_type, parent_location_id, supported_conditions, holds_samples)
SELECT pg_temp.site('CFL'), x.c, x.n, x.t::location_type, (SELECT id FROM storage_location WHERE location_code = 'LAB-1'), x.s::storage_condition[], x.h
  FROM (VALUES ('FR-1', 'Fridge 1', 'Refrigerator', '{"Refrigerated (2-8 °C)"}', false), ('FLAM-1', 'Flammables', 'Cabinet', '{"Flammables cabinet"}', false),
               ('RET-1', 'Retain shelf', 'Shelf', '{"Ambient (15-25 °C)"}', true)) AS x(c, n, t, s, h);
-- Moved to the Java backend in migration 062 (JUnit: InventoryRulesTest.storageLocations): location codes are stored in capitals
SELECT pg_temp.expect_true('Location path reads building > shelf', location_path((SELECT id FROM storage_location WHERE location_code = 'FR-1')) = 'Lab 1 > Fridge 1');
SELECT set_config('lims.reason', 'Testing', false);
-- Moved to the Java backend in migration 062 (JUnit: InventoryRulesTest.storageLocations): a location cannot be inside itself, and must be inside one in the same lab
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.as_user('inv.tech');
SELECT pg_temp.expect_error('Analyst cannot add a storage location',
  $$INSERT INTO storage_location (site_id, location_code, location_name) VALUES (pg_temp.site('CFL'), 'X-1', 'X')$$);

-- Lots: what a lot needs
-- Since migration 006 the Chemical list is no longer required; a lot needs its own name instead (see test_006)
SELECT pg_temp.expect_error('A lot needs a name (Chemical list retired in migration 006)',
  $$INSERT INTO inventory_lot (site_id, chemical_types, manufacturer_lot, quantity_received, unit) VALUES (pg_temp.site('CFL'), '{Reagent}', 'M1', 1, 'L')$$);
SELECT pg_temp.expect_error('A received reagent needs the manufacturer lot',
  $$INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, quantity_received, unit) VALUES (pg_temp.site('CFL'), (SELECT id FROM chemical WHERE chemical_name = 'Nitric acid'), '{Reagent}', 1, 'L')$$);
SELECT pg_temp.expect_error('Unit must come from the unit list',
  $$INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, manufacturer_lot, quantity_received, unit) VALUES (pg_temp.site('CFL'), (SELECT id FROM chemical WHERE chemical_name = 'Nitric acid'), '{Reagent}', 'M1', 1, 'gallons')$$);
SELECT pg_temp.expect_error('Purity does not apply to consumables',
  $$INSERT INTO inventory_lot (site_id, chemical_types, item_description, quantity_received, unit, purity_pct) VALUES (pg_temp.site('CFL'), '{Consumable}', 'Tips', 1, 'box', 99)$$);
SELECT pg_temp.expect_error('Storage condition must match the location (methanol in the fridge that is not a flammables cabinet)',
  $$INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, manufacturer_lot, quantity_received, unit, storage_condition, storage_location_id)
    VALUES (pg_temp.site('CFL'), (SELECT id FROM chemical WHERE chemical_name = 'Methanol'), '{Solvent}', 'M1', 4, 'L', 'Flammables cabinet', (SELECT id FROM storage_location WHERE location_code = 'FR-1'))$$);
SELECT pg_temp.expect_error('Analyst assigned to CFL only cannot log a lot at TPS',
  $$INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, manufacturer_lot, quantity_received, unit) VALUES (pg_temp.site('TPS'), (SELECT id FROM chemical WHERE chemical_name = 'Nitric acid'), '{Reagent}', 'M1', 1, 'L')$$);
INSERT INTO inventory_lot (site_id, chemical_id, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date, storage_condition, storage_location_id, notes) VALUES
 (pg_temp.site('CFL'), (SELECT id FROM chemical WHERE chemical_name = 'Methanol'), '{Solvent}', 'MEOH-1', 4, 'L', current_date + 365, 'Flammables cabinet', (SELECT id FROM storage_location WHERE location_code = 'FLAM-1'), 'meoh'),
 (pg_temp.site('CFL'), (SELECT id FROM chemical WHERE chemical_name = 'Lead'), '{"Reference Standard"}', 'PB-1', 100, 'mL', current_date + 200, 'Refrigerated (2-8 °C)', (SELECT id FROM storage_location WHERE location_code = 'FR-1'), 'pb'),
 (pg_temp.site('CFL'), (SELECT id FROM chemical WHERE chemical_name = 'Cadmium'), '{"Reference Standard"}', 'CD-1', 100, 'mL', current_date + 20, 'Refrigerated (2-8 °C)', (SELECT id FROM storage_location WHERE location_code = 'FR-1'), 'cd'),
 (pg_temp.site('CFL'), (SELECT id FROM chemical WHERE chemical_name = 'Nitric acid'), '{Reagent}', 'HNO3-OLD', 1, 'L', current_date - 3, NULL, NULL, 'old');
INSERT INTO inventory_lot (site_id, chemical_types, item_description, quantity_received, unit, notes) VALUES (pg_temp.site('CFL'), '{Consumable}', 'Pipette tips', 10, 'box', 'tips');
SELECT pg_temp.expect_true('A consumable needs no chemical or manufacturer lot', lot_on_hand(pg_temp.lot('tips')) = 10);
SELECT pg_temp.expect_true('Receiving writes a Receipt movement; on hand = quantity received', lot_on_hand(pg_temp.lot('meoh')) = 4);
SELECT pg_temp.expect_true('Received date defaults to today', (SELECT received_date = site_today(site_id) FROM inventory_lot WHERE id = pg_temp.lot('pb')));
SELECT pg_temp.expect_true('Lot gets a lab ID like INV-000001', (SELECT lot_code ~ '^INV-\d{6}$' FROM inventory_lot WHERE id = pg_temp.lot('pb')));

-- Stock movements
INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference) VALUES (pg_temp.lot('meoh'), 'Usage', 3.5, 'HPLC');
SELECT pg_temp.expect_true('Usage is stored as a negative movement', lot_on_hand(pg_temp.lot('meoh')) = 0.5);
SELECT pg_temp.expect_error('Expired lot cannot be used', $$INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change) VALUES (pg_temp.lot('old'), 'Usage', 0.1)$$);
SELECT pg_temp.expect_error('An adjustment needs a reason', $$INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change) VALUES (pg_temp.lot('meoh'), 'Adjustment', -0.1)$$);
INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference) VALUES (pg_temp.lot('meoh'), 'Usage', 1, 'HPLC, bottle reading');
SELECT pg_temp.expect_true('Stock can go negative and is flagged for reconciliation',
  (SELECT on_hand = -0.5 AND negative_stock FROM inventory_lot_view WHERE id = pg_temp.lot('meoh')));
SELECT set_config('lims.reason', 'Stock count found 0.2 L', false);
INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change) VALUES (pg_temp.lot('meoh'), 'Adjustment', 0.7);
SELECT pg_temp.expect_true('Adjustment keeps its reason', EXISTS (SELECT 1 FROM inventory_transaction WHERE lot_id = pg_temp.lot('meoh') AND txn_type = 'Adjustment' AND reason = 'Stock count found 0.2 L'));
SELECT pg_temp.expect_error('Stock movements cannot be edited', $$UPDATE inventory_transaction SET quantity_change = -1 WHERE lot_id = pg_temp.lot('meoh') AND txn_type = 'Usage' AND reference = 'HPLC'$$);
SELECT set_config('lims.reason', '', false);
SELECT set_config('lims.reason', 'Typo', false);
SELECT pg_temp.expect_error('Quantity received cannot be edited after receipt (use an Adjustment)', $$UPDATE inventory_lot SET quantity_received = 5 WHERE notes = 'meoh'$$);
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error('Stock movements cannot be deleted', $$DELETE FROM inventory_transaction WHERE lot_id = pg_temp.lot('meoh')$$);

-- Warnings (never block)
SELECT pg_temp.as_user('akiddle');
INSERT INTO threshold_rule (rule_name, subject, rule_type, value) VALUES ('Low stock 20%', 'Lot Quantity', 'Percentage of Base', 20), ('Expiry 30 days', 'Lot Expiry', 'Days Until/Since', 30),
  ('Retain 25%', 'Sample Retain', 'Percentage of Base', 25);
-- Moved to the Java backend in migration 062 (JUnit: InventoryRulesTest.warningRules): a threshold type must fit what it watches
SELECT pg_temp.expect_true('Low stock warning below 20% of the amount received', (SELECT low_stock FROM inventory_lot_view WHERE id = pg_temp.lot('meoh')));
SELECT pg_temp.expect_true('Expiring soon within 30 days; expired is not usable',
  (SELECT expiry_status = 'Expiring soon' AND use_eligible FROM inventory_lot_view WHERE id = pg_temp.lot('cd'))
  AND (SELECT expiry_status = 'Expired' AND NOT use_eligible AND not_usable_because = 'Expired' FROM inventory_lot_view WHERE id = pg_temp.lot('old')));

-- In-house mixture
SELECT pg_temp.as_user('inv.tech');
SELECT pg_temp.expect_error('Mixture cannot expire after its earliest-expiring component',
  $$SELECT make_mixture(pg_temp.site('CFL'), NULL, 'Cal mix', 50, 'mL', 10, 'µg/mL', current_date + 100, NULL, NULL,
      jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot('pb'), 'quantity', 1), jsonb_build_object('lot_id', pg_temp.lot('cd'), 'quantity', 1)))$$);
SELECT pg_temp.expect_error('Expired component cannot be used in a mixture',
  $$SELECT make_mixture(pg_temp.site('CFL'), NULL, 'Cal mix', 50, 'mL', NULL, NULL, NULL, NULL, NULL,
      jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot('old'), 'quantity', 0.01)))$$);
SELECT set_config('lims.reason', 'Tag test record', false);
DO $do$ DECLARE v uuid; BEGIN v := make_mixture(pg_temp.site('CFL'), NULL, 'Cal mix', 50, 'mL', 10, 'µg/mL', NULL, NULL, NULL,
      jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot('pb'), 'quantity', 1), jsonb_build_object('lot_id', pg_temp.lot('cd'), 'quantity', 1)));
UPDATE inventory_lot SET notes = 'mix' WHERE id = v; END $do$;
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_true('Mixture expiry defaults to the earliest component; components were used',
  (SELECT expiration_date = current_date + 20 FROM inventory_lot WHERE notes = 'mix') AND lot_on_hand(pg_temp.lot('pb')) = 99);
SELECT pg_temp.expect_true('Mixture has no manufacturer lot; its lab ID is its Resource ID',
  (SELECT manufacturer_lot IS NULL AND lot_code LIKE 'INV-%' FROM inventory_lot WHERE notes = 'mix'));
SELECT set_config('lims.reason', 'Extend', false);
SELECT pg_temp.expect_error('Mixture expiry cannot be pushed past its components later', $$UPDATE inventory_lot SET expiration_date = current_date + 90 WHERE notes = 'mix'$$);
SELECT set_config('lims.reason', '', false);

-- Reorder, approve, order, receive
SELECT reorder_lot(pg_temp.lot('meoh'), 4);
SELECT pg_temp.expect_true('Reorder creates one Requested lot linked to the original',
  (SELECT count(*) = 1 AND bool_and(receipt_status = 'Requested' AND NOT use_eligible) FROM inventory_lot_view WHERE reorder_of_lot_id = pg_temp.lot('meoh')));
SELECT set_config('lims.reason', 'Tag test record', false);
UPDATE inventory_lot SET notes = 'reorder' WHERE reorder_of_lot_id = pg_temp.lot('meoh');
SELECT set_config('lims.reason', '', false);
SELECT set_config('lims.reason', 'Approve', false);
SELECT pg_temp.expect_error('An analyst cannot approve a reorder', $$UPDATE inventory_lot SET receipt_status = 'Approved' WHERE notes = 'reorder'$$);
SELECT pg_temp.expect_error('A requested lot cannot skip approval', $$UPDATE inventory_lot SET receipt_status = 'Ordered' WHERE notes = 'reorder'$$);
SELECT pg_temp.expect_error('A pending lot cannot be used', $$INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change) VALUES (pg_temp.lot('reorder'), 'Usage', 1)$$);
-- (since migration 011 approval and ordering go through Purchasing: the approval queue, then a purchase order)
SELECT pg_temp.as_user('akiddle');
INSERT INTO vendor_qualification (supplier_id, risk_class_id, approval_status, approval_date)
SELECT id, (SELECT id FROM supplier_risk_class WHERE site_id IS NULL AND class_name = 'Class II'), 'Approved', current_date FROM supplier WHERE supplier_name = 'Test Supplier Co.';
SELECT pg_temp.as_user('inv.tech');
UPDATE inventory_lot SET supplier_id = (SELECT id FROM supplier WHERE supplier_name = 'Test Supplier Co.') WHERE notes = 'reorder';
SELECT pg_temp.as_user('inv.sup');
SELECT approve_purchase_lines(ARRAY[(SELECT purchase_line_id FROM inventory_lot WHERE notes = 'reorder')]);
SELECT pg_temp.expect_true('Lab Supervisor approval is recorded', (SELECT approved_by = (SELECT id FROM app_user WHERE username = 'inv.sup') FROM inventory_lot WHERE notes = 'reorder'));
SELECT create_purchase_order(ARRAY[(SELECT purchase_line_id FROM inventory_lot WHERE notes = 'reorder')], 'FIN-1001', NULL);
SELECT pg_temp.as_user('inv.tech');
SELECT set_config('lims.reason', 'Received', false);
SELECT pg_temp.expect_error('Receiving needs the manufacturer lot', $$SELECT receive_lot(pg_temp.lot('reorder'), 4, NULL, NULL, current_date + 400, NULL, NULL)$$);
SELECT receive_lot(pg_temp.lot('reorder'), 4, NULL, 'MEOH-2', current_date + 400, NULL, NULL);
SELECT pg_temp.expect_true('Receive fills in the same lot (no second lot) and adds the stock',
  (SELECT receipt_status = 'Received' AND use_eligible AND on_hand = 4 FROM inventory_lot_view WHERE id = pg_temp.lot('reorder'))
  AND (SELECT count(*) FROM inventory_lot WHERE reorder_of_lot_id = pg_temp.lot('meoh')) = 1);
SELECT pg_temp.expect_error('A received lot cannot go back to Ordered', $$UPDATE inventory_lot SET receipt_status = 'Ordered' WHERE notes = 'reorder'$$);
SELECT set_config('lims.reason', '', false);

-- Supplier COA (document kept unchanged, fingerprinted; AI proposal kept with the person's confirmation)
INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('coa-pb.pdf', 'application/pdf', 0, '', convert_to('%PDF-1.4 test', 'UTF8'));
INSERT INTO supplier_coa (lot_id, document_id, file_name, sha256, extraction_method, ai_model, ai_proposed)
SELECT pg_temp.lot('pb'), id, file_name, sha256, 'AI proposed, person confirmed', 'test-model', '{"manufacturer_lot": "PB-1", "expiration_date": "2027-04-30"}' FROM document_file WHERE file_name = 'coa-pb.pdf';
SELECT pg_temp.expect_true('COA record carries the file fingerprint (SHA-256)',
  (SELECT c.sha256 = encode(sha256(convert_to('%PDF-1.4 test', 'UTF8')), 'hex') FROM supplier_coa c WHERE c.lot_id = pg_temp.lot('pb')));
SELECT pg_temp.expect_error('An uploaded document cannot be changed', $$UPDATE document_file SET file_name = 'x.pdf' WHERE file_name = 'coa-pb.pdf'$$);
-- Moved to the Java backend in migration 062 (JUnit: InventoryRulesTest.supplierCoa): the AI proposal cannot be changed after the fact
UPDATE supplier_coa SET values_confirmed = '{"manufacturer_lot": "PB-1"}' WHERE lot_id = pg_temp.lot('pb');
-- Moved to the Java backend in migration 062 (JUnit: InventoryRulesTest.supplierCoa): confirmation records who confirmed
SELECT pg_temp.expect_true('COA on file shows on the lot', (SELECT coa_on_file FROM inventory_lot_view WHERE id = pg_temp.lot('pb')));

-- Transfer between labs
SELECT pg_temp.as_user('inv.sup');
SELECT pg_temp.expect_error('Transfer cannot go to the same lab', $$SELECT transfer_lot(pg_temp.lot('pb'), pg_temp.site('CFL'), 10)$$);
SELECT set_config('lims.reason', 'Tag test record', false);
DO $do$ DECLARE v uuid; BEGIN v := transfer_lot(pg_temp.lot('pb'), pg_temp.site('TPS'), 10, 'For TPS'); UPDATE inventory_lot SET notes = 'pb-tps' WHERE id = v; END $do$;
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_true('Transfer: sending lab writes 10 mL off; receiving lab gets a new In Transit lot with the same manufacturer lot and COA',
  lot_on_hand(pg_temp.lot('pb')) = 89 AND (SELECT receipt_status = 'In Transit' AND manufacturer_lot = 'PB-1' AND transferred_from_lot_id = pg_temp.lot('pb') AND coa_on_file
                                           FROM inventory_lot_view WHERE notes = 'pb-tps'));
SELECT set_config('lims.reason', 'Received at TPS', false);
SELECT pg_temp.as_user('inv.tech');
SELECT pg_temp.expect_error('Only someone at the receiving lab can receive the transfer', $$SELECT receive_lot(pg_temp.lot('pb-tps'), 10, NULL, NULL, NULL, NULL, NULL)$$);
SELECT pg_temp.as_user('inv.sup');
SELECT receive_lot(pg_temp.lot('pb-tps'), 10, NULL, NULL, NULL, NULL, NULL);
SELECT pg_temp.expect_true('Receiving lab receives it like a new lot', (SELECT use_eligible AND on_hand = 10 FROM inventory_lot_view WHERE notes = 'pb-tps'));
SELECT pg_temp.expect_error('A lot cannot simply be moved to another lab', $$UPDATE inventory_lot SET site_id = pg_temp.site('TPS') WHERE notes = 'pb'$$);

-- Dispose
SELECT set_config('lims.reason', '', false);
-- Moved to the Java backend in migration 062 (JUnit: InventoryRulesTest.dispose): disposing needs a reason (dispose_lot dropped)
SELECT set_config('lims.reason', 'Expired', false);
SELECT pg_temp.expect_error('Status cannot be set to Disposed directly', $$UPDATE inventory_lot SET status = 'Disposed' WHERE notes = 'old'$$);
-- what Java's Lot.dispose writes: the remainder off, then the lot closed through Dispose
DO $do$ DECLARE v numeric := lot_on_hand(pg_temp.lot('old')); BEGIN
  IF v <> 0 THEN INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference)
    VALUES (pg_temp.lot('old'), CASE WHEN v > 0 THEN 'Disposal' ELSE 'Adjustment' END::inventory_txn_type, -v, 'Written off at disposal'); END IF;
  PERFORM set_config('lims.disposing', '1', true); UPDATE inventory_lot SET status = 'Disposed' WHERE id = pg_temp.lot('old'); PERFORM set_config('lims.disposing', '', true);
END $do$;
SELECT pg_temp.expect_true('Dispose writes off the remainder and closes the lot', (SELECT status = 'Disposed' AND on_hand = 0 FROM inventory_lot_view WHERE notes = 'old'));
SELECT pg_temp.expect_error('A disposed lot cannot be reopened', $$UPDATE inventory_lot SET status = 'Available' WHERE notes = 'old'$$);
SELECT pg_temp.expect_error('Lots cannot be deleted', $$DELETE FROM inventory_lot WHERE notes = 'old'$$);

-- Sample storage and retained quantity
SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', 'Retained sample shelved', false);
SELECT pg_temp.expect_error('A sample can only go in a location set up for samples',
  $$UPDATE sample SET storage_location_id = (SELECT id FROM storage_location WHERE location_code = 'FR-1') WHERE client_sample_id = 'LOT-A1'$$);
SELECT pg_temp.expect_error('Sample storage condition must match the location',
  $$UPDATE sample SET storage_location_id = (SELECT id FROM storage_location WHERE location_code = 'RET-1'), storage_condition = 'Frozen (-20 °C)' WHERE client_sample_id = 'LOT-A1'$$);
SELECT pg_temp.expect_error('Retained quantity cannot exceed what was received', $$UPDATE sample SET retained_quantity = 600 WHERE client_sample_id = 'LOT-A1'$$);
UPDATE sample SET storage_location_id = (SELECT id FROM storage_location WHERE location_code = 'RET-1'), storage_condition = 'Ambient (15-25 °C)', retained_quantity = 100
 WHERE client_sample_id = 'LOT-A1';
SELECT pg_temp.expect_true('Retained quantity takes the sample''s unit; below 25% of 500 g warns (100 g)',
  (SELECT retained_unit = 'g' AND retain_low AND location_code = 'RET-1' FROM sample_storage_view WHERE client_sample_id = 'LOT-A1'));

-- Audit references
SELECT pg_temp.expect_true('Audit entry for a lot links to the lot page',
  (SELECT r->>'label' = 'Lot ' || l.lot_code AND r->>'link' = '#/inventory/lots/' || l.id FROM inventory_lot l, audit_record_ref('inventory_lot', l.id, to_jsonb(l)) r WHERE l.notes = 'pb'));
SELECT pg_temp.expect_true('Audit references for earlier records still work',
  (SELECT r->>'link' = '#/samples/' || s.id FROM sample s, audit_record_ref('sample', s.id, to_jsonb(s)) r WHERE s.client_sample_id = 'LOT-A1'));

SELECT rpad(left(test, 74), 76) || outcome AS result FROM results;
SELECT 1 AS done;
