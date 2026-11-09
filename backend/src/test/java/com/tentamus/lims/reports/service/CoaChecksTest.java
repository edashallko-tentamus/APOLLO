package com.tentamus.lims.reports.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.reports.domain.CoaContent;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The COA's release check and its read-back, with the database's answers given by a stand-in. */
class CoaChecksTest {
    private static final String RT = "11111111-1111-1111-1111-111111111111", RES = "22222222-2222-2222-2222-222222222222", S = "33333333-3333-3333-3333-333333333333";

    /** A stand-in database: each query answered by the first canned row whose key is in its SQL (no row otherwise). */
    private static Db db(Map<String, List<Map<String, Object>>> answers) {
        return new Db(null, null) {
            @Override
            public List<Map<String, Object>> rows(String sql, Object... params) {
                for (Map.Entry<String, List<Map<String, Object>>> e : answers.entrySet()) if (sql.contains(e.getKey())) return e.getValue();
                return List.of();
            }
        };
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private static CoaContent content(String reported, String conformance) {
        Map<String, Object> r = m("id", RES, "analyte_id", "a1", "analyte", "Vitamin C", "label", "", "final_label", "", "reported", reported, "value_num", "92.345", "value_text", null,
            "unit", "%", "spec", "≥ 90 %", "spec_min", "90", "spec_max", null, "spec_text", null, "spec_unit", "%", "spec_source", "Client", "conformance", conformance,
            "loq", null, "approved_at", "2026-10-14T10:00:00.000Z", "rounding_mode", null, "rounding_digits", null, "lod", null, "uncertainty", "", "per_serving", "",
            "per_package", "", "spec_basis", "", "basis_value", null, "basis_unit", null, "notes", List.of());
        Map<String, Object> t = m("requested_test_id", RT, "template_id", null, "test_name", "Vitamin C assay", "test_code", "VC", "version_no", 1, "method", "",
            "finalized_now", true, "tested_from", null, "tested_to", null, "results", new ArrayList<>(List.of(r)), "per_serving", false, "per_package", false, "notes", List.of());
        Map<String, Object> out = m("coa_code", "COA-VC1", "version_no", 1, "verify_code", "ABCD-EFGH-JKLM", "report_id", "VC1-R1", "verify_url", "http://x/verify.html?c=ABCD-EFGH-JKLM",
            "supersedes", null, "lab", m("name", "CFL", "code", "CFL", "address", "", "accreditation", ""), "client", m("name", "Acme", "address", "", "contact", ""),
            "order", m("order_code", "PO-1", "po_number", "", "license", ""), "sample", m("id", S, "sample_code", "VC1", "client_sample_id", "Lot A", "lot", "", "compliance_category", "Dietary supplement", "serving", ""),
            "tests", List.of(t), "pending", List.of(), "sections", List.of(), "photos", List.of(), "notes", List.of(), "decision_rule", CoaContent.DECISION_RULE,
            "authorized", m("by", "Pat Manager", "title", "Project Manager", "at", "2026-10-15T10:00:00.000Z", "signature", null, "has_signature", true),
            "time_zone", "America/Los_Angeles", "client_on_hold", false, "allow_partial", true, "is_gmp", false);
        return new CoaContent(out, null, null, new HashMap<>(), new HashMap<>());
    }

    private static Db quiet() {
        Map<String, List<Map<String, Object>>> a = new LinkedHashMap<>();
        a.put("FROM specification", List.of(m("min", "90", "max", null, "text_value", null, "unit", "%")));
        a.put("FROM audit_log a JOIN specification", List.of(m("at", null)));
        a.put("tv.nd_below_lod", List.of(m("rounding_mode", "Significant figures", "rounding_digits", 3, "nd_below_lod", false)));
        a.put("oos_release_problem", List.of(m("p", null)));
        a.put("logbook_release_problem", List.of(m("p", null)));
        a.put("oos_awaiting_phase2", List.of(m("w", false)));
        a.put("bool_or", List.of(m("before_login", false, "future", false)));
        return db(a);
    }

    private static Map<String, String> levels(List<Map<String, Object>> checks) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Map<String, Object> k : checks) out.put((String) k.get("code"), (String) k.get("level"));
        return out;
    }

    @Test
    void aCleanCoaPasses() {
        List<Map<String, Object>> k = CoaChecks.checks(quiet(), content("92.3", "Conforms"), "u1", new CoaChecks.ReadBack(10, List.of()));
        Map<String, String> l = levels(k);
        assertEquals("Pass", l.get("values"));
        assertEquals("Pass", l.get("spec"));
        assertEquals("Pass", l.get("conformance"));
        assertEquals(null, l.get("rounding"));
        assertEquals("Pass", l.get("independence"));
        assertEquals("Pass", l.get("hold"));
        assertEquals("10 values read back from the rendered COA", k.get(0).get("detail"));
    }

    @Test
    void aWrongRoundingAndConformanceBlock() {
        List<Map<String, Object>> k = CoaChecks.checks(quiet(), content("92.4", "Does not conform"), "u1", null);
        Map<String, String> l = levels(k);
        assertEquals("Block", l.get("rounding"));
        assertEquals("Block", l.get("conformance"));
        assertTrue(k.stream().anyMatch(x -> "Vitamin C: reported 92.4, worked out 92.3".equals(x.get("detail"))));
        assertTrue(k.stream().anyMatch(x -> "Vitamin C: stored Does not conform, worked out Conforms".equals(x.get("detail"))));
        assertEquals(null, l.get("values"));
    }

    @Test
    void theRenderedCellsAreCompared() {
        CoaContent c = content("92.3", "Conforms");
        Map<String, String> exp = c.expectedCells();
        assertEquals("VC1-R1", exp.get("h:report_id"));
        assertEquals("1", exp.get("h:version_no"));
        assertEquals("92.3", exp.get("r:" + RES + ":reported"));
        assertEquals("Conforms", exp.get("r:" + RES + ":conf"));
        String html = CoaDocument.html(c);
        assertTrue(html.contains("<td class=\"r b\" data-check=\"r:" + RES + ":reported\">92.3</td>"), html);
        assertTrue(html.contains("<span data-check=\"h:report_id\">VC1-R1</span>"));
        List<String[]> seen = List.of(new String[] {"h:report_id", "VC1-R1"}, new String[] {"r:" + RES + ":reported", "92.4"});
        List<String> mis = CoaContent.mismatches(exp, seen);
        assertTrue(mis.contains("r:" + RES + ":reported: the PDF shows \"92.4\", the record \"92.3\""));
        assertTrue(mis.contains("h:version_no: not on the PDF"));
    }
}
