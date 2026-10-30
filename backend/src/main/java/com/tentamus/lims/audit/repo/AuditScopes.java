package com.tentamus.lims.audit.repo;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * What each page's audit icon shows (the Node backend's AUDIT_SCOPES, AUDIT_LISTS and SITE_AUDIT_KINDS, gathered from
 * every routes_*.js). A scope returns (table name, record id) pairs; $1 is the record id, or the current lab for the lab
 * list pages (SITE_KINDS). A list names the tables whose entries a list page shows.
 */
public final class AuditScopes {
    private AuditScopes() {}

    private static String sampleParts(String where) {
        return " UNION ALL SELECT 'requested_test', rt.id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id WHERE " + where
            + " UNION ALL SELECT 'requested_analyte', ra.id FROM requested_analyte ra JOIN requested_test rt ON rt.id = ra.requested_test_id JOIN sample s ON s.id = rt.sample_id WHERE " + where
            + " UNION ALL SELECT 'rush_decision', d.id FROM rush_decision d JOIN requested_test rt ON rt.id = d.requested_test_id JOIN sample s ON s.id = rt.sample_id WHERE " + where;
    }

    private static String quoteParts(String where) {
        return " UNION ALL SELECT 'quoted_test_configuration', q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id WHERE " + where
            + " UNION ALL SELECT 'quote_rush_term', r.id FROM quote_rush_term r JOIN project_version pv ON pv.id = r.project_version_id WHERE " + where
            + " UNION ALL SELECT 'quoted_analyte_selection', s.id FROM quoted_analyte_selection s JOIN quoted_test_configuration q ON q.id = s.line_id"
            + " JOIN project_version pv ON pv.id = q.project_version_id WHERE " + where;
    }

    private static String custody(String where) {
        return " UNION ALL SELECT 'custody_document', d.id FROM custody_document d WHERE " + where
            + " UNION ALL SELECT 'custody_event', e.id FROM custody_event e JOIN custody_document d ON d.id = e.custody_document_id WHERE " + where;
    }

    private static final List<String> EQUIPMENT_PARTS = List.of("equipment_owner", "maintenance_schedule", "equipment_tag", "equipment_event", "calibration",
        "qualification", "equipment_document", "equipment_transfer");

    private static String groupParts(String where) {
        return "SELECT 'lab_group', g.id FROM lab_group g WHERE " + where
            + " UNION ALL SELECT 'group_permission', gp.id FROM group_permission gp JOIN lab_group g ON g.id = gp.group_id WHERE " + where
            + " UNION ALL SELECT 'group_member', m.id FROM group_member m JOIN lab_group g ON g.id = m.group_id WHERE " + where;
    }

