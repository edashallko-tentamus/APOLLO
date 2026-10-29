-- 065: the purchasing and vendor approval rules move to the Java backend (Edashall Konah, 2026-10-29; the database keeps
-- structures only). Java checks them before every write (purchasing/domain: PurchaseLine, PurchaseOrder,
-- PurchasingSetting, VendorQualification, VendorDecision, VendorPromotion, VendorNotice, VendorDocument, RiskClass,
-- SupplyScope, ScopeList; saved through purchasing/service and purchasing/repo), with JUnit tests in PurchasingRulesTest.
--
-- Dropped here (Java is now their only checker):
--   * reject_purchase_lines() and receive_purchase_line() (receiving, partial deliveries and back-orders, problems,
--     the actual price, equipment into the register, Other or Service purchases into inventory);
--   * propose_vendor_promotion(), withdraw_vendor_promotion(), decide_vendor_promotion(), acknowledge_vendor_notices(),
--     vendor_promotion_rules, the trigger z_notices (vendor_qualification_notices) and vendor_internal();
--   * the rule parts of vendor_qualification_rules (frozen once recorded, the risk class fits, scopes, the expiry from
--     the risk class, no future date, a lab never looser than Corporate QA, the signature stamp), supplier_risk_class_rules
--     (no move between labs), supply_scope_rules (name, the default is offered, an item type in one scope),
--     vendor_document_rules (frozen, a decided proposal is closed, a reason to withdraw), vendor_notice_rules (written
--     by the approvals, acknowledged once, who and when) and purchase_order_rules (only the PO number, confirmation
--     and notes change, made from approved requests); their permission and signature checks stay, as every
--     permission trigger does until the permissions wave;
--   * the checks vendor_qualification_dates, supplier_risk_class class_name and requal_months, supply_scope scope_name,
--     purchase_receipt_note, purchase_receipt actual_unit_price and purchasing_setting second_approval_over.
--
-- Kept, with Java's own copy for Java's writes:
--   * purchase_line_rules (a0_rules), purchase_line_scope (a00_scope), purchase_line_to_lot and the purchase_line column
--     checks: inventory's lot triggers (inventory_lot_purchase_sync, inventory_lot_purchase_link) raise and move
--     purchase requests for items requested on the Inventory page, and the demo data load writes requests directly;
--   * approve_purchase_lines() and create_purchase_order(): still called by inventory's lot page (LotService,
--     routes_inventory.js "approve or order the lot's purchase request"), the demo data load (seed_004, seed_009) and
--     the inventory and media rule tests (test_005, test_020);
--   * purchase_receipt_rules: inventory's lot trigger records a receipt when an item is received on its own page and
--     relies on the signature stamp; receipts are append-only;
--   * vendor_decision, supplier_status_at, current_vendor_qualification, vendor_corporate, vendor_local, scopes_cover,
--     scope_names, assert_supplier_scope, assert_supplier_approved, needs_second_approval, purchase_line_default_scopes:
--     read by the views (supplier_status_view, purchase_line_view, vendor_approval_view, vendor_promotion_view) and the
--     kept purchase request triggers;
--   * vendor_document_one_owner and the value lists (vendor_promotion status, vendor_document doc_kind): shapes, not rules.
-- Sandbox only: other writers of the dropped rules' tables (data load scripts) are no longer checked by the database.

-- actions now done by Java (PurchaseLine.receive, assertRejectable; VendorPromotion.propose, withdraw, decide; VendorNotice)
DROP FUNCTION IF EXISTS reject_purchase_lines(uuid[], text);
DROP FUNCTION IF EXISTS receive_purchase_line(uuid, numeric, boolean, receipt_discrepancy, text, uuid, text, date, date, uuid, jsonb, numeric, jsonb);
DROP FUNCTION IF EXISTS propose_vendor_promotion(uuid, uuid, uuid[], text);
DROP FUNCTION IF EXISTS withdraw_vendor_promotion(uuid);
DROP FUNCTION IF EXISTS decide_vendor_promotion(uuid, text, text, uuid, uuid[], boolean);
DROP FUNCTION IF EXISTS acknowledge_vendor_notices(uuid[]);

