package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * A lab's QA testing default for one item type (Media on by default). Replaces the rule part of the database trigger
 * qa_testing_default_rules (migration 062 keeps only its permission check).
 */
public final class QaTestingDefault {
    private QaTestingDefault() {}

    /** A default keeps its lab and item type; its note is trimmed (empty = none). Returns the values to write. */
    public static Map<String, Object> checked(Map<String, Object> before, Map<String, Object> changes) {
        for (String k : new String[] {"site_id", "chemical_type"})
            if (changes.containsKey(k) && !Objects.equals(String.valueOf(changes.get(k)), String.valueOf(before.get(k))))
                throw RuleException.database("A lab's QA testing default keeps its lab and item type");
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (changes.containsKey("note")) out.put("note", Values.trimmed(changes.get("note")));
        return out;
    }
}