    public static final Map<String, String> SCOPES = Map.ofEntries(
        Map.entry("order", "SELECT 'lab_order', $1::uuid UNION ALL SELECT 'sample', s.id FROM sample s WHERE s.lab_order_id = $1 " + sampleParts("s.lab_order_id = $1")
            + " UNION ALL SELECT 'email_outbox', e.id FROM email_outbox e WHERE e.lab_order_id = $1"
            + " UNION ALL SELECT 'order_charge', oc.id FROM order_charge oc WHERE oc.lab_order_id = $1"
            + custody("d.lab_order_id = $1") + " UNION ALL SELECT 'sample_photo', p.id FROM sample_photo p JOIN sample s ON s.id = p.sample_id WHERE s.lab_order_id = $1"),
        Map.entry("sample", "SELECT 'sample', $1::uuid " + sampleParts("s.id = $1")
            + " UNION ALL SELECT 'coa', c.id FROM coa c WHERE c.sample_id = $1 UNION ALL SELECT 'coa_version', v.id FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = $1"
            + " UNION ALL SELECT 'coa_note', n.id FROM coa_note n WHERE n.sample_id = $1"
            + " UNION ALL SELECT 'result_finalization', f.id FROM result_finalization f JOIN requested_test rt ON rt.id = f.requested_test_id WHERE rt.sample_id = $1"
            + " UNION ALL SELECT 'sample_attachment', a.id FROM sample_attachment a WHERE a.sample_id = $1"
            + " UNION ALL SELECT 'sample_photo', p.id FROM sample_photo p WHERE p.sample_id = $1"),
        Map.entry("client", "SELECT 'client', $1::uuid UNION ALL SELECT 'client_contact', id FROM client_contact WHERE client_id = $1 UNION ALL SELECT 'client_license', id FROM client_license WHERE client_id = $1"),
        Map.entry("project", "SELECT 'project', $1::uuid UNION ALL SELECT 'project_version', id FROM project_version WHERE project_id = $1 " + quoteParts("pv.project_id = $1")),
        Map.entry("version", "SELECT 'project_version', $1::uuid " + quoteParts("pv.id = $1")),
        Map.entry("test", "SELECT 'test', $1::uuid UNION ALL SELECT 'test_version', id FROM test_version WHERE test_id = $1"
            + " UNION ALL SELECT 'test_catalog_entry', id FROM test_catalog_entry WHERE test_id = $1"
            + " UNION ALL SELECT 'test_analyte_price', p.id FROM test_analyte_price p JOIN test_catalog_entry e ON e.id = p.catalog_entry_id WHERE e.test_id = $1"
            + " UNION ALL SELECT 'test_rush_approval', p.id FROM test_rush_approval p JOIN test_catalog_entry e ON e.id = p.catalog_entry_id WHERE e.test_id = $1"),
        Map.entry("schedule", "SELECT 'rush_fee_schedule', $1::uuid UNION ALL SELECT 'rush_fee_tier', id FROM rush_fee_tier WHERE schedule_id = $1"),
        Map.entry("orders", "SELECT 'lab_order', id FROM lab_order WHERE site_id = $1 AND origin::text <> 'Workflow Verification'"),
        Map.entry("intake", "SELECT 'rush_decision', d.id FROM rush_decision d JOIN requested_test rt ON rt.id = d.requested_test_id JOIN sample s ON s.id = rt.sample_id"
            + " JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = $1"),
        Map.entry("outbox", "SELECT 'email_outbox', e.id FROM email_outbox e JOIN lab_order o ON o.id = e.lab_order_id WHERE o.site_id = $1"),
        // permissions
        Map.entry("groups", groupParts("(g.site_id = $1 OR g.site_id IS NULL)")),
        Map.entry("users", "SELECT 'group_member', m.id FROM group_member m JOIN lab_group g ON g.id = m.group_id WHERE g.site_id = $1 OR g.site_id IS NULL"),
        // inventory
        Map.entry("lot", "SELECT 'inventory_lot', $1::uuid UNION ALL SELECT 'inventory_transaction', id FROM inventory_transaction WHERE lot_id = $1"
            + " UNION ALL SELECT 'lot_component', id FROM lot_component WHERE lot_id = $1 UNION ALL SELECT 'supplier_coa', id FROM supplier_coa WHERE lot_id = $1"
            + " UNION ALL SELECT 'lot_analyte', id FROM lot_analyte WHERE lot_id = $1"),
        Map.entry("location", "SELECT 'storage_location', $1::uuid UNION ALL SELECT 'storage_location', id FROM storage_location WHERE parent_location_id = $1"),
        Map.entry("inventory", "SELECT 'inventory_lot', id FROM inventory_lot WHERE site_id = $1"
            + " UNION ALL SELECT 'inventory_transaction', t.id FROM inventory_transaction t JOIN inventory_lot l ON l.id = t.lot_id WHERE l.site_id = $1"),
        Map.entry("locations", "SELECT 'storage_location', id FROM storage_location WHERE site_id = $1"),
        Map.entry("samplestorage", "SELECT 'sample', s.id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = $1 AND s.storage_location_id IS NOT NULL"),
        // equipment
        Map.entry("equipment", "SELECT 'equipment', $1::uuid " + EQUIPMENT_PARTS.stream()
            .map(p -> "UNION ALL SELECT '" + p + "', id FROM " + p + " WHERE equipment_id = $1").collect(Collectors.joining(" "))),
        Map.entry("equipmentlist", "SELECT 'equipment', id FROM equipment WHERE site_id = $1 " + EQUIPMENT_PARTS.stream()
            .map(p -> "UNION ALL SELECT '" + p + "', x.id FROM " + p + " x JOIN equipment e ON e.id = x.equipment_id WHERE e.site_id = $1").collect(Collectors.joining(" "))),
        Map.entry("equipmentlists", "SELECT 'equipment_type', id FROM equipment_type WHERE site_id = $1 UNION ALL SELECT 'department', id FROM department WHERE site_id = $1"),
        // purchasing
        Map.entry("purchasing", "SELECT 'purchase_line', id FROM purchase_line WHERE site_id = $1 UNION ALL SELECT 'purchase_order', id FROM purchase_order WHERE site_id = $1"
            + " UNION ALL SELECT 'purchase_receipt', r.id FROM purchase_receipt r JOIN purchase_line l ON l.id = r.purchase_line_id WHERE l.site_id = $1"
            + " UNION ALL SELECT 'purchasing_setting', id FROM purchasing_setting WHERE site_id = $1"),
        Map.entry("purchaseline", "SELECT 'purchase_line', $1::uuid UNION ALL SELECT 'purchase_receipt', id FROM purchase_receipt WHERE purchase_line_id = $1"
            + " UNION ALL SELECT 'inventory_lot', id FROM inventory_lot WHERE purchase_line_id = $1"),
        Map.entry("purchaseorder", "SELECT 'purchase_order', $1::uuid UNION ALL SELECT 'purchase_line', id FROM purchase_line WHERE purchase_order_id = $1"),
        Map.entry("supplier", "SELECT 'supplier', $1::uuid UNION ALL SELECT 'vendor_qualification', id FROM vendor_qualification WHERE supplier_id = $1"
            + " UNION ALL SELECT 'vendor_promotion', id FROM vendor_promotion WHERE supplier_id = $1"
            + " UNION ALL SELECT 'vendor_document', d.id FROM vendor_document d LEFT JOIN vendor_qualification q ON q.id = d.qualification_id LEFT JOIN vendor_promotion p ON p.id = d.promotion_id"
            + " WHERE COALESCE(q.supplier_id, p.supplier_id) = $1"),
        Map.entry("vendors", "SELECT 'vendor_qualification', id FROM vendor_qualification WHERE site_id IS NULL OR site_id = $1"
            + " UNION ALL SELECT 'vendor_promotion', id FROM vendor_promotion WHERE site_id = $1 OR status = 'Proposed'"
            + " UNION ALL SELECT 'vendor_notice', id FROM vendor_notice WHERE site_id = $1 UNION ALL SELECT 'supply_scope', id FROM supply_scope"),
        Map.entry("riskclasses", "SELECT 'supplier_risk_class', id FROM supplier_risk_class WHERE site_id IS NULL OR site_id = $1"),
        // the Workflow Designer
        Map.entry("testdef", "SELECT 'test', $1::uuid UNION ALL SELECT 'test_version', id FROM test_version WHERE test_id = $1"
            + " UNION ALL SELECT 'test_catalog_entry', id FROM test_catalog_entry WHERE test_id = $1"
            + " UNION ALL SELECT 'test_version_analyte', a.id FROM test_version_analyte a JOIN test_version v ON v.id = a.test_version_id WHERE v.test_id = $1"
            + " UNION ALL SELECT 'workflow_step', s.id FROM workflow_step s JOIN test_version v ON v.id = s.test_version_id WHERE v.test_id = $1"
            + " UNION ALL SELECT 'workflow_step_equipment', e.id FROM workflow_step_equipment e JOIN workflow_step s ON s.id = e.step_id JOIN test_version v ON v.id = s.test_version_id WHERE v.test_id = $1"
            + " UNION ALL SELECT 'workflow_step_dependency', d.id FROM workflow_step_dependency d JOIN workflow_step s ON s.id = d.step_id JOIN test_version v ON v.id = s.test_version_id WHERE v.test_id = $1"),
        // testing
        Map.entry("batch", "SELECT 'test_batch', $1::uuid"
            + " UNION ALL SELECT 'batch_entry', id FROM batch_entry WHERE batch_id = $1"
            + " UNION ALL SELECT 'step_run', id FROM step_run WHERE batch_id = $1"
            + " UNION ALL SELECT 'entry_value', v.id FROM entry_value v JOIN step_run r ON r.id = v.step_run_id WHERE r.batch_id = $1"
            + " UNION ALL SELECT 'entry_material', m.id FROM entry_material m JOIN step_run r ON r.id = m.step_run_id WHERE r.batch_id = $1"
            + " UNION ALL SELECT 'entry_equipment', q.id FROM entry_equipment q JOIN step_run r ON r.id = q.step_run_id WHERE r.batch_id = $1"
            + " UNION ALL SELECT 'step_attachment', a.id FROM step_attachment a JOIN step_run r ON r.id = a.step_run_id WHERE r.batch_id = $1"
            + " UNION ALL SELECT 'reanalysis_request', x.id FROM reanalysis_request x JOIN step_run r ON r.id = x.step_run_id WHERE r.batch_id = $1"
            + " UNION ALL SELECT 'analytical_run', x.id FROM analytical_run x JOIN step_run r ON r.id = x.step_run_id WHERE r.batch_id = $1"
            + " UNION ALL SELECT 'reprep_request', p.id FROM reprep_request p JOIN batch_entry e ON e.id = p.origin_entry_id WHERE e.batch_id = $1 OR p.batch_id = $1"
            + " UNION ALL SELECT 'result_choice', id FROM result_choice WHERE batch_id = $1"
            + " UNION ALL SELECT 'qc_acceptance', id FROM qc_acceptance WHERE batch_id = $1"
            + " UNION ALL SELECT 'load_acceptance', id FROM load_acceptance WHERE batch_id = $1"
            + " UNION ALL SELECT 'test_result', id FROM test_result WHERE batch_id = $1"
            + " UNION ALL SELECT 'incubation_load', l.id FROM incubation_load l JOIN step_run r ON r.id = l.step_run_id WHERE r.batch_id = $1"
            + " UNION ALL SELECT 'split_request', id FROM split_request WHERE batch_id = $1"),
        Map.entry("batches", "SELECT 'test_batch', id FROM test_batch WHERE site_id = $1 AND NOT is_verification"),
        Map.entry("verification", "SELECT 'workflow_verification', $1::uuid UNION ALL SELECT 'verification_requirement', id FROM verification_requirement WHERE verification_id = $1"
            + " UNION ALL SELECT 'verification_check', id FROM verification_check WHERE verification_id = $1"
            + " UNION ALL SELECT 'verification_evidence', id FROM verification_evidence WHERE verification_id = $1"),
        // reports, OOS, quotes
        Map.entry("sample_coa", "SELECT 'coa', c.id FROM coa c WHERE c.sample_id = $1 UNION ALL SELECT 'coa_version', v.id FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = $1"
            + " UNION ALL SELECT 'coa_note', n.id FROM coa_note n WHERE n.sample_id = $1"
            + " UNION ALL SELECT 'result_finalization', f.id FROM result_finalization f JOIN requested_test rt ON rt.id = f.requested_test_id WHERE rt.sample_id = $1"),
        Map.entry("oos", "SELECT 'oos_investigation', $1::uuid UNION ALL SELECT 'oos_client_response', id FROM oos_client_response WHERE oos_id = $1"
            + " UNION ALL SELECT 'requested_test', id FROM requested_test WHERE oos_investigation_id = $1"),
        Map.entry("quote", "SELECT 'project', $1::uuid UNION ALL SELECT 'project_version', id FROM project_version WHERE project_id = $1"
            + " UNION ALL SELECT 'quoted_test_configuration', q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id WHERE pv.project_id = $1"
            + " UNION ALL SELECT 'quote_rush_term', r.id FROM quote_rush_term r JOIN project_version pv ON pv.id = r.project_version_id WHERE pv.project_id = $1"),
        // stability
        Map.entry("stability_study", "SELECT 'stability_study', $1::uuid UNION ALL SELECT 'stability_storage', id FROM stability_storage WHERE study_id = $1"
            + " UNION ALL SELECT 'stability_pull', id FROM stability_pull WHERE study_id = $1"
            + " UNION ALL SELECT 'stability_amendment', id FROM stability_amendment WHERE study_id = $1"
            + " UNION ALL SELECT 'stability_excursion_assessment', id FROM stability_excursion_assessment WHERE study_id = $1"
            + " UNION ALL SELECT 'stability_report', id FROM stability_report WHERE study_id = $1"),
        Map.entry("stability_quote", "SELECT 'project', $1::uuid UNION ALL SELECT 'project_version', id FROM project_version WHERE project_id = $1"
            + " UNION ALL SELECT 'quoted_test_configuration', q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id WHERE pv.project_id = $1"
            + " UNION ALL SELECT 'stability_plan', x.id FROM stability_plan x JOIN project_version pv ON pv.id = x.project_version_id WHERE pv.project_id = $1"
            + " UNION ALL SELECT 'stability_version_condition', x.id FROM stability_version_condition x JOIN project_version pv ON pv.id = x.project_version_id WHERE pv.project_id = $1"
            + " UNION ALL SELECT 'stability_timepoint', x.id FROM stability_timepoint x JOIN project_version pv ON pv.id = x.project_version_id WHERE pv.project_id = $1"
            + " UNION ALL SELECT 'stability_cell', x.id FROM stability_cell x JOIN project_version pv ON pv.id = x.project_version_id WHERE pv.project_id = $1"),
        // logbooks, invoicing, trending, packages, training, charges
        Map.entry("logbook", "SELECT 'logbook', $1::uuid UNION ALL SELECT 'logbook_version', id FROM logbook_version WHERE logbook_id = $1"
            + " UNION ALL SELECT 'logbook_field', f.id FROM logbook_field f JOIN logbook_version v ON v.id = f.version_id WHERE v.logbook_id = $1"
            + " UNION ALL SELECT 'logbook_equipment', id FROM logbook_equipment WHERE logbook_id = $1 UNION ALL SELECT 'logbook_review', id FROM logbook_review WHERE logbook_id = $1"),
        Map.entry("logbook_entry", "SELECT 'logbook_entry', $1::uuid"),
        Map.entry("invoice", "SELECT 'invoice', $1::uuid UNION ALL SELECT 'invoice_line', id FROM invoice_line WHERE invoice_id = $1"
            + " UNION ALL SELECT 'accounting_push', id FROM accounting_push WHERE invoice_id = $1"
            + " UNION ALL SELECT 'invoice_correction', id FROM invoice_correction WHERE invoice_id = $1"
            + " UNION ALL SELECT 'order_charge', order_charge_id FROM invoice_line WHERE invoice_id = $1 AND order_charge_id IS NOT NULL"),
        Map.entry("trend_chart", "SELECT 'trend_chart', $1::uuid UNION ALL SELECT 'trend_signal_review', id FROM trend_signal_review WHERE chart_id = $1"),
        Map.entry("test_package", "SELECT 'test_package', $1::uuid UNION ALL SELECT 'test_package_item', id FROM test_package_item WHERE package_id = $1"
            + " UNION ALL SELECT 'test_package_analyte', a.id FROM test_package_analyte a JOIN test_package_item i ON i.id = a.item_id WHERE i.package_id = $1"),
        Map.entry("training_person", "SELECT 'analyst_qualification', id FROM analyst_qualification WHERE user_id = $1 UNION ALL SELECT 'competency_attempt', id FROM competency_attempt WHERE user_id = $1"
            + " UNION ALL SELECT 'competency_evidence', e.id FROM competency_evidence e JOIN competency_attempt a ON a.id = e.attempt_id WHERE a.user_id = $1"),
        Map.entry("competency", "SELECT 'competency_attempt', $1::uuid UNION ALL SELECT 'competency_evidence', id FROM competency_evidence WHERE attempt_id = $1"
            + " UNION ALL SELECT 'analyst_qualification', id FROM analyst_qualification WHERE attempt_id = $1"),
        Map.entry("charges", "SELECT 'order_charge', id FROM order_charge WHERE lab_order_id = $1"));

