package com.tentamus.lims.inventory.bulk;

import static com.tentamus.lims.inventory.bulk.BulkColumn.looked;
import static com.tentamus.lims.inventory.bulk.BulkColumn.of;
import static com.tentamus.lims.inventory.bulk.BulkColumn.readOnly;
import static com.tentamus.lims.inventory.bulk.BulkColumn.text;

import com.tentamus.lims.core.excel.Js;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * What each list exports and accepts back (the Node backend's bulk.js KINDS): the inventory tabs and the Units lists.
 * The equipment list's upload belongs to the Equipment feature and stays in the Node backend for now.
 */
public final class BulkKinds {
    private BulkKinds() {}

    // the export helpers of bulk.js: s(), d10(), num(), ARR()
    static String s(Object v) { return Js.string(v); }

    static String d10(Object v) {
        if (v == null || Boolean.FALSE.equals(v) || "".equals(v) || (v instanceof Number n && n.doubleValue() == 0)) return "";
        String t = Js.string(v);
        return t.substring(0, Math.min(10, t.length()));
    }

    static Object num(Object v) { return v == null || "".equals(v) ? "" : (Object) Js.toNumber(v); }

    @SuppressWarnings("unchecked")
    static List<String> arr(Object v) {
        if (v instanceof List<?> l) return (List<String>) l;
        if (v == null || "".equals(v)) return List.of();
        List<String> out = new ArrayList<>();
        for (String x : v.toString().replaceAll("^\\{|\\}$", "").split(",", -1)) out.add(x.replaceAll("^\"|\"$", ""));
        return out;
    }

    private static Object yesNo(Object v) { return Boolean.TRUE.equals(v) ? "Yes" : "No"; }

    public static final Map<String, BulkKind> KINDS = Map.of(
        "lots", new BulkKind("Inventory", "inventory_lot", true, "lot_code", true, true,
            "SELECT * FROM inventory_lot_view WHERE site_id = ?::uuid ORDER BY material, lot_code", List.of(
            readOnly("ID", "lot_code", 12, null),
            text("Name", "item_name", 34),
            looked("list", "Types", "chemical_types", "chemicalTypes", 26, r -> String.join(", ", arr(r.get("chemical_types")))),
            looked("choice", "Solid or liquid", "physical_form", "forms", 14, null),
            of("analytes", "Analytes", "__analytes", 34, r -> s(r.get("analytes_text"))),
            text("Lot #", "manufacturer_lot", 14),
            of("number", "Concentration", "concentration", 13, r -> num(r.get("concentration"))),
            text("Concentration unit", "concentration_unit", 14),
            of("number", "Purity %", "purity_pct", 9, r -> num(r.get("purity_pct"))),
            text("CAS", "cas_number", 12),
            looked("ref", "Vendor", "supplier_id", "suppliers", 24, r -> s(r.get("supplier_name"))),
            looked("ref", "Manufacturer", "manufacturer_id", "suppliers", 24, r -> s(r.get("manufacturer_name"))),
            text("Catalog #", "catalog_number", 14),
            of("number", "Quantity received", "quantity_received", 10, r -> num(r.get("quantity_received"))),
            text("Unit", "unit", 7),
            of("date", "Received date", "received_date", 12, r -> d10(r.get("received_date"))),
            of("date", "Expiration date", "expiration_date", 12, r -> d10(r.get("expiration_date"))),
            of("date", "Retest date", "retest_date", 12, r -> d10(r.get("retest_date"))),
            of("date", "Opened date", "opened_date", 12, r -> d10(r.get("opened_date"))),
            looked("ref", "Storage location", "storage_location_id", "locations", 14, r -> s(r.get("location_code"))),
            looked("choice", "Storage condition", "storage_condition", "conditions", 22, null),
            looked("choice", "Status", "status", "lotStatuses", 10, null),
            text("Notes", "notes", 30),
            readOnly("On hand", null, 9, r -> num(r.get("on_hand"))),
            readOnly("Purchase status", null, 13, r -> s(r.get("receipt_status"))),
            readOnly("Date made", null, 12, r -> d10(r.get("date_made")))), "Inventory"),
        "samplestorage", new BulkKind("Sample storage", "sample", true, "sample_code", false, false,
            "SELECT * FROM sample_storage_view WHERE site_id = ?::uuid AND status = 'Logged' ORDER BY sample_code", List.of(
            readOnly("Sample ID", "sample_code", 14, null),
            readOnly("Client sample ID", null, 16, r -> s(r.get("client_sample_id"))),
            readOnly("Description", null, 26, r -> s(r.get("description"))),
            readOnly("Client", null, 22, r -> s(r.get("client_name"))),
            readOnly("Order", null, 11, r -> s(r.get("order_code"))),
            readOnly("Received", null, 10, r -> r.get("quantity_received") == null ? "" : Js.number(Js.toNumber(r.get("quantity_received"))) + " " + s(r.get("quantity_unit"))),
            looked("ref", "Storage location", "storage_location_id", "sampleLocations", 14, r -> s(r.get("location_code"))),
            looked("choice", "Storage condition", "storage_condition", "conditions", 22, null),
            of("number", "Retained quantity", "retained_quantity", 10, r -> num(r.get("retained_quantity"))),
            text("Retained unit", "retained_unit", 8)), "Inventory"),
        "suppliers", new BulkKind("Suppliers and manufacturers", "supplier", false, "supplier_code", true, true,
            "SELECT * FROM supplier ORDER BY lower(supplier_name)", List.of(
            readOnly("Code", "supplier_code", 10, null),
            text("Name", "supplier_name", 32),
            looked("choice", "Type", "supplier_type", "supplierTypes", 24, null),
            text("Website", "website", 26), text("Email", "email", 28), text("Phone", "phone", 14), text("Notes", "notes", 26),
            looked("choice", "Status", "status", "activeInactive", 10, null)), "Inventory"),
        "locations", new BulkKind("Storage locations", "storage_location", true, "location_code", true, false,
            "SELECT l.*, p.location_code AS parent_code FROM storage_location l LEFT JOIN storage_location p ON p.id = l.parent_location_id WHERE l.site_id = ?::uuid ORDER BY location_path(l.id)", List.of(
            text("Code", "location_code", 14),
            text("Name", "location_name", 26),
            looked("choice", "Type", "location_type", "locationTypes", 12, null),
            looked("ref", "Inside", "parent_location_id", "locations", 12, r -> s(r.get("parent_code"))),
            looked("list", "Conditions it provides", "supported_conditions", "conditions", 40, r -> String.join(", ", arr(r.get("supported_conditions")))),
            of("bool", "Holds samples", "holds_samples", 9, r -> yesNo(r.get("holds_samples"))),
            looked("choice", "Status", "status", "activeInactive", 10, null)), "Inventory"),
        "thresholds", new BulkKind("Warning rules", "threshold_rule", false, "id", true, true,
            "SELECT r.*, s.site_code FROM threshold_rule r LEFT JOIN lab_site s ON s.id = r.site_id ORDER BY r.subject, r.rule_name", List.of(
            readOnly("Record ID", "id", 38, null),
            text("Rule", "rule_name", 44),
            looked("choice", "Watches", "subject", "subjects", 14, null),
            looked("choice", "Type", "rule_type", "ruleTypes", 20, null),
            of("number", "Value", "value", 8, r -> num(r.get("value"))),
            looked("ref", "Lab", "site_id", "sites", 8, r -> s(r.get("site_code"))),
            looked("choice", "Status", "status", "activeInactive", 10, null)), "Inventory"),
        "units", new BulkKind("Units", "unit_of_measure", false, "unit_code", true, false,
            "SELECT * FROM unit_of_measure ORDER BY sort_order, unit_code", List.of(
            text("Code", "unit_code", 10),
            text("Name", "unit_name", 34),
            looked("choice", "Measures", "dimension", "dimensions", 16, null),
            of("number", "Order", "sort_order", 7, r -> num(r.get("sort_order"))),
            looked("choice", "Status", "status", "activeInactive", 10, null)), "Admin"),
        "conversions", new BulkKind("Unit conversions", "unit_conversion", false, "id", true, true, """
            SELECT c.*, f.unit_code AS from_code, t.unit_code AS to_code FROM unit_conversion c JOIN unit_of_measure f ON f.id = c.from_unit_id
              JOIN unit_of_measure t ON t.id = c.to_unit_id ORDER BY f.sort_order, f.unit_code, t.unit_code""", List.of(
            readOnly("Record ID", "id", 38, null),
            looked("ref", "From", "from_unit_id", "units", 10, r -> s(r.get("from_code"))),
            looked("ref", "To", "to_unit_id", "units", 10, r -> s(r.get("to_code"))),
            of("number", "Factor (1 From = factor To)", "factor", 16, r -> num(r.get("factor"))),
            looked("choice", "Applies to", "applies_to", "appliesTo", 10, null),
            text("Assumption", "assumption", 44),
            looked("choice", "Status", "status", "activeInactive", 10, null)), "Admin"));
}
