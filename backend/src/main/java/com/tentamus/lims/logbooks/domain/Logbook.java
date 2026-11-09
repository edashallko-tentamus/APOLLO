package com.tentamus.lims.logbooks.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.function.UnaryOperator;

/**
 * A logbook's settings: what it is about, how it is reviewed and whether its entries make lots. Replaces the rule part of
 * the database trigger logbook_rules and the name and validity checks (migration 070; logbook.design stays in the
 * database).
 */
public final class Logbook {
    private Logbook() {}

    /**
     * Applies the rules to a logbook about to be saved and returns the values to write (name and lot name trimmed, the
     * lots' unit in the Units list's spelling).
     *
     * @param before     the logbook as stored, or null for a new one
     * @param after      the logbook as it will be (stored values with the changes applied)
     * @param changes    the columns being written
     * @param hasEntries whether the logbook already has entries
     * @param lotUnit    the Units list's check of the lots' unit (refuses one not on the list)
     */
    public static Map<String, Object> checked(Map<String, Object> before, Map<String, Object> after, Map<String, Object> changes, boolean hasEntries,
                                              UnaryOperator<String> lotUnit) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        String name = s(after.get("logbook_name")) == null ? "" : s(after.get("logbook_name")).strip();
        if (name.isEmpty()) throw RuleException.withCode("Name the logbook", "23514");
        if (changes.containsKey("logbook_name")) out.put("logbook_name", name);
        if (changes.containsKey("lot_name")) out.put("lot_name", blankNull(after.get("lot_name")));
        if (after.get("validity_hours") instanceof Number n && !(n.doubleValue() > 0)) throw RuleException.withCode("Valid for: a number of hours above 0", "23514");
        String subject = or(after.get("subject"), "None"), route = or(after.get("review_route"), "Logbook"), signing = or(after.get("signing"), "Signature");
        boolean makesLots = Boolean.TRUE.equals(after.get("creates_lot"));
        if (before != null && !Objects.equals(before.get("site_id"), after.get("site_id"))) throw RuleException.database("A logbook stays with its lab");
        if (before != null && !Objects.equals(before.get("logbook_code"), after.get("logbook_code"))) throw RuleException.database("The logbook ID is given by the system");
        if (before != null && !Objects.equals(or(before.get("subject"), "None"), subject) && hasEntries)
            throw RuleException.database("The logbook has entries: what it is about (" + before.get("subject") + ") cannot change");
        if ("Sample weights".equals(after.get("kind")) && (!"Sample".equals(subject) || !"Batch".equals(route)))
            throw RuleException.database("A sample weights logbook is about samples, and its entries are reviewed in the batch that uses them");
        if ("Batch".equals(route) && !"Sample".equals(subject))
            throw RuleException.database("Only entries used once (a sample's weighed aliquot) are reviewed in the batch; other logbooks are reviewed by QA in the logbook");
        if (makesLots && !"Lot".equals(subject)) throw RuleException.database("A logbook that makes lots is about lots (each entry makes one)");
        if (makesLots && !"Signature".equals(signing)) throw RuleException.database("A logbook that makes inventory lots signs its entries (inventory changes are signed)");
        if (makesLots && (changes.containsKey("lot_unit") || changes.containsKey("creates_lot"))) out.put("lot_unit", lotUnit.apply(s(after.get("lot_unit"))));
        return out;
    }

    static String s(Object v) { return v == null ? null : v.toString(); }

    static String or(Object v, String d) { return v == null ? d : v.toString(); }

    static String blankNull(Object v) { return v == null || v.toString().strip().isEmpty() ? null : v.toString().strip(); }
}
