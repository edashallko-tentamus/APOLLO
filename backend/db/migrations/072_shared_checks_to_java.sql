-- 072: the shared foundations move to the Java backend (Edashall Konah, 2026-10-30; the database keeps structures only):
-- who may change a table (the permission triggers) and "a change needs a signature in this transaction", for the tables
-- only Java writes. Java checks them before every write: core/access AccessPolicy (requireAt = require_permission_at's
-- refusal, requireToChange = require_list_permission's, requireSystemAdmin with the database's words), the controlled
-- lists' keepers (masterdata/domain ControlledList.keptBy / keptAtLabBy, checked row by row by ControlledListService),
-- and SignatureService.signed around every write of the signed tables. JUnit: PermissionChecksTest, SignatureRulesTest.
-- Also: the two Java formula parsers are one class (core/calc/Formula), used by the designer and the bench.
--
-- Dropped here (Java is now their only checker):
--   * a01_permission on client, contact, client_contact, client_license, client_service_line (master.clients: Client,
--     Contact, License and Charges services); matrix, product_category (master.matrices), compliance_category
--     (master.compliance), site_holiday (admin.lab at the lab): ControlledList keepers; chemical (inventory.lists);
--     email_template (outbox.templates); oos_checklist_item, oos_procedure_setting (oos.configure); rush_fee_schedule,
--     rush_fee_tier, service_line, service_line_type (catalog.edit); charge_item; rush_decision (intake.rush);
--     purchasing_setting, site_media (admin.lab); report_template; system_setting; training_rule; finance_week,
--     finance_plan; group_widget; stability_condition, stability_chamber, stability_rack; trend_chart,
--     trend_signal_review; waste_classification; qa_testing_default; sample_photo; accounting_connection,
--     accounting_customer;
--   * a_maintainer on reason_code (master.reasons) and a_admin_only on lab_site (system administrators);
--   * their functions: report_template_rules, system_setting_rules, training_rule_rules, finance_rules,
--     group_widget_rules, trend_rules, waste_classification_rules, qa_testing_default_rules, charge_item_rules,
--     sample_photo_rules, accounting_connection_rules, require_qa_or_admin, stability_setup_rules (its chamber part stays,
--     below: seed_025 inserts chambers without their lab);
--   * a00_signature (require_signature) on storage_location, threshold_rule, unit_of_measure, unit_conversion;
--     a00_storage_signature on sample (sample_storage_signature); a00_signature (require_methods_signature) on test,
--     test_version, test_version_analyte, workflow_step, workflow_step_equipment, workflow_step_dependency, method.
--
-- Kept (and why):
--   * has_permission, has_permission_at, user_has_permission_at, user_can_access_site, user_can_view_site,
--     require_permission_at, require_list_permission, lab_record_permission, require_admin, in_group_sync: read by views,
--     kept functions and the triggers kept below;
--   * a01_permission on lab_order, sample, requested_test, requested_analyte: Node writes them (Receive and sign, the
--     due-pulls job, the workflow verification run); on project, project_version and the quote lines
--     (quoted_test_configuration, quoted_analyte_selection, quote_rush_term, quoted_package, quoted_charge): Node sends
--     quotes and takes the client's answer, and new_project_version (still called by the verification run) writes them;
--     on test_catalog_entry, test_analyte_price, test_rush_approval, test_package, test_package_item,
--     test_package_analyte, catalog_price_change: the hourly price-change job (Node) writes them;
--   * the bench (batch_entry, step_run, entry_value, entry_material, entry_equipment, step_attachment, incubation_load,
--     split_request, analyst_pick, test_batch) and the logbook, sensor, OOS, report and invoice remnants: the workflow
--     verification run, the sensor feed and the PDF routes (Node) write them;
--   * inventory_permission and require_signature on inventory_lot, lot_analyte, lot_component, inventory_transaction,
--     supplier_coa; supplier (purchasing.suppliers and its signature: the Excel upload's row messages would change);
--     a_maintainer on storage_location, threshold_rule, unit_of_measure, unit_conversion; analyte (analyte_permission,
--     analyte_molar_mass_rules); test, test_version, method (their permission rules); the equipment, purchasing,
--     permission-group, logbook, stability design, specification and app_user rules: not yet audited write path by write
--     path in Java (a later wave);
--   * user_site_access (a_admin_only, z_group_sync): written by data load scripts only;
--   * the GxP backstop: make_gxp (gxp_stamp with its Reason for Change rule on regulated edits, gxp_audit, no hard
--     delete, record_version), audit_log, signature_event rules, assert_signed, sign_action, script_signature. Java asks
--     for the reason first (RequestContext.withReason / orReason, the services' reason checks); the database's rule stays
--     as the backstop for every writer.
-- Sandbox only: direct writes to the dropped tables (data load scripts, rule-test fixtures) are no longer checked.

-- who may change a table: now checked by Java
DROP TRIGGER IF EXISTS a01_permission ON client;
DROP TRIGGER IF EXISTS a01_permission ON contact;
DROP TRIGGER IF EXISTS a01_permission ON client_contact;
DROP TRIGGER IF EXISTS a01_permission ON client_license;
DROP TRIGGER IF EXISTS a01_permission ON client_service_line;
DROP TRIGGER IF EXISTS a01_permission ON matrix;
DROP TRIGGER IF EXISTS a01_permission ON product_category;
DROP TRIGGER IF EXISTS a01_permission ON compliance_category;
DROP TRIGGER IF EXISTS a01_permission ON site_holiday;
DROP TRIGGER IF EXISTS a01_permission ON chemical;
DROP TRIGGER IF EXISTS a01_permission ON email_template;
DROP TRIGGER IF EXISTS a01_permission ON oos_checklist_item;
DROP TRIGGER IF EXISTS a01_permission ON oos_procedure_setting;
DROP TRIGGER IF EXISTS a01_permission ON rush_fee_schedule;
DROP TRIGGER IF EXISTS a01_permission ON rush_fee_tier;
DROP TRIGGER IF EXISTS a01_permission ON service_line;
DROP TRIGGER IF EXISTS a01_permission ON service_line_type;
DROP TRIGGER IF EXISTS a01_permission ON charge_item;
DROP TRIGGER IF EXISTS a01_permission ON rush_decision;
DROP TRIGGER IF EXISTS a01_permission ON purchasing_setting;
DROP TRIGGER IF EXISTS a01_permission ON site_media;
DROP TRIGGER IF EXISTS a01_permission ON report_template;
DROP TRIGGER IF EXISTS a01_permission ON system_setting;
DROP TRIGGER IF EXISTS a01_permission ON training_rule;
DROP TRIGGER IF EXISTS a01_permission ON finance_week;
DROP TRIGGER IF EXISTS a01_permission ON finance_plan;
DROP TRIGGER IF EXISTS a01_permission ON group_widget;
DROP TRIGGER IF EXISTS a01_permission ON stability_condition;
DROP TRIGGER IF EXISTS a01_permission ON stability_chamber;
DROP TRIGGER IF EXISTS a01_permission ON stability_rack;
DROP TRIGGER IF EXISTS a01_permission ON trend_chart;
DROP TRIGGER IF EXISTS a01_permission ON trend_signal_review;
DROP TRIGGER IF EXISTS a01_permission ON waste_classification;
DROP TRIGGER IF EXISTS a01_permission ON qa_testing_default;
DROP TRIGGER IF EXISTS a01_permission ON sample_photo;
DROP TRIGGER IF EXISTS a01_permission ON accounting_connection;
DROP TRIGGER IF EXISTS a01_permission ON accounting_customer;
DROP TRIGGER IF EXISTS a_maintainer ON reason_code;
DROP TRIGGER IF EXISTS a_admin_only ON lab_site;

DROP FUNCTION IF EXISTS report_template_rules();
DROP FUNCTION IF EXISTS system_setting_rules();
DROP FUNCTION IF EXISTS training_rule_rules();
DROP FUNCTION IF EXISTS finance_rules();
DROP FUNCTION IF EXISTS group_widget_rules();
DROP FUNCTION IF EXISTS trend_rules();
DROP FUNCTION IF EXISTS waste_classification_rules();
DROP FUNCTION IF EXISTS qa_testing_default_rules();
DROP FUNCTION IF EXISTS charge_item_rules();
DROP FUNCTION IF EXISTS sample_photo_rules();
DROP FUNCTION IF EXISTS accounting_connection_rules();
DROP FUNCTION IF EXISTS require_qa_or_admin();
DROP FUNCTION IF EXISTS stability_setup_rules();

-- a chamber's lab is its equipment's (seed_025 and other data loads insert chambers without it; Java sets it too)
CREATE FUNCTION stability_chamber_site() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.site_id := (SELECT site_id FROM equipment WHERE id = NEW.equipment_id);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_site BEFORE INSERT OR UPDATE ON stability_chamber FOR EACH ROW EXECUTE FUNCTION stability_chamber_site();

-- a change needs a signature in this transaction: Java writes these only signed
DROP TRIGGER IF EXISTS a00_signature ON storage_location;
DROP TRIGGER IF EXISTS a00_signature ON threshold_rule;
DROP TRIGGER IF EXISTS a00_signature ON unit_of_measure;
DROP TRIGGER IF EXISTS a00_signature ON unit_conversion;
DROP TRIGGER IF EXISTS a00_storage_signature ON sample;
DROP FUNCTION IF EXISTS sample_storage_signature();
DROP TRIGGER IF EXISTS a00_signature ON test;
DROP TRIGGER IF EXISTS a00_signature ON test_version;
DROP TRIGGER IF EXISTS a00_signature ON test_version_analyte;
DROP TRIGGER IF EXISTS a00_signature ON workflow_step;
DROP TRIGGER IF EXISTS a00_signature ON workflow_step_equipment;
DROP TRIGGER IF EXISTS a00_signature ON workflow_step_dependency;
DROP TRIGGER IF EXISTS a00_signature ON method;
DROP FUNCTION IF EXISTS require_methods_signature();
