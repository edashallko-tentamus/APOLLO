package com.tentamus.lims.methods.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * A version of a test: Draft while it is designed, Effective once approved (signed, by someone who did not work on it, with
 * no Errors and, where the lab asks for it, a passing workflow verification), Superseded when a later one is approved.
 * Replaces the database's test_version_rules (all but its permission check), assert_version_editable, the rounding checks
 * and the report template rule; approve_test_version and new_test_version stay in the database for the data loads.
 */
public record TestVersion(String id, String testId, int versionNo, String status, String methodId, String procedureText,
                          String roundingMode, Integer roundingDigits, boolean ndBelowLod, boolean reportPerServing,
                          String reportTemplateId, String changeSummary) {
    public static final String DRAFT = "Draft", EFFECTIVE = "Effective", SUPERSEDED = "Superseded";

    /** A report template as a version's choice needs it. */
    public record Template(String id, String name, String siteId, String status) {}

    public static TestVersion of(Map<String, Object> row) {
        if (row == null) return null;
        Integer no = Values.integer(row.get("version_no"));
        return new TestVersion(Values.str(row.get("id")), Values.str(row.get("test_id")), no == null ? 0 : no, Values.str(row.get("status")),
            Values.str(row.get("method_id")), Values.str(row.get("procedure_text")), Values.str(row.get("rounding_mode")),
            Values.integer(row.get("rounding_digits")), Values.bool(row.get("nd_below_lod")), Values.bool(row.get("report_per_serving")),
            Values.str(row.get("report_template_id")), Values.str(row.get("change_summary")));
    }

    public boolean draft() { return DRAFT.equals(status); }

    /** A version and its parts (analytes, steps, their equipment and connections) change only while it is a Draft. */
    public void assertEditable() {
        if (!draft()) throw RuleException.database("Version " + versionNo + " is " + status + " and cannot be changed. Start a new version to make changes.");
    }

    /**
     * Checks the version's settings about to be saved (tab 1) and returns the values to write.
     *
     * @param methodSite the lab of the method it will name, when it names one
     * @param testSite   the test's lab
     * @param template   the report template it will name, when it names one
     */
    public Map<String, Object> checkedSettings(Map<String, Object> changes, String methodSite, String testSite, Template template) {
        assertEditable();
        if (changes.containsKey("status") || changes.containsKey("approved_by") || changes.containsKey("effective_from"))
            throw RuleException.database("A version becomes Effective only when it is approved (signed, by someone who did not work on it)");
        String method = changes.containsKey("method_id") ? Values.str(changes.get("method_id")) : methodId;
        if (method != null && !Objects.equals(methodSite, testSite)) throw RuleException.database("The method must belong to the test's own lab");
        String mode = changes.containsKey("rounding_mode") ? Values.str(changes.get("rounding_mode")) : roundingMode;
        Integer digits = changes.containsKey("rounding_digits") ? Values.integer(changes.get("rounding_digits")) : roundingDigits;
        checkRounding(mode, digits, true);
        if (changes.containsKey("report_template_id") && template != null) {
            if (!"Active".equals(template.status()) && !Objects.equals(template.id(), reportTemplateId))
                throw RuleException.database("Report template " + template.name() + " is retired");
            if (template.siteId() != null && !template.siteId().equals(testSite))
                throw RuleException.database("Report template " + template.name() + " belongs to another lab");
        }
        return new LinkedHashMap<>(changes);
    }

    /** Rounding: 0 to 10 digits, and at least 1 significant figure. A version always has both; an analyte has both or neither. */
    static void checkRounding(String mode, Integer digits, boolean required) {
        if (digits != null && (digits < 0 || digits > 10)) throw RuleException.withCode("Rounding takes 0 to 10 digits.", "23514");
        if (required && digits == null) throw RuleException.withCode("Choose the number of digits for rounding.", "23514");
        if ("Significant figures".equals(mode) && digits != null && digits < 1) throw RuleException.withCode("Use at least 1 significant figure.", "23514");
    }

    /** Only a Draft is approved. */
    public void assertApprovable() {
        if (!draft()) throw RuleException.database("Version " + versionNo + " is already " + status);
    }

    /**
     * Approval: no Errors, not by anyone who worked on it, and with a passing verification of exactly this design when the
     * lab requires one. Returns the version's new state (Effective); the Effective one before it becomes Superseded.
     */
    public TestVersion approve(String approver, List<Problem> problems, Collection<String> authors, boolean verificationRequired, boolean verified) {
        assertApprovable();
        List<String> errors = problems.stream().filter(Problem::error).map(Problem::problem).sorted().toList();
        if (!errors.isEmpty())
            throw RuleException.database("Version " + versionNo + " has " + errors.size() + " problem(s) to fix before it can be approved (see Review and approve), e.g.: " + errors.get(0));
        if (authors.contains(approver)) throw RuleException.database("You worked on this version, so someone else must approve it");
        if (verificationRequired && !verified)
            throw RuleException.database("Version " + versionNo + " needs a passing workflow verification before it can be approved: write the protocol, have QA approve it, execute it and have QA sign the report (Review and approve > Workflow verification)");
        return new TestVersion(id, testId, versionNo, EFFECTIVE, methodId, procedureText, roundingMode, roundingDigits, ndBelowLod, reportPerServing, reportTemplateId, changeSummary);
    }

    /** A new Draft copied from this version (its settings; the content is copied separately). */
    public Map<String, Object> draftFrom(String test, int number, String method, String summary) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("test_id", test);
        v.put("version_no", number);
        v.put("status", DRAFT);
        v.put("method_id", method);
        v.put("procedure_text", procedureText);
        v.put("rounding_mode", roundingMode == null ? "Significant figures" : roundingMode);
        v.put("rounding_digits", roundingDigits == null ? 3 : roundingDigits);
        v.put("nd_below_lod", ndBelowLod);
        v.put("report_per_serving", reportPerServing);
        v.put("report_template_id", reportTemplateId);
        v.put("copied_from_version_id", id);
        v.put("change_summary", summary);
        return v;
    }

    /** The first Draft of a new test, with nothing to copy. */
    public static Map<String, Object> firstDraft(String test, String method, String summary) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("test_id", test);
        v.put("version_no", 1);
        v.put("status", DRAFT);
        v.put("method_id", method);
        v.put("rounding_mode", "Significant figures");
        v.put("rounding_digits", 3);
        v.put("nd_below_lod", false);
        v.put("change_summary", summary);
        return v;
    }

    /** The version a new one is copied from: the Effective one, else the latest. */
    public static TestVersion sourceOf(List<TestVersion> versions) {
        TestVersion best = null;
        for (TestVersion v : versions) {
            if (best == null) { best = v; continue; }
            boolean ve = EFFECTIVE.equals(v.status), be = EFFECTIVE.equals(best.status);
            if (ve && !be || ve == be && v.versionNo > best.versionNo) best = v;
        }
        return best;
    }

    /** Only one Draft at a time. */
    public static void assertNoDraft(List<TestVersion> versions) {
        for (TestVersion v : versions) if (v.draft()) throw RuleException.database("Version " + v.versionNo + " is already a Draft: continue that one");
    }

    public static int nextNumber(List<TestVersion> versions) {
        return versions.stream().mapToInt(TestVersion::versionNo).max().orElse(0) + 1;
    }
}
