package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * One analyte on an item (with its concentration, target and tolerance). Java's own copy of the database trigger
 * lot_analyte_rules, which stays because mixtures, reorders, transfers and logbook lots write analyte lines through it.
 */
public final class LotAnalyteLine {
    private LotAnalyteLine() {}

    /**
     * Checks an analyte line about to be written and returns the values to write (the concentration unit in the Units
     * list's spelling).
     *
     * @param before the line as stored, or null; analyteActive whether the analyte is Active
     */
    public static Map<String, Object> checked(Lot lot, Map<String, Object> before, Map<String, Object> after, boolean analyteActive, Units units) {
        boolean insert = before == null;
        if (!insert && (!same(before, after, "lot_id") || !same(before, after, "analyte_id")))
            throw RuleException.database("The lot and analyte of an analyte line cannot be changed; set it Inactive and add another");
        if (lot.types().isConsumableOnly()) throw RuleException.database("Consumables have no analytes");
        if ((insert || !same(before, after, "analyte_id")) && !analyteActive) throw RuleException.database("That analyte is Retired");
        Map<String, Object> out = new LinkedHashMap<>(after);
        String cu = Values.str(after.get("concentration_unit"));
        if (insert || !same(before, after, "concentration_unit")) cu = units.canonical(cu, Units.CONCENTRATION, "Concentration unit");
        out.put("concentration_unit", cu);
        if (after.get("concentration") != null && cu == null) throw RuleException.database("Give the concentration a unit");
        if (after.get("target_concentration") != null && cu == null) throw RuleException.database("Give the target concentration a unit");
        return out;
    }

    private static boolean same(Map<String, Object> a, Map<String, Object> b, String k) {
        return Objects.equals(Values.str(a.get(k)), Values.str(b.get(k)));
    }
}
