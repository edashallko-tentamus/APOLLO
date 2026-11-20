package com.tentamus.lims.labsetup.service;

import static com.tentamus.lims.core.web.Answers.map;

import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.invoicing.service.InvoiceDocument;
import com.tentamus.lims.reports.domain.CoaContent;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Fictional data a template preview is drawn with: the lab's own name and logo, nothing of any client's. */
final class Specimen {
    private Specimen() {}

    static CoaContent coa(Map<String, Object> lab, String logo, Map<String, Object> template, Map<String, Object> design) {
        String at = "2026-11-19T17:00:00.000Z";
        List<Object> results = List.of(
            map("id", "r1", "analyte", "Lead", "reported", "0.012", "unit", "µg/g", "loq", "0.005", "spec", "≤ 0.5", "conformance", "Conforms", "spec_source", "Client", "notes", List.of(1)),
            map("id", "r2", "analyte", "Cadmium", "reported", "< LOQ", "unit", "µg/g", "loq", "0.005", "spec", "≤ 0.3", "conformance", "Conforms", "notes", List.of()),
            map("id", "r3", "analyte", "Arsenic", "reported", "0.041", "unit", "µg/g", "loq", "0.010", "spec", "≤ 1.5", "conformance", "Conforms", "notes", List.of()),
            map("id", "r4", "analyte", "Mercury", "reported", "0.62", "unit", "µg/g", "loq", "0.010", "spec", "≤ 0.5", "conformance", "Does not conform", "notes", List.of()));
        Map<String, Object> test = map("requested_test_id", "t1", "test_name", "Heavy Metals by ICP-MS (specimen)", "method", "USP <233>", "version_no", 2,
            "tested_from", "2026-11-17", "tested_to", "2026-11-18", "notes", List.of(), "results", results);
        Map<String, Object> out = new HashMap<>();
        out.put("time_zone", "America/Los_Angeles");
        out.put("lab", map("name", lab.get("site_name"), "address", Js.orBlank(lab.get("address")), "accreditation", Js.orBlank(lab.get("accreditation_statement"))));
        out.put("client", map("name", "Example Client (specimen)", "address", "1 Example Way, Anytown", "contact", "Pat Example"));
        out.put("order", map("order_code", "LO-000000", "po_number", "PO-0000", "license", ""));
        out.put("sample", map("sample_code", "SPEC000000001", "client_sample_id", "LOT-A1", "description", "Capsules, 60 count", "matrix", "Dietary supplement",
            "product", "Example product", "lot", "A1", "batch", "", "metrc_id", "", "compliance_category", "", "serving", "", "received", at, "condition", "Intact"));
        out.put("authorized", map("by", "Specimen Signer", "title", "QA Reviewer", "at", at, "signature", null));
        out.put("report_id", "SPEC000000001-R1");
        out.put("version_no", 1);
        out.put("verify_code", "PREV-IEWX-XXXX");
        out.put("verify_url", "https://example.invalid/verify.html?c=PREV-IEWX-XXXX");
        out.put("tests", List.of(test));
        out.put("pending", List.of(map("requested_test_id", "t2", "test_name", "Microbial count (specimen)")));
        out.put("notes", List.of(map("n", 1, "text", "A note on a result prints here.", "on", "Lead, Heavy Metals by ICP-MS (specimen)")));
        out.put("decision_rule", CoaContent.DECISION_RULE);
        out.put("photos", List.of());
        out.put("sections", List.of(map("template", map("id", template.get("id"), "name", template.get("template_name"), "design", design),
            "tests", List.of("t1"), "pending", List.of("t2"))));
        return new CoaContent(out, logo, null, Map.of(), Map.of());
    }

    static InvoiceDocument.Data invoice(Map<String, Object> lab) {
        Map<String, Object> inv = new HashMap<>(map("status", "Draft", "kind", "Invoice", "draft_code", "DR-PREVIEW", "site_name", lab.get("site_name"),
            "site_address", lab.get("address"), "order_code", "LO-000000", "legal_name", "Example Client (specimen)", "billing_address", "1 Example Way, Anytown",
            "client_terms", 30, "list_total", 450, "discount_total", 45, "rush_total", 60, "total", 465, "po_number", "PO-0000"));
        List<Map<String, Object>> lines = List.of(
            map("sample_code", "SPEC000000001", "test_name", "Heavy Metals by ICP-MS (specimen)", "completed_on", "2026-11-18", "list_price", 300, "price", 270, "rush_fee", 60,
                "rush_billed", "3 day", "amount", 330),
            map("sample_code", "SPEC000000001", "test_name", "Microbial count (specimen)", "completed_on", "2026-11-18", "list_price", 150, "price", 135, "rush_fee", 0, "amount", 135));
        return new InvoiceDocument.Data(inv, lines);
    }
}