    public static final Map<String, List<String>> LISTS = Map.ofEntries(
        Map.entry("clients", List.of("client", "client_contact", "client_license")), Map.entry("licenses", List.of("client_license")),
        Map.entry("contacts", List.of("contact")), Map.entry("analytes", List.of("analyte")), Map.entry("rush", List.of("rush_fee_schedule", "rush_fee_tier")),
        Map.entry("catalog", List.of("test", "test_version", "test_catalog_entry", "test_analyte_price", "test_rush_approval")),
        Map.entry("projects", List.of("project", "project_version", "quoted_test_configuration", "quote_rush_term", "quoted_analyte_selection")),
        Map.entry("sites", List.of("lab_site", "site_holiday")), Map.entry("matrices", List.of("matrix", "product_category")),
        Map.entry("qa_testing", List.of("qa_testing_default")), Map.entry("units", List.of("unit_of_measure")), Map.entry("conversions", List.of("unit_conversion")),
        Map.entry("chemicals", List.of("chemical")), Map.entry("suppliers", List.of("supplier")), Map.entry("thresholds", List.of("threshold_rule")),
        Map.entry("methods", List.of("test", "test_version", "test_version_analyte", "workflow_step", "workflow_step_equipment", "workflow_step_dependency")),
        Map.entry("sops", List.of("method")),
        Map.entry("finalization", List.of("result_finalization", "coa_version", "coa_note", "finalization_claim", "finalization_claim_test")),
        Map.entry("templates", List.of("email_template")), Map.entry("compliance", List.of("compliance_category")),
        Map.entry("oos_list", List.of("oos_investigation", "oos_client_response")), Map.entry("oos_config", List.of("oos_checklist_item", "oos_procedure_setting")),
        Map.entry("quotes", List.of("project", "project_version", "quoted_test_configuration", "email_outbox")),
        Map.entry("report_templates", List.of("report_template")), Map.entry("lab_media", List.of("site_media", "system_setting")),
        Map.entry("stability_setup", List.of("stability_condition", "stability_chamber", "stability_rack")),
        Map.entry("stability_studies", List.of("stability_study", "stability_storage", "stability_pull", "stability_amendment", "stability_excursion_assessment", "stability_report")),
        Map.entry("stability_quotes", List.of("project", "stability_plan", "stability_timepoint", "stability_cell")),
        Map.entry("logbooks", List.of("logbook", "logbook_version", "logbook_field", "logbook_equipment", "logbook_review", "logbook_entry", "equipment_flag_acceptance")),
        Map.entry("billing", List.of("invoice", "invoice_line", "accounting_push", "accounting_connection", "accounting_customer", "invoice_correction", "order_charge")),
        Map.entry("dashboard_widgets", List.of("group_widget")), Map.entry("finance", List.of("finance_week", "finance_plan")),
        Map.entry("trending", List.of("trend_chart", "trend_signal_review")), Map.entry("sensors", List.of("sensor_connection", "sensor_link")),
        Map.entry("packages", List.of("test_package", "test_package_item", "test_package_analyte")), Map.entry("price_changes", List.of("catalog_price_change")),
        Map.entry("training", List.of("training_rule", "analyst_qualification", "competency_attempt")), Map.entry("waste", List.of("waste_classification")),
        Map.entry("charges", List.of("charge_item", "quoted_charge", "order_charge")),
        Map.entry("service_lines", List.of("service_line", "service_line_type", "client_service_line")),
        Map.entry("reasons", List.of("reason_code")));