-- vendor_promotion: changed only through Java's steps
DROP TRIGGER IF EXISTS a0_rules ON vendor_promotion;
DROP FUNCTION IF EXISTS vendor_promotion_rules();

-- vendor_qualification: the permission and signature checks only; the notices are Java's (VendorNotice.corporateBlock)
DROP TRIGGER IF EXISTS z_notices ON vendor_qualification;
DROP FUNCTION IF EXISTS vendor_qualification_notices();
CREATE OR REPLACE FUNCTION vendor_qualification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL THEN
        IF NOT has_corporate_permission('purchasing.qualify_corporate') THEN
            RAISE EXCEPTION 'Corporate (all labs) vendor approvals are made by Corporate QA. Approve the vendor for this lab, then propose it for corporate approval.';
        END IF;
    ELSE
        PERFORM require_permission_at('purchasing.qualify', NEW.site_id);
    END IF;
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'qualify a supplier' ELSE 'withdraw a supplier qualification' END);
    RETURN NEW;
END $$;
ALTER TABLE vendor_qualification DROP CONSTRAINT IF EXISTS vendor_qualification_dates;

-- supplier_risk_class: the permission and signature checks only
CREATE OR REPLACE FUNCTION supplier_risk_class_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL AND NOT has_corporate_permission('purchasing.qualify_corporate') THEN
        RAISE EXCEPTION 'The shared risk classes are kept by Corporate QA; add a class for your own lab instead';
    END IF;
    IF NEW.site_id IS NOT NULL THEN PERFORM require_permission_at('purchasing.qualify', NEW.site_id); END IF;
    PERFORM assert_signed('change the supplier risk classes');
    RETURN NEW;
END $$;
ALTER TABLE supplier_risk_class DROP CONSTRAINT IF EXISTS supplier_risk_class_class_name_check;
ALTER TABLE supplier_risk_class DROP CONSTRAINT IF EXISTS supplier_risk_class_requal_months_check;

-- supply_scope: the permission and signature checks only
CREATE OR REPLACE FUNCTION supply_scope_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NOT has_corporate_permission('purchasing.qualify_corporate') THEN
        RAISE EXCEPTION 'The supply scopes are kept by Corporate QA (purchasing.qualify_corporate)';
    END IF;
    PERFORM assert_signed('change the supply scopes');
    RETURN NEW;
END $$;
ALTER TABLE supply_scope DROP CONSTRAINT IF EXISTS supply_scope_scope_name_check;

-- vendor_document: the permission check only
CREATE OR REPLACE FUNCTION vendor_document_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; v_corp boolean;
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.qualification_id IS NOT NULL THEN
        SELECT site_id, site_id IS NULL INTO v_site, v_corp FROM vendor_qualification WHERE id = NEW.qualification_id;
    ELSE
        SELECT site_id, false INTO v_site, v_corp FROM vendor_promotion WHERE id = NEW.promotion_id;
    END IF;
    IF v_corp THEN
        IF NOT has_corporate_permission('purchasing.qualify_corporate') THEN RAISE EXCEPTION 'Documents of a corporate approval are kept by Corporate QA'; END IF;
    ELSE
        PERFORM require_permission_at('purchasing.qualify', v_site);
    END IF;
    RETURN NEW;
END $$;

-- vendor_notice: the permission check on acknowledging only
CREATE OR REPLACE FUNCTION vendor_notice_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('purchasing.qualify', NEW.site_id);
    RETURN NEW;
END $$;
DROP FUNCTION IF EXISTS vendor_internal();

-- purchase_order: the permission and signature checks on changes only (create_purchase_order checks its own)
CREATE OR REPLACE FUNCTION purchase_order_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
    PERFORM require_permission_at('purchasing.order', NEW.site_id);
    PERFORM assert_signed('change a purchase order');
    RETURN NEW;
END $$;

-- purchase_receipt and purchasing_setting: the value checks
ALTER TABLE purchase_receipt DROP CONSTRAINT IF EXISTS purchase_receipt_note;
ALTER TABLE purchase_receipt DROP CONSTRAINT IF EXISTS purchase_receipt_actual_unit_price_check;
ALTER TABLE purchasing_setting DROP CONSTRAINT IF EXISTS purchasing_setting_second_approval_over_check;
