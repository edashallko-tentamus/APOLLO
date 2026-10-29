-- 062: the inventory rules move to the Java backend (Edashall Konah, 2026-10-29; the database keeps structures only).
-- Java checks them before every write (inventory/domain: Lot, StockMovement, StorageLocation, ThresholdRule, Mixture,
-- Units, LotQaTesting, LotAnalyteLine, SampleRetain, SupplierCoa, QaTestingDefault; waste/domain: WasteClassification;
-- saved through inventory/service LotWriter and ListRowRules), with JUnit tests in InventoryRulesTest and WasteRulesTest.
--
-- Dropped here (Java is now their only checker):
--   * storage_location_rules (code in capitals, stays in its lab, parent in the same lab, no loop) and the code/name checks;
--   * the threshold_rule checks (type fits the subject, chemical only on stock rules, percentage at most 100, name, value);
--   * supplier_coa_rules (name and fingerprint copied from the file, document and AI proposal frozen, who confirmed);
--   * lot_component_rules and lot_component_qa_rule (mixture only, not itself, same lab, components released for every use);
--   * dispose_lot() and waive_lot_qa_testing() (only the inventory routes called them);
--   * the rule parts of qa_testing_default_rules and waste_classification_rules, and the waste name check (their
--     permission checks stay, as every permission trigger does until the permissions wave).
--
-- Kept, with Java's own copy for Java's writes:
--   * inventory_lot_rules, inventory_lot_receipt (z_receipt), inventory_lot_chemical_analyte, inventory_lot_analyte_required,
--     inventory_lot_media_rule, inventory_lot_department_rule, inventory_lot_waste_rule and the inventory_lot column checks:
--     still called by purchasing (receive_purchase_line), the bench, logbooks (lots made from entries), workflow
--     verification and the demo data load, which write lots directly;
--   * inventory_txn_rules and inventory_transaction_waste: still called by the bench (entry_material usage) and mixtures;
--   * lot_component_usage (z_usage): it writes each component's Usage; Java relies on it rather than writing a second one;
--   * lot_analyte_rules: still called by prepare_mixture, reorder_lot, transfer_lot and logbook lots;
--   * sample_storage_check: intake changes quantity_received on the same rows;
--   * receive_lot, transfer_lot, reorder_lot, make_mixture, prepare_mixture, mixture_*(), unit_factor, canonical_unit:
--     still called by purchasing (receive_lot) and the demo data load;
--   * send_lot_for_qa_testing and qualify_media: they order tests on the internal order (orders' rules); qualify_media is
--     still called by the media rule tests;
--   * lot_qa_status / lot_qa_problem / lot_qa_required / media_status / lab_qa_default / waste_default_for /
--     below_threshold / expiry_warning_days / lot_on_hand / assert_storage_ok / location_path: read by views, the bench,
--     labels and the kept triggers above.
-- Sandbox only: other writers of the dropped rules' tables (data load scripts, make_mixture and prepare_mixture called by
-- the demo data load) are no longer checked by the database.

-- storage_location
DROP TRIGGER IF EXISTS a0_rules ON storage_location;
DROP FUNCTION IF EXISTS storage_location_rules();
ALTER TABLE storage_location DROP CONSTRAINT IF EXISTS storage_location_location_code_check;
ALTER TABLE storage_location DROP CONSTRAINT IF EXISTS storage_location_location_name_check;

-- threshold_rule
ALTER TABLE threshold_rule DROP CONSTRAINT IF EXISTS threshold_rule_type_fits;
ALTER TABLE threshold_rule DROP CONSTRAINT IF EXISTS threshold_rule_chemical_fits;
ALTER TABLE threshold_rule DROP CONSTRAINT IF EXISTS threshold_rule_pct;
ALTER TABLE threshold_rule DROP CONSTRAINT IF EXISTS threshold_rule_rule_name_check;
ALTER TABLE threshold_rule DROP CONSTRAINT IF EXISTS threshold_rule_value_check;

-- supplier_coa
DROP TRIGGER IF EXISTS a0_rules ON supplier_coa;
DROP FUNCTION IF EXISTS supplier_coa_rules();

-- lot_component (z_usage stays)
DROP TRIGGER IF EXISTS a0_rules ON lot_component;
DROP FUNCTION IF EXISTS lot_component_rules();
DROP TRIGGER IF EXISTS a02_qa ON lot_component;
DROP FUNCTION IF EXISTS lot_component_qa_rule();

-- actions now done by Java (Lot.dispose, LotQaTesting.assertWaivable)
DROP FUNCTION IF EXISTS dispose_lot(uuid);
DROP FUNCTION IF EXISTS waive_lot_qa_testing(uuid);

-- qa_testing_default: the permission check only
CREATE OR REPLACE FUNCTION qa_testing_default_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('inventory.qa_configure', NEW.site_id);
    RETURN NEW;
END $$;

-- waste_classification: the permission check only
CREATE OR REPLACE FUNCTION waste_classification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT in_group_sync() THEN
        IF NEW.site_id IS NULL THEN
            IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Waste classifications for every lab are kept by a system administrator; add one for your lab instead'; END IF;
        ELSE
            PERFORM require_permission_at('inventory.lists', NEW.site_id);
        END IF;
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE waste_classification DROP CONSTRAINT IF EXISTS waste_classification_waste_name_check;
