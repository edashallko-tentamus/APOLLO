-- Verification for migration 011: purchasing permissions and the Accounting group, supplier risk classes and
-- qualifications (all labs or one lab), the block on unapproved suppliers, requests, approval (never your own) with a
-- second approval above the lab's amount, rejection, purchase orders, partial receipts with back-orders, discrepancies,
-- equipment received into the register, inventory lots kept in step, and audit references.
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT set_config('lims.site_id', '', false);
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
CREATE OR REPLACE FUNCTION pg_temp.user_only(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) || set_config('lims.signature_id', '', false)
$$;
CREATE OR REPLACE FUNCTION pg_temp.site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.grp(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT g.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id WHERE s.site_code = site AND g.group_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.sup(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM supplier WHERE supplier_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.cls(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM supplier_risk_class WHERE class_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.line(d text) RETURNS purchase_line LANGUAGE sql AS $$ SELECT * FROM purchase_line WHERE description = d ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.can(u text, code text, site text) RETURNS boolean LANGUAGE sql AS $$
  SELECT user_has_permission_at(pg_temp.uid(u), code, pg_temp.site(site)) $$;

INSERT INTO app_user (username, full_name) VALUES ('pu.ana', 'Pur Analyst'), ('pu.sup', 'Pur Supervisor'), ('pu.gm1', 'Pur GM One'), ('pu.gm2', 'Pur GM Two'),
 ('pu.qa', 'Pur QA'), ('pu.acc', 'Pur Accounting'), ('pu.tpsqa', 'Pur TPS QA'), ('pu.corp', 'Pur Corporate QA');
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES
 (pg_temp.grp('CFL', 'Analyst'), pg_temp.uid('pu.ana')), (pg_temp.grp('CFL', 'Lab Supervisor'), pg_temp.uid('pu.sup')),
 (pg_temp.grp('CFL', 'General Manager'), pg_temp.uid('pu.gm1')), (pg_temp.grp('CFL', 'General Manager'), pg_temp.uid('pu.gm2')),
 (pg_temp.grp('CFL', 'QA'), pg_temp.uid('pu.qa')), (pg_temp.grp('CFL', 'Accounting'), pg_temp.uid('pu.acc')), (pg_temp.grp('TPS', 'QA'), pg_temp.uid('pu.tpsqa'));
-- (since migration 050 approvals for every lab are Corporate QA's: the all-labs Corporate QA group)
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.uid('pu.corp') FROM lab_group g WHERE g.site_id IS NULL AND g.group_name = 'Corporate QA (all labs)';

-- Permissions and the Accounting group
SELECT pg_temp.expect_true('Every lab has an Accounting group that can order', pg_temp.grp('CFL', 'Accounting') IS NOT NULL AND pg_temp.grp('TPS', 'Accounting') IS NOT NULL
  AND pg_temp.can('pu.acc', 'purchasing.order', 'CFL'));
SELECT pg_temp.expect_true('Anyone can request and receive; approving is Supervisor/GM; second approval GM; qualifying QA',
  pg_temp.can('pu.ana', 'purchasing.request', 'CFL') AND pg_temp.can('pu.ana', 'purchasing.receive', 'CFL') AND NOT pg_temp.can('pu.ana', 'purchasing.approve', 'CFL')
  AND pg_temp.can('pu.sup', 'purchasing.approve', 'CFL') AND NOT pg_temp.can('pu.sup', 'purchasing.approve_over', 'CFL') AND pg_temp.can('pu.gm1', 'purchasing.approve_over', 'CFL')
  AND pg_temp.can('pu.qa', 'purchasing.qualify', 'CFL') AND NOT pg_temp.can('pu.sup', 'purchasing.qualify', 'CFL'));
SELECT pg_temp.expect_true('The old inventory request/approve permissions are retired', (SELECT bool_and(status = 'Inactive') FROM permission WHERE code IN ('inventory.request','inventory.approve')));

-- Suppliers and risk classes
SELECT pg_temp.as_user('pu.qa');
INSERT INTO supplier (supplier_name, supplier_type) VALUES ('Pur Chem Supply', 'Supplier'), ('Pur Instruments Inc', 'Supplier'), ('Pur Unvetted LLC', 'Supplier');
SELECT pg_temp.as_user('pu.sup');
SELECT pg_temp.expect_error('A Lab Supervisor (no purchasing.suppliers) cannot add suppliers', $$INSERT INTO supplier (supplier_name) VALUES ('Nope Ltd')$$);
SELECT pg_temp.as_user('pu.qa');
SELECT pg_temp.expect_error('QA cannot change the shared risk classes (system administrators keep them)',
  $$INSERT INTO supplier_risk_class (class_name, requal_months) VALUES ('Class IV', 60)$$);
INSERT INTO supplier_risk_class (site_id, class_name, requal_months, description) VALUES (pg_temp.site('CFL'), 'Class IV', 60, 'Very low risk, long-standing vendors');
SELECT pg_temp.expect_true('A lab adds its own risk class (Class IV, 5 years)', (SELECT requal_months FROM supplier_risk_class WHERE class_name = 'Class IV') = 60);

-- Qualifications
SELECT pg_temp.user_only('pu.qa');
SELECT set_config('lims.site_id', pg_temp.site('CFL')::text, false);
SELECT pg_temp.expect_error('Qualifying a supplier needs a signature',
  $$INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date) VALUES (pg_temp.sup('Pur Chem Supply'), pg_temp.site('CFL'), pg_temp.cls('Class II'), 'Approved', current_date)$$);
SELECT pg_temp.as_user('pu.qa');
SELECT pg_temp.expect_error('A lab''s QA does not approve for every lab (050: Corporate QA does)',
  $$INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date) VALUES (pg_temp.sup('Pur Chem Supply'), NULL, pg_temp.cls('Class II'), 'Approved', current_date)$$);
SELECT pg_temp.as_user('pu.sup');
SELECT pg_temp.expect_error('Only QA (purchasing.qualify) qualifies suppliers',
  $$SELECT set_config('lims.site_id', pg_temp.site('CFL')::text, false); INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date) VALUES (pg_temp.sup('Pur Chem Supply'), pg_temp.site('CFL'), pg_temp.cls('Class II'), 'Approved', current_date)$$);
SELECT pg_temp.as_user('pu.corp');
SELECT set_config('lims.site_id', pg_temp.site('CFL')::text, false);
INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date, accreditations)
VALUES (pg_temp.sup('Pur Chem Supply'), NULL, pg_temp.cls('Class II'), 'Approved', current_date - 10, 'ISO 9001'),
       (pg_temp.sup('Pur Instruments Inc'), NULL, pg_temp.cls('Class I'), 'Approved', current_date - 10, 'ISO 17025');
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.vendorApprovals): the expiry comes from the risk class (Class II: 24 months)
SELECT pg_temp.expect_true('Approved for every lab', supplier_status_at(pg_temp.sup('Pur Chem Supply'), pg_temp.site('TPS')) = 'Approved');
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.vendorApprovals): a shared qualification cannot use one lab's own class
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.vendorApprovals): a qualification cannot be edited (record a new one)
SELECT pg_temp.as_user('pu.qa');
SELECT pg_temp.expect_true('Never qualified: Not qualified', supplier_status_at(pg_temp.sup('Pur Unvetted LLC'), pg_temp.site('CFL')) = 'Not qualified');
SELECT pg_temp.as_user('pu.tpsqa');
SELECT set_config('lims.site_id', pg_temp.site('TPS')::text, false);
INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date, justification)
VALUES (pg_temp.sup('Pur Instruments Inc'), pg_temp.site('TPS'), pg_temp.cls('Class I'), 'Suspended', current_date, 'Late deliveries at TPS');
SELECT pg_temp.expect_true('A lab''s own decision (TPS suspends) applies at that lab only',
  supplier_status_at(pg_temp.sup('Pur Instruments Inc'), pg_temp.site('TPS')) = 'Suspended' AND supplier_status_at(pg_temp.sup('Pur Instruments Inc'), pg_temp.site('CFL')) = 'Approved');