    /** List pages scoped to the current lab: $1 is the lab, not a record. */
    public static final Set<String> SITE_KINDS = Set.of("orders", "intake", "outbox", "groups", "users", "inventory", "locations", "samplestorage",
        "equipmentlist", "equipmentlists", "purchasing", "riskclasses", "vendors", "batches");

    /** A record whose lab must be one the person can open before its audit trail is shown: SQL giving its site_id, and the refusal. */
    public record RecordLab(String sql, String notFound) {}

    public static final Map<String, RecordLab> RECORD_LABS = Map.ofEntries(
        Map.entry("equipment", new RecordLab("SELECT site_id FROM equipment WHERE id = ?::uuid", "Equipment not found")),
        Map.entry("lot", new RecordLab("SELECT site_id FROM inventory_lot WHERE id = ?::uuid", "Lot not found")),
        Map.entry("location", new RecordLab("SELECT site_id FROM storage_location WHERE id = ?::uuid", "Storage location not found")),
        Map.entry("purchaseline", new RecordLab("SELECT site_id FROM purchase_line_view WHERE id = ?::uuid", "Request not found")),
        Map.entry("purchaseorder", new RecordLab("SELECT site_id FROM purchase_order WHERE id = ?::uuid", "Order not found")),
        Map.entry("testdef", new RecordLab("SELECT site_id FROM test_design_view WHERE id = ?::uuid", "Test not found")),
        Map.entry("batch", new RecordLab("SELECT site_id FROM test_batch_view WHERE id = ?::uuid", "Batch not found")),
        Map.entry("verification", new RecordLab("SELECT site_id FROM workflow_verification WHERE id = ?::uuid", "Verification not found")),
        Map.entry("sample_coa", new RecordLab("SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = ?::uuid", "Sample not found")),
        Map.entry("oos", new RecordLab("SELECT site_id FROM oos_investigation WHERE id = ?::uuid", "OOS investigation not found")),
        Map.entry("stability_study", new RecordLab("SELECT site_id FROM stability_study WHERE id = ?::uuid", "Study not found")),
        Map.entry("logbook", new RecordLab("SELECT site_id FROM logbook_view WHERE id = ?::uuid", "Logbook not found")),
        Map.entry("logbook_entry", new RecordLab("SELECT site_id FROM logbook_entry_view WHERE id = ?::uuid", "Entry not found")),
        Map.entry("invoice", new RecordLab("SELECT site_id FROM invoice_view WHERE id = ?::uuid", "Invoice not found")),
        Map.entry("trend_chart", new RecordLab("SELECT site_id FROM trend_chart WHERE id = ?::uuid", "Chart not found")),
        Map.entry("competency", new RecordLab("SELECT site_id, user_id FROM competency_attempt_view WHERE id = ?::uuid", "Attempt not found")));

    /** Records that may belong to no lab (a test made before the designer is shared): no lab check then. */
    public static final Set<String> SITE_OPTIONAL = Set.of("testdef");
}
