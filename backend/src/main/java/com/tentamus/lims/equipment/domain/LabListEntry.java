package com.tentamus.lims.equipment.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * A row of one of a lab's equipment lists: a department or an equipment type. Replaces the rules part of the database
 * trigger equipment_list_rules and the non-blank checks on codes and names (migration 064 drops them). An entry never
 * moves to another lab: Java writes the lab only on a new entry.
 */
public final class LabListEntry {
    private LabListEntry() {}

    /** A department about to be saved: the code trimmed and in capitals, the name trimmed. */
    public static Map<String, Object> department(Map<String, Object> stored, Map<String, Object> changes) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (changes.containsKey("department_code")) {
            String code = Fields.trimmed(changes.get("department_code"));
            out.put("department_code", code == null ? null : code.toUpperCase(Locale.ROOT));
        }
        if (changes.containsKey("department_name")) out.put("department_name", Fields.trimmed(changes.get("department_name")));
        Map<String, Object> after = Fields.after(stored, out);
        if (Fields.blank(after.get("department_code"))) throw RuleException.withCode("Give the department a code.", "23514");
        if (Fields.blank(after.get("department_name"))) throw RuleException.withCode("Give the department a name.", "23514");
        return out;
    }

    /** An equipment type about to be saved: the name trimmed. */
    public static Map<String, Object> type(Map<String, Object> stored, Map<String, Object> changes) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (changes.containsKey("type_name")) out.put("type_name", Fields.trimmed(changes.get("type_name")));
        if (Fields.blank(Fields.after(stored, out).get("type_name"))) throw RuleException.withCode("Give the equipment type a name.", "23514");
        return out;
    }
}
