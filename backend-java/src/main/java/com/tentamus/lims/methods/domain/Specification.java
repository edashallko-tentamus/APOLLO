package com.tentamus.lims.methods.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * A specification limit on one analyte of a quoted test (copied to every order from it) or of one requested test. Replaces
 * the rule parts of the database trigger specification_rules and the checks specification_has_limit and
 * specification_order (migration 066 keeps the permission check).
 */
public final class Specification {
    /** Whose limits: a quoted line (its quote still editable) or a requested test (its status), and the analytes of its version. */
    public record Owner(String kind, boolean quoteEditable, String testStatus, Set<String> versionAnalytes) {
        public boolean quoted() { return "quoted_line".equals(kind); }
    }

    private Specification() {}

    /**
     * Checks a specification row about to be saved and returns the values to write.
     *
     * @param before      the stored row, or null for a new one
     * @param analyteName the name of the analyte it will name (for the message)
     */
    public static Map<String, Object> checked(Map<String, Object> before, Map<String, Object> changes, Owner owner, String analyteName,
                                              VersionAnalyte.Units units) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (before != null) for (String k : new String[] {"quoted_line_id", "requested_test_id", "analyte_id"})
            if (changes.containsKey(k) && !Objects.equals(Values.str(changes.get(k)), Values.str(before.get(k))))
                throw RuleException.database("Remove the specification (Inactive) and add a new one instead");
        if (changes.containsKey("text_value")) out.put("text_value", Values.trimmed(changes.get("text_value")));
        if (changes.containsKey("unit")) out.put("unit", units.canonical(changes.get("unit"), "Specification unit"));
        if (owner.quoted() && !owner.quoteEditable())
            throw RuleException.database("Specifications are locked once a quote is issued; create a new version of the quote");
        if (!owner.quoted() && "Cancelled".equals(owner.testStatus())) throw RuleException.database("The test is cancelled");
        Map<String, Object> after = new LinkedHashMap<>(before == null ? Map.of() : before);
        after.putAll(out);
        String status = after.get("status") == null ? "Active" : Values.str(after.get("status"));
        String analyte = Values.str(after.get("analyte_id"));
        if ("Active".equals(status) && owner.versionAnalytes() != null && !owner.versionAnalytes().contains(analyte))
            throw RuleException.database(analyteName + " is not an analyte of this test");
        BigDecimal min = Values.num(after.get("min_value")), max = Values.num(after.get("max_value"));
        if (min == null && max == null && Values.trimmed(after.get("text_value")) == null)
            throw RuleException.withCode("Give each limit a minimum, a maximum or a text (e.g. Absent); leave the row empty for unspecified.", "23514");
        if (min != null && max != null && min.compareTo(max) > 0) throw RuleException.withCode("The minimum cannot be above the maximum.", "23514");
        return out;
    }
}
