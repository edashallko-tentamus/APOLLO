package com.tentamus.lims.stability.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Map;
import java.util.Objects;

/**
 * The lab's stability setup: storage conditions, chambers (a piece of equipment set to a condition) and their racks.
 * Replaces the rule part of the database trigger stability_setup_rules and the name, humidity and position checks
 * (migration 070; stability.configure, and that conditions for every lab are a system administrator's, stay in the
 * database).
 */
public final class StabilitySetup {
    private StabilitySetup() {}

    /**
     * A storage condition about to be saved.
     *
     * @param onQuote whether a stability quote uses it (then its temperature, humidity and type are fixed)
     */
    public static void checkCondition(Map<String, Object> before, Map<String, Object> after, boolean onQuote) {
        Object name = after.get("condition_name");
        if (name == null || name.toString().strip().isEmpty()) throw RuleException.withCode("Name the condition", "23514");
        if (after.get("humidity_pct") instanceof Number h && (h.doubleValue() < 0 || h.doubleValue() > 100)) throw RuleException.withCode("Humidity is 0 to 100 %", "23514");
        if (before == null) return;
        if (!Objects.equals(before.get("site_id"), after.get("site_id"))) throw RuleException.database("A condition stays with its lab");
        if (onQuote && (changed(before, after, "temperature_c") || changed(before, after, "humidity_pct") || changed(before, after, "condition_type")))
            throw RuleException.database("This condition is on a stability quote: its temperature, humidity and type are fixed (retire it and add a new one)");
    }

    /**
     * A chamber about to be saved: the equipment decides its lab.
     *
     * @param equipmentSite    the equipment's lab (the chamber's lab)
     * @param equipmentRetired whether the equipment is retired
     * @param conditionSite    the condition's lab, or null for a condition of every lab
     * @param holdsMaterial    whether study material is stored in it
     */
    public static void checkChamber(Map<String, Object> before, Map<String, Object> after, String equipmentCode, String equipmentSite, boolean equipmentRetired,
                                    String conditionSite, boolean holdsMaterial) {
        if (before == null && equipmentRetired) throw RuleException.database(equipmentCode + " is retired and cannot be a stability chamber");
        if (before != null && !Objects.equals(before.get("equipment_id"), after.get("equipment_id"))) throw RuleException.database("A chamber stays the same piece of equipment");
        if (conditionSite != null && !conditionSite.equals(equipmentSite)) throw RuleException.database("That condition belongs to another lab");
        if (before != null && (changed(before, after, "condition_id") || changed(before, after, "status")) && holdsMaterial)
            throw RuleException.database("Study material is stored in this chamber: move it before changing the chamber's condition or retiring it");
    }

    /** A rack about to be saved: material stored in it keeps it in its chamber and active. */
    public static void checkRack(Map<String, Object> before, Map<String, Object> after, boolean holdsMaterial) {
        Object code = after.get("rack_code");
        if (code == null || code.toString().strip().isEmpty()) throw RuleException.withCode("Give the rack a code", "23514");
        if (after.get("positions") instanceof Number p && p.doubleValue() <= 0) throw RuleException.withCode("Positions: a number above 0", "23514");
        if (before == null || !holdsMaterial) return;
        if (changed(before, after, "chamber_id")) throw RuleException.database("Study material is stored in this rack: it stays in its chamber");
        if ("Inactive".equals(String.valueOf(after.get("status")))) throw RuleException.database("Study material is stored in this rack: move it before retiring the rack");
    }

    private static boolean changed(Map<String, Object> a, Map<String, Object> b, String k) {
        Object x = a.get(k), y = b.get(k);
        if (x instanceof Number n && y instanceof Number m) return Double.compare(n.doubleValue(), m.doubleValue()) != 0;
        return !Objects.equals(x == null ? null : x.toString(), y == null ? null : y.toString());
    }
}