SELECT set_config('lims.site_id', '', false);

-- Requests: the block on unapproved suppliers
SELECT pg_temp.as_user('pu.ana');
SELECT pg_temp.expect_error('Requesting from a supplier that is not qualified is refused',
  $$INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity, unit_price) VALUES (pg_temp.site('CFL'), 'Service', 'Unvetted service', pg_temp.sup('Pur Unvetted LLC'), 1, 100)$$);
SELECT pg_temp.expect_error('Reordering an inventory item from a supplier that is not qualified is refused',
  $$INSERT INTO inventory_lot (site_id, item_name, physical_form, chemical_types, supplier_id, receipt_status, requested_quantity, unit) VALUES (pg_temp.site('CFL'), 'Acetone', 'Liquid', '{Solvent}', pg_temp.sup('Pur Unvetted LLC'), 'Requested', 4, 'L')$$);
SELECT pg_temp.expect_error('Inventory items are requested from the Inventory page, not as a bare line',
  $$INSERT INTO purchase_line (site_id, line_type, description, quantity) VALUES (pg_temp.site('CFL'), 'Inventory item', 'x', 1)$$);
INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity, unit, unit_price, justification)
VALUES (pg_temp.site('CFL'), 'Equipment', 'Viscometer DV2T', pg_temp.sup('Pur Instruments Inc'), 1, 'each', 4500, 'Replace the old viscometer'),
       (pg_temp.site('CFL'), 'Service', 'Annual balance calibration visit', pg_temp.sup('Pur Instruments Inc'), 1, 'visit', 800, NULL),
       (pg_temp.site('CFL'), 'Other', 'Lab coats (box)', pg_temp.sup('Pur Chem Supply'), 2, 'box', 60, NULL);
