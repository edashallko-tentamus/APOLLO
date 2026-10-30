package com.tentamus.lims.methods.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * A test: it belongs to a lab (tests made before the designer are shared) and to one of that lab's departments.
 * Replaces the rule parts of the database trigger test_rules (migration 066 keeps only its permission check and the name trim,
 * which the Test catalogue's renames still rely on).
 */
public record TestDefinition(String id, String code, String name, String siteId, String departmentId, String status) {

    public static TestDefinition of(Map<String, Object> row) {
        if (row == null) return null;
        return new TestDefinition(Values.str(row.get("id")), Values.str(row.get("test_code")), Values.str(row.get("test_name")),
            Values.str(row.get("site_id")), Values.str(row.get("department_id")), Values.str(row.get("status")));
    }

    public boolean active() { return "Active".equals(status); }

    public String label() { return code + " " + name; }

    /**
     * Checks a test about to be saved and returns the values to write (the name trimmed).
     *
     * @param before         the test as stored, or null for a new one
     * @param changes        the columns being written
     * @param departmentSite the lab of the department it will name (when it names one), else null
     */
    public static Map<String, Object> checked(TestDefinition before, Map<String, Object> changes, String departmentSite) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (changes.containsKey("test_name")) {
            String n = Values.trimmed(changes.get("test_name"));
            if (n == null) throw RuleException.withCode("Name the test", "23514");
            out.put("test_name", n);
        }
        String site = before == null ? Values.str(changes.get("site_id")) : before.siteId;
        if (before != null && changes.containsKey("site_id") && !Objects.equals(Values.str(changes.get("site_id")), before.siteId)) {
            if (before.siteId != null) throw RuleException.database("A test cannot move to another lab; copy it to that lab instead");
            if (changes.get("site_id") == null) throw RuleException.database("A test keeps its lab");
            site = Values.str(changes.get("site_id"));
        }
        String dept = changes.containsKey("department_id") ? Values.str(changes.get("department_id")) : before == null ? null : before.departmentId;
        if (dept != null && (site == null || !site.equals(departmentSite)))
            throw RuleException.database("The department must be one of the test's own lab's departments");
        return out;
    }
}
