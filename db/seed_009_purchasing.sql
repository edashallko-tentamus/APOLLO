-- Sandbox demo data for Purchasing (migration 011): the lab-made HPTLC group keeps what it had (inventory request and
-- approve became purchasing permissions), CFL needs a second approval above 5,000 USD, CFL's own Class IV risk class,
-- a supplier nobody has qualified yet, and requests at each step of the queue.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

INSERT INTO group_permission (group_id, permission_code)
SELECT gp.group_id, replace(gp.permission_code, 'inventory.', 'purchasing.') FROM group_permission gp
 WHERE gp.permission_code IN ('inventory.request','inventory.approve') AND gp.status = 'Active' ON CONFLICT DO NOTHING;
INSERT INTO reason_code (module, reason_text, sort_order)
SELECT 'Purchasing', r, s FROM (VALUES ('Correcting an entry error', 10), ('Quantity or price changed', 20), ('Supplier changed', 30), ('No longer needed', 40)) AS x(r, s)
WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = 'Purchasing' AND lower(c.reason_text) = lower(x.r));

UPDATE purchasing_setting SET second_approval_over = 5000 WHERE site_id = (SELECT id FROM lab_site WHERE site_code = 'CFL') AND second_approval_over IS NULL;
INSERT INTO supplier_risk_class (site_id, class_name, requal_months, description, sort_order)
SELECT id, 'Class IV', 60, 'CFL only: very low risk, long-standing vendors (e.g. lab coats, paper goods)', 4 FROM lab_site WHERE site_code = 'CFL'
ON CONFLICT DO NOTHING;
INSERT INTO supplier (supplier_name, supplier_type, website, email, account_number, contact_name)
VALUES ('Budget Lab Supplies', 'Supplier', 'budgetlab.example.com', 'sales@budgetlab.example.com', NULL, 'Sam Ortiz')
ON CONFLICT DO NOTHING;
UPDATE supplier SET account_number = 'CFL-44871', contact_name = 'Dana Whitfield', address = '1200 Harbor Way, Long Beach, CA'
 WHERE supplier_name = 'Northbridge Scientific Supply' AND account_number IS NULL;

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); nb uuid := (SELECT id FROM supplier WHERE supplier_name = 'Northbridge Scientific Supply');
        oven uuid; cal uuid; bags uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM purchase_line WHERE description LIKE 'HPLC column oven%') THEN RETURN; END IF;
    -- requested by the analyst
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    INSERT INTO purchase_line (site_id, line_type, description, supplier_id, catalog_number, quantity, unit, unit_price, justification, needed_by)
    VALUES (cfl, 'Equipment', 'HPLC column oven (Agilent G7116A)', nb, 'G7116A', 1, 'each', 6200, 'Second oven so HPLC 1 can run two methods without re-plumbing', current_date + 30)
    RETURNING id INTO oven;
    INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity, unit, unit_price, justification)
    VALUES (cfl, 'Service', 'Pipette calibration visit (12 pipettes)', nb, 1, 'visit', 1080, 'Six-monthly calibration due next month')
    RETURNING id INTO cal;
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'intake'), true);
    PERFORM script_signature('Sandbox demo data');
    INSERT INTO purchase_line (site_id, line_type, description, supplier_id, catalog_number, quantity, unit, unit_price)
    VALUES (cfl, 'Other', 'Sample bags, 1 L, sterile (case of 500)', nb, 'SB-1000-S', 3, 'case', 85)
    RETURNING id INTO bags;
    -- the Lab Supervisor approves the oven (over 5,000 USD: waits for a General Manager) and the bags, and orders the bags
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM approve_purchase_lines(ARRAY[oven, bags]);
    PERFORM create_purchase_order(ARRAY[bags], 'FIN-2026-0011', NULL, 'Standing order');
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
END $$;

COMMIT;
