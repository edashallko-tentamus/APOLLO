package com.tentamus.lims.logbooks.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * A field of a logbook's design (a number, a choice, a calculation...). Replaces the rule part of the database trigger
 * logbook_field_rules and the label check (migration 070; that the version is a Draft is checked by the service, and
 * logbook.design stays in the database).
 */
public final class LogbookField {
    /** Keys the bench formulas already use for a step's own values: a published value cannot take one of these names. */
    public static final List<String> RESERVED = List.of("weight", "factor", "final_volume", "duration", "reading", "result");

    private LogbookField() {}

    /** A label as a key: lower case, anything else as _ (the database's field_key()). */
    public static String keyOf(String label) {
        String k = (label == null ? "" : label.toLowerCase()).replaceAll("[^a-z0-9]+", "_");
        return k.replaceAll("^_+|_+$", "");
    }

    /**
     * Applies the rules to a field about to be saved and returns the values to write.
     *
     * @param before  the field as stored, or null for a new one
     * @param after   the field as it will be (stored values with the changes applied)
     * @param changes the columns being written
     * @param subject what the logbook is about (Equipment, Lot, Sample, None)
     */
    public static Map<String, Object> checked(Map<String, Object> before, Map<String, Object> after, Map<String, Object> changes, String subject) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (before != null && !Objects.equals(before.get("version_id"), after.get("version_id"))) throw RuleException.database("A field stays in its version");
        String label = after.get("label") == null ? "" : after.get("label").toString().strip();
        if (label.isEmpty()) throw RuleException.withCode("Give the field a label", "23514");
        String key = Logbook.blankNull(after.get("field_key"));
        if (key == null) key = keyOf(label);
        if (key.equals("this")) throw RuleException.database("Field key \"this\" is kept for formulas; choose another");
        if (!key.matches("^[a-z][a-z0-9_]{0,39}$"))
            throw RuleException.database("Field key \"" + key + "\": use lower-case letters, digits and _ (starting with a letter, 40 at most)");
        String type = Logbook.or(after.get("field_type"), "Number");
        boolean number = type.equals("Number") || type.equals("Calculated");
        Object min = number ? after.get("limit_min") : null, max = number ? after.get("limit_max") : null;
        boolean publish = number && Boolean.TRUE.equals(after.get("publish")), equipmentLimits = number && Boolean.TRUE.equals(after.get("equipment_limits"));
        Object choices = type.equals("Choice") ? after.get("choices") : null;
        if (type.equals("Choice") && empty(choices)) throw RuleException.database(label + ": a Choice field lists its choices");
        if (min != null && max != null && dec(min).compareTo(dec(max)) > 0)
            throw RuleException.database(label + ": the lower limit (" + num(dec(min)) + ") is above the upper limit (" + num(dec(max)) + ")");
        if (equipmentLimits && !"Equipment".equals(subject)) throw RuleException.database(label + ": limits per piece of equipment need a logbook about equipment");
        if (publish && !"Lot".equals(subject)) throw RuleException.database(label + ": only a logbook about lots publishes values (the lot's value, used by formulas at the bench)");
        if (publish && RESERVED.contains(key))
            throw RuleException.database(label + ": \"" + key + "\" is already a name the bench formulas use; choose another key to publish it");
        out.put("label", label);
        out.put("field_key", key);
        out.put("unit", Logbook.blankNull(after.get("unit")));
        out.put("formula", type.equals("Calculated") ? Logbook.blankNull(after.get("formula")) : null);
        out.put("limit_min", min);
        out.put("limit_max", max);
        out.put("equipment_limits", equipmentLimits);
        out.put("publish", publish);
        out.put("choices", choices);
        return out;
    }

    private static boolean empty(Object choices) {
        if (choices == null) return true;
        if (choices instanceof List<?> l) return l.isEmpty();
        return choices.toString().replaceAll("[{}\\s\"]", "").isEmpty();
    }

    private static BigDecimal dec(Object v) { return new BigDecimal(v.toString()); }

    /** A limit as the database wrote it in messages (lb_num: whole numbers without decimals, no trailing zeros). */
    static String num(BigDecimal p) {
        BigDecimal s = p.stripTrailingZeros();
        return s.scale() <= 0 ? s.toBigInteger().toString() : s.toPlainString();
    }
}