INSERT INTO inventory_lot (site_id, item_name, physical_form, chemical_types, supplier_id, receipt_status, requested_quantity, unit)
VALUES (pg_temp.site('CFL'), 'Acetonitrile HPLC grade', 'Liquid', '{Solvent}', pg_temp.sup('Pur Chem Supply'), 'Requested', 5, 'L');
SELECT pg_temp.expect_true('An inventory request gets its request line (same description, quantity, supplier, linked both ways)',
  (SELECT l.lot_id = i.id AND i.purchase_line_id = l.id AND l.quantity = 5 AND l.status = 'Requested' AND l.line_type = 'Inventory item'
     FROM inventory_lot i JOIN purchase_line l ON l.id = i.purchase_line_id WHERE i.item_name = 'Acetonitrile HPLC grade'));
SELECT pg_temp.expect_error('A lot cannot be approved on the lot itself any more (Purchasing approves it)',
  $$UPDATE inventory_lot SET receipt_status = 'Approved' WHERE item_name = 'Acetonitrile HPLC grade'$$);

-- Approval: never your own; second approval above the lab's amount by a different person
SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', 'Second approval for purchases over 1,000 USD', false);
UPDATE purchasing_setting SET second_approval_over = 1000 WHERE site_id = pg_temp.site('CFL');
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.as_user('pu.sup');
INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity, unit_price) VALUES (pg_temp.site('CFL'), 'Other', 'Supervisor own request', pg_temp.sup('Pur Chem Supply'), 1, 10);
SELECT pg_temp.as_user('pu.ana');
SELECT pg_temp.expect_error('An analyst cannot approve (someone else''s request)', $$SELECT approve_purchase_lines(ARRAY[(pg_temp.line('Supervisor own request')).id])$$);
SELECT pg_temp.as_user('pu.sup');
SELECT pg_temp.expect_error('Nobody approves their own request', $$SELECT approve_purchase_lines(ARRAY[(pg_temp.line('Supervisor own request')).id])$$);
SELECT approve_purchase_lines(ARRAY[(pg_temp.line('Lab coats (box)')).id, (pg_temp.line('Viscometer DV2T')).id, (pg_temp.line('Acetonitrile HPLC grade')).id]);
SELECT pg_temp.expect_true('Under the amount: Approved (and its lot too); over it: awaiting the second approval',
  (pg_temp.line('Lab coats (box)')).status = 'Approved' AND (pg_temp.line('Viscometer DV2T')).status = 'Awaiting second approval'
  AND (SELECT receipt_status = 'Approved' AND approved_by = pg_temp.uid('pu.sup') FROM inventory_lot WHERE item_name = 'Acetonitrile HPLC grade'));
