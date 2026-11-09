package com.tentamus.lims.methods.domain;

import com.tentamus.lims.core.calc.Formula;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The Workflow Designer rules moved out of the database in migration 066 (they were checked by test_011, test_012, test_021a, test_025, test_026, test_028 and test_034). */
class DesignerRulesTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final VersionAnalyte.Units UNITS = new VersionAnalyte.Units(Map.of("mg/kg", "mg/kg", "µg/l", "µg/L"), "Mass, Volume");

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    private static JsonNode j(String s) {
        try { return JSON.readTree(s); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static TestVersion version(String status) {
        return new TestVersion("v1", "t1", 1, status, null, null, "Significant figures", 3, false, false, null, null);
    }

    @Test
    void formulaCheckAndTokens() {
        assertNull(Formula.of("max({a.b}, 2) * log10(100) / (1 + {c.d})").problem());
        assertTrue(Formula.of("{a.b} +").problem().contains("ends with an operator"));
        assertTrue(Formula.of("(2 * 3").problem().contains("not closed"));
        assertTrue(Formula.of("foo(2)").problem().contains("not a step token or a known function"));
        assertTrue(Formula.of("2 3").problem().contains("out of place"));
        assertTrue(Formula.of("1, 2").problem().contains("comma"));
        assertEquals("The formula is empty", Formula.of("").problem());
        assertTrue(Formula.of("1; DROP TABLE test").problem().contains("out of place"));
        assertEquals(List.of("a.b", "c.d"), Formula.of("{c.d} + {a.b} * {c.d}").tokens());
    }

    @Test
    void testsStayInTheirLabWithTheirLabsDepartments() {
        TestDefinition t = new TestDefinition("t1", "T-1", "WD Metals", "CFL", null, "Active");
        assertEquals("The department must be one of the test's own lab's departments", refusal(() -> TestDefinition.checked(t, m("department_id", "d"), "TPS")));
        assertEquals("A test cannot move to another lab; copy it to that lab instead", refusal(() -> TestDefinition.checked(t, m("site_id", "TPS"), null)));
        assertNull(refusal(() -> TestDefinition.checked(new TestDefinition("t", "T", "x", null, null, "Active"), m("site_id", "CFL"), null)));   // a shared test gets a lab once
        assertEquals("WD Metals", TestDefinition.checked(t, m("test_name", " WD Metals "), null).get("test_name"));
        assertEquals("A method cannot move to another lab (copy the test instead)",
            refusal(() -> SopMethod.checked(new SopMethod("m", "MTH-1", "x", "CFL", null, null, "Active"), m("site_id", "TPS"))));
        assertNull(SopMethod.checked(null, m("method_name", " ICP ", "sop_code", "  ", "site_id", "CFL")).get("sop_code"));
    }

    @Test
    void versionsChangeOnlyAsDraftsAndBecomeEffectiveOnlyByApproval() {
        assertEquals("Version 1 is Effective and cannot be changed. Start a new version to make changes.", refusal(() -> version("Effective").assertEditable()));
        assertEquals("A version becomes Effective only when it is approved (signed, by someone who did not work on it)",
            refusal(() -> version("Draft").checkedSettings(m("status", "Effective"), null, "CFL", null)));
        assertEquals("The method must belong to the test's own lab", refusal(() -> version("Draft").checkedSettings(m("method_id", "m"), "TPS", "CFL", null)));
        assertEquals("Use at least 1 significant figure.", refusal(() -> version("Draft").checkedSettings(m("rounding_digits", 0), null, "CFL", null)));
        assertEquals("Report template RT TPS only belongs to another lab",
            refusal(() -> version("Draft").checkedSettings(m("report_template_id", "r"), null, "CFL", new TestVersion.Template("r", "RT TPS only", "TPS", "Active"))));
        assertEquals("Report template Old is retired",
            refusal(() -> version("Draft").checkedSettings(m("report_template_id", "r"), null, "CFL", new TestVersion.Template("r", "Old", null, "Retired"))));
    }

    @Test
    void approval() {
        List<Problem> clean = List.of(Problem.warning(null, "Not priced yet"));
        assertTrue(refusal(() -> version("Draft").approve("u", List.of(Problem.error(null, "Add the workflow steps (tab 3)")), Set.of(), false, false))
            .startsWith("Version 1 has 1 problem(s) to fix"));
        assertEquals("You worked on this version, so someone else must approve it", refusal(() -> version("Draft").approve("u", clean, Set.of("u"), false, false)));
        assertTrue(refusal(() -> version("Draft").approve("u", clean, Set.of("a"), true, false)).contains("needs a passing workflow verification"));
        assertEquals("Version 1 is already Effective", refusal(() -> version("Effective").approve("u", clean, Set.of(), false, false)));
        assertEquals("Effective", version("Draft").approve("u", clean, Set.of("a"), true, true).status());
        assertEquals("Version 2 is already a Draft: continue that one",
            refusal(() -> TestVersion.assertNoDraft(List.of(version("Effective"), new TestVersion("v2", "t1", 2, "Draft", null, null, null, 3, false, false, null, null)))));
        TestVersion eff = version("Effective"), later = new TestVersion("v3", "t1", 3, "Superseded", null, null, null, 3, false, false, null, null);
        assertEquals(eff, TestVersion.sourceOf(List.of(later, eff)));
    }

    @Test
    void analytes() {
        assertEquals("mg/kg", VersionAnalyte.checked(null, m("analyte_id", "a", "reporting_unit", "MG/KG"), true, UNITS).get("reporting_unit"));
        assertTrue(refusal(() -> VersionAnalyte.checked(null, m("analyte_id", "a", "reporting_unit", "furlongs"), true, UNITS)).contains("Units list"));
        assertEquals("The LOD cannot be above the LOQ.", refusal(() -> VersionAnalyte.checked(m("analyte_id", "a", "loq", new BigDecimal("0.010")), m("lod", 0.02), true, UNITS)));
        assertEquals("That analyte is retired; pick an active one", refusal(() -> VersionAnalyte.checked(null, m("analyte_id", "a"), false, UNITS)));
        assertEquals("Remove the analyte (Inactive) and add the other one instead", refusal(() -> VersionAnalyte.checked(m("analyte_id", "a"), m("analyte_id", "b"), true, UNITS)));
        assertEquals(List.of("ND", "ND*", "D*", "D"), VersionAnalyte.checked(m("analyte_id", "a"), m("result_values", List.of(" ND ", "ND*", "D*", "D", "ND")), true, UNITS).get("result_values"));
        assertEquals(List.of("Presumptive positive", "Signal error"),
            VersionAnalyte.checked(m("analyte_id", "a"), m("invalid_values", List.of("Presumptive positive", " Signal error ", "")), true, UNITS).get("invalid_values"));
        assertEquals("Enter the uncertainty before switching \"Report ±\" on",
            refusal(() -> VersionAnalyte.checked(null, m("analyte_id", "a", "report_uncertainty", true), true, UNITS)));
        assertEquals("Unit", VersionAnalyte.checked(null, m("analyte_id", "a", "uncertainty", 0.04), true, UNITS).get("uncertainty_kind"));
        Map<String, Object> q = VersionAnalyte.checked(m("analyte_id", "a", "loq", BigDecimal.ONE), m("result_type", "Qualitative"), true, UNITS);
        assertTrue(q.containsKey("loq") && q.get("loq") == null);
        assertTrue(refusal(() -> VersionAnalyte.checked(null, m("analyte_id", "a", "rounding_mode", "Decimal places"), true, UNITS)).startsWith("Choose both"));
    }

    @Test
    void stepsEquipmentAndConnections() {
        JsonNode cfg = j("{}");
        assertTrue(refusal(() -> WorkflowStep.check(null, "v", "Read 2", "x", "Data Entry", cfg, null, null, "CFL")).startsWith("The step key is a short"));
        assertEquals("Replicate weighings: a whole number from 1 to 10",
            refusal(() -> WorkflowStep.check(null, "v", "w11", "Too many", "Weighing", j("{\"replicates\": 11}"), null, null, "CFL")));
        assertNull(refusal(() -> WorkflowStep.check(null, "v", "w", "Weigh", "Weighing", j("{\"replicates\": 3}"), null, null, "CFL")));
        assertEquals("The step's department must be one of the test's own lab's departments",
            refusal(() -> WorkflowStep.check(null, "v", "w", "Weigh", "Weighing", cfg, "d", "TPS", "CFL")));
        assertEquals("The equipment type must be one of the test's own lab's equipment types", refusal(() -> WorkflowStep.checkEquipmentType("TPS", "CFL")));
        WorkflowGraph g = graph();
        assertTrue(refusal(() -> g.assertCanConnect("batch", "calc")).startsWith("That would make a loop"));
        assertEquals("A step cannot come after itself.", refusal(() -> g.assertCanConnect("calc", "calc")));
        List<String> gone = g.remove("calc");
        assertEquals(2, gone.size());   // removing a step removes its connections both ways
        assertTrue(g.activeOf("review").isEmpty());
        assertEquals("digest_final_volume_ml", WorkflowStep.fieldKey("Digest final volume (mL)"));
    }

    private static WorkflowStep step(String key, String type, int n, String cfg) { return new WorkflowStep(key, "v", key, key, type, n, null, j(cfg), "Active"); }

    private static WorkflowGraph graph() {
        return new WorkflowGraph(List.of(step("batch", "Batching", 1, "{}"), step("read", "Data Entry", 2, "{}"), step("calc", "Calculation", 3, "{}"), step("review", "QC Review", 4, "{}")),
            List.of(new WorkflowGraph.Dependency("d1", "read", "batch", "Sequential", true), new WorkflowGraph.Dependency("d2", "calc", "read", "Sequential", true),
                new WorkflowGraph.Dependency("d3", "review", "calc", "Sequential", true)));
    }

    @Test
    void specifications() {
        Specification.Owner line = new Specification.Owner("quoted_line", true, null, Set.of("lead"));
        assertEquals("Salmonella is not an analyte of this test", refusal(() -> Specification.checked(null, m("analyte_id", "sal", "max_value", 1), line, "Salmonella", UNITS)));
        assertTrue(refusal(() -> Specification.checked(null, m("analyte_id", "lead"), line, "Lead", UNITS)).startsWith("Give each limit"));
        assertEquals("The minimum cannot be above the maximum.", refusal(() -> Specification.checked(null, m("analyte_id", "lead", "min_value", 2, "max_value", 1), line, "Lead", UNITS)));
        assertTrue(refusal(() -> Specification.checked(null, m("analyte_id", "lead", "max_value", 1), new Specification.Owner("quoted_line", false, null, Set.of("lead")), "Lead", UNITS))
            .contains("locked once a quote is issued"));
        assertEquals("The test is cancelled",
            refusal(() -> Specification.checked(null, m("analyte_id", "lead", "max_value", 1), new Specification.Owner("requested_test", false, "Cancelled", Set.of("lead")), "Lead", UNITS)));
        assertEquals("Remove the specification (Inactive) and add a new one instead",
            refusal(() -> Specification.checked(m("analyte_id", "lead", "max_value", 1), m("analyte_id", "x"), line, "x", UNITS)));
    }

    private static final DesignFacts FACTS = new DesignFacts() {
        public String methodStatus(String id) { return "Active"; }
        public String departmentName(String id) { return "Chemistry"; }
        public boolean departmentHasPeople(String id) { return true; }
        public boolean priced(String t) { return false; }
        public boolean qcType(String t) { return "Method Blank".equals(t); }
        public String limitShape(String t) { return "Recovery %".equals(t) ? "Range" : null; }
        public String categoryName(String id) { return null; }
        public boolean categoryActive(String id) { return false; }
        public String analyteName(String id) { return "Lead"; }
        public TestDefinition test(String id) { return null; }
        public List<String> publishedKeys() { return List.of(); }
    };

    @Test
    void reviewProblemsAndQcCriteria() {
        TestDefinition t = new TestDefinition("t1", "T-1", "WD", "CFL", "dept", "Active");
        TestVersion v = new TestVersion("v", "t1", 1, "Draft", "m", null, "Significant figures", 3, false, false, null, null);
        VersionAnalyte lead = new VersionAnalyte("a1", "v", "lead", "Lead", "Chemical", 1, "Numeric", null, null, null, null, null, List.of(), List.of(), List.of(), "Active");
        WorkflowGraph g = new WorkflowGraph(List.of(
            step("batch", "Batching", 1, "{\"max_samples\": 20, \"qc\": [{\"qc_type\": \"Method Blank\", \"qc_class\": \"Prep\", \"frequency\": \"Once\", \"criteria\": "
                + "[{\"limit_type\": \"Recovery %\", \"min\": 90, \"max\": 110, \"analytes\": [{\"analyte_id\": \"lead\", \"applies\": true, \"min\": 80, \"max\": 120}]}]}]}"),
            step("calc", "Calculation", 2, "{\"formula\": \"{batch.result} * 2\"}"), step("review", "QC Review", 3, "{}")),
            List.of(new WorkflowGraph.Dependency("d1", "calc", "batch", "Sequential", true), new WorkflowGraph.Dependency("d2", "review", "calc", "Sequential", true)));
        VersionDesign d = new VersionDesign(t, v, List.of(lead), g, List.of(), FACTS);
        List<String> texts = d.problems().stream().map(Problem::problem).toList();
        assertTrue(texts.contains("Lead: a numeric result needs a reporting unit (tab 2)"));
        assertTrue(texts.contains("{batch.result}: \"batch\" offers no values to formulas"));
        assertTrue(texts.contains("Not priced yet: it can be approved, but cannot be quoted or ordered until the catalogue has its price"));
        QcCriteria.Row r = d.qcCriteria().get(0);
        assertEquals("Analyte", r.source());
        assertEquals(0, new BigDecimal("80").compareTo(r.min()));
    }
}
