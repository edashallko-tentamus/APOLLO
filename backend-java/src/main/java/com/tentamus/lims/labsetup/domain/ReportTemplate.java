package com.tentamus.lims.labsetup.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * A report template: a name, a layout and the options that layout honours, for one lab or every lab, one default per
 * lab. Replaces the rule part of report_template_rules and the name check (migration 071); who may keep which
 * templates (system administrators for every lab, reports.templates for a lab) is still checked by the database.
 */
public final class ReportTemplate {
    /** The options the layouts know. */
    public static final Set<String> OPTIONS = Set.of("show_method", "show_test_version", "show_tested_dates", "show_loq", "title");

    private ReportTemplate() {}

    /**
     * Checks a template about to be saved.
     *
     * @param before  the stored template (null for a new one)
     * @param after   the template as it will be; options already parsed (a Map for a JSON object)
     */
    public static void check(Map<String, Object> before, Map<String, Object> after) {
        Object name = after.get("template_name");
        if (name == null || name.toString().strip().isEmpty())
            throw RuleException.withCode("new row for relation \"report_template\" violates check constraint \"report_template_template_name_check\"", "23514");
        if (before != null && before.get("site_id") != null && !Objects.equals(str(before.get("site_id")), str(after.get("site_id"))))
            throw RuleException.database("A template stays with its lab");
        Object options = after.get("options");
        if (options != null) {
            if (!(options instanceof Map<?, ?> m)) throw RuleException.database("Template options must be a set of named settings");
            for (Object k : m.keySet()) if (!OPTIONS.contains(String.valueOf(k))) throw RuleException.database("Unknown template option \"" + k + "\"");
        }
        String status = after.get("status") == null ? "Active" : after.get("status").toString();
        if (!"Active".equals(status) && truthy(after.get("is_default")))
            throw RuleException.database("The default template cannot be retired: make another one the default first");
    }

    private static boolean truthy(Object v) { return Boolean.TRUE.equals(v) || "true".equals(String.valueOf(v)) || "t".equals(String.valueOf(v)); }

    private static String str(Object v) { return v == null ? null : v.toString(); }
}