SELECT pg_temp.expect_error('The Lab Supervisor cannot give the second approval (purchasing.approve_over)',
  $$SELECT approve_purchase_lines(ARRAY[(pg_temp.line('Viscometer DV2T')).id])$$);
SELECT pg_temp.as_user('pu.gm1');
SELECT approve_purchase_lines(ARRAY[(pg_temp.line('Annual balance calibration visit')).id]);
SELECT pg_temp.as_user('pu.gm1');
SELECT approve_purchase_lines(ARRAY[(pg_temp.line('Viscometer DV2T')).id]);
SELECT pg_temp.expect_true('A General Manager gives the second approval', (pg_temp.line('Viscometer DV2T')).status = 'Approved' AND (pg_temp.line('Viscometer DV2T')).approved2_by = pg_temp.uid('pu.gm1'));
SELECT pg_temp.as_user('pu.ana');
INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity, unit_price) VALUES (pg_temp.site('CFL'), 'Equipment', 'Second ICP-MS', pg_temp.sup('Pur Instruments Inc'), 1, 250000);
SELECT pg_temp.as_user('pu.gm1');
SELECT approve_purchase_lines(ARRAY[(pg_temp.line('Second ICP-MS')).id]);
SELECT pg_temp.expect_error('The first approver cannot also give the second approval',
  $$SELECT approve_purchase_lines(ARRAY[(pg_temp.line('Second ICP-MS')).id])$$);
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.approval): rejecting needs a reason; rejected with the reason kept

-- Purchase orders
SELECT pg_temp.as_user('pu.ana');
SELECT pg_temp.expect_error('An analyst cannot place orders', $$SELECT create_purchase_order(ARRAY[(pg_temp.line('Lab coats (box)')).id], 'FIN-1', NULL)$$);
SELECT pg_temp.as_user('pu.acc');
SELECT pg_temp.expect_error('An order goes to one supplier', $$SELECT create_purchase_order(ARRAY[(pg_temp.line('Lab coats (box)')).id, (pg_temp.line('Viscometer DV2T')).id], 'FIN-1', NULL)$$);
SELECT create_purchase_order(ARRAY[(pg_temp.line('Lab coats (box)')).id, (pg_temp.line('Acetonitrile HPLC grade')).id], 'FIN-2026-0042', 'SO-88123');
SELECT create_purchase_order(ARRAY[(pg_temp.line('Viscometer DV2T')).id, (pg_temp.line('Annual balance calibration visit')).id], 'FIN-2026-0043', NULL);
SELECT pg_temp.expect_true('Accounting orders: one PO per supplier with the finance PO number; lines and the lot are Ordered',
  (SELECT count(*) FROM purchase_order WHERE external_po_number LIKE 'FIN-2026-004%' AND po_code LIKE 'PO-CFL-%') = 2
  AND (pg_temp.line('Lab coats (box)')).status = 'Ordered' AND (SELECT receipt_status FROM inventory_lot WHERE item_name = 'Acetonitrile HPLC grade') = 'Ordered');
SELECT pg_temp.as_user('pu.ana');
INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity) VALUES (pg_temp.site('CFL'), 'Other', 'Gloves', pg_temp.sup('Pur Chem Supply'), 10);
SELECT pg_temp.as_user('pu.sup'); SELECT approve_purchase_lines(ARRAY[(pg_temp.line('Gloves')).id]);
SELECT pg_temp.as_user('pu.qa'); SELECT set_config('lims.site_id', pg_temp.site('CFL')::text, false);
INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date, justification)
VALUES (pg_temp.sup('Pur Chem Supply'), pg_temp.site('CFL'), pg_temp.cls('Class II'), 'Suspended', current_date, 'Audit finding');
SELECT pg_temp.as_user('pu.acc');
SELECT pg_temp.expect_error('Ordering from a supplier suspended since approval is refused', $$SELECT create_purchase_order(ARRAY[(pg_temp.line('Gloves')).id], 'FIN-9', NULL)$$);
SELECT set_config('lims.site_id', '', false);

