package com.tentamus.lims.methods.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * A lab's method (its name and SOP code); one method can back several tests. Replaces the rule parts of the database
 * trigger method_rules and the name check (migration 066 keeps its permission check).
 */
public record SopMethod(String id, String code, String name, String siteId, String sopCode, String sopLink, String status) {

    public static SopMethod of(Map<String, Object> row) {
        if (row == null) return null;
        return new SopMethod(Values.str(row.get("id")), Values.str(row.get("method_code")), Values.str(row.get("method_name")),
            Values.str(row.get("site_id")), Values.str(row.get("sop_code")), Values.str(row.get("sop_link")), Values.str(row.get("status")));
    }

    public boolean active() { return "Active".equals(status); }

    /** Checks a method about to be saved; returns the values to write (name trimmed, SOP code and link trimmed or empty). */
    public static Map<String, Object> checked(SopMethod before, Map<String, Object> changes) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (before != null && changes.containsKey("site_id") && !Objects.equals(Values.str(changes.get("site_id")), before.siteId))
            throw RuleException.database("A method cannot move to another lab (copy the test instead)");
        if (before == null || changes.containsKey("method_name")) {
            String n = Values.trimmed(changes.containsKey("method_name") ? changes.get("method_name") : before.name);
            if (n == null) throw RuleException.withCode("Name the method", "23514");
            out.put("method_name", n);
        }
        if (changes.containsKey("sop_code")) out.put("sop_code", Values.trimmed(changes.get("sop_code")));
        if (changes.containsKey("sop_link")) out.put("sop_link", Values.trimmed(changes.get("sop_link")));
        return out;
    }

    /** The same method in another lab: a new one with this name and SOP, to be checked there. */
    public Map<String, Object> copyFor(String site) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("site_id", site);
        m.put("method_name", name);
        m.put("sop_code", sopCode);
        m.put("sop_link", sopLink);
        m.put("description", "Copied from " + code + "; check the SOP code for this lab");
        return m;
    }
}