-- Receiving: moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.receiving): a problem on delivery needs a note; a partial
-- receipt with a back-order lot; the back-order arriving; the problem kept on the receipt; received equipment needs its details and a
-- responsible group, goes into the register owned by the group and tagged out for qualification; a service received as done; a received
-- request cannot be received again.
SELECT pg_temp.as_user('pu.ana');
-- The received viscometer as Java's receiving puts it into the register (later tests use "Viscometer 2" as a stability chamber)
SELECT pg_temp.as_user('akiddle');
INSERT INTO equipment_type (site_id, type_name) VALUES (pg_temp.site('CFL'), 'Pur Viscometer');
INSERT INTO department (site_id, department_code, department_name) VALUES (pg_temp.site('CFL'), 'PURQ', 'Pur QC');
INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, serial_number, manufacturer)
  VALUES (pg_temp.site('CFL'), 'Viscometer 2', (SELECT id FROM equipment_type WHERE type_name = 'Pur Viscometer'), (SELECT id FROM department WHERE department_code = 'PURQ'), 'DV2T-555', 'Brookfield');
INSERT INTO equipment_owner (equipment_id, group_id) SELECT id, pg_temp.grp('CFL', 'Lab Supervisor') FROM equipment WHERE serial_number = 'DV2T-555';
SELECT set_config('lims.equipment_internal', '1', false);
INSERT INTO equipment_tag (equipment_id, reason, source, description) SELECT id, 'Qualification', 'New equipment', 'New equipment received: install and qualify before use' FROM equipment WHERE serial_number = 'DV2T-555';
SELECT set_config('lims.equipment_internal', '', false);
SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.as_user('pu.ana');
INSERT INTO purchase_receipt (purchase_line_id, quantity, discrepancy, note) VALUES ((pg_temp.line('Lab coats (box)')).id, 1, 'None', 'Rule test receipt');
SELECT pg_temp.expect_error('Receipts cannot be changed', $$UPDATE purchase_receipt SET note = 'x' WHERE quantity = 1$$);

-- Cancelling, and edits sending a request back for approval
SELECT pg_temp.as_user('pu.ana');
INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity, unit_price) VALUES (pg_temp.site('CFL'), 'Other', 'Big centrifuge', pg_temp.sup('Pur Instruments Inc'), 1, 3000);
SELECT pg_temp.as_user('pu.sup'); SELECT approve_purchase_lines(ARRAY[(pg_temp.line('Big centrifuge')).id]);
SELECT pg_temp.as_user('pu.ana');
UPDATE purchase_line SET unit_price = 3500 WHERE description = 'Big centrifuge';
SELECT pg_temp.expect_true('Changing a request after its first approval sends it back to Requested',
  (pg_temp.line('Big centrifuge')).status = 'Requested' AND (pg_temp.line('Big centrifuge')).approved_by IS NULL);
UPDATE purchase_line SET status = 'Cancelled' WHERE description = 'Big centrifuge';
SELECT pg_temp.expect_true('The requester can cancel their request', (pg_temp.line('Big centrifuge')).status = 'Cancelled');
SELECT pg_temp.expect_error('A cancelled request cannot be changed', $$UPDATE purchase_line SET quantity = 2 WHERE description = 'Big centrifuge'$$);
SELECT pg_temp.expect_error('Requests are never deleted', $$DELETE FROM purchase_line WHERE description = 'Big centrifuge'$$);

-- Audit
SELECT pg_temp.expect_true('Audit entries name the request and link to it',
  (SELECT r->>'label' LIKE 'Request PR-% Lab coats (box)' AND r->>'link' LIKE '#/purchasing/requests/%' FROM purchase_line l, audit_record_ref('purchase_line', l.id, to_jsonb(l)) r WHERE l.description = 'Lab coats (box)'));

SELECT set_config('lims.signature_id', '', false);
SELECT pg_temp.user_only('akiddle');
SELECT rpad(left(test, 74), 76) || outcome AS result FROM results;
SELECT 1 AS done;
