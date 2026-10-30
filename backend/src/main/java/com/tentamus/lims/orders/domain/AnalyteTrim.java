package com.tentamus.lims.orders.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Map;
import java.util.Objects;

/**
 * Trimming analytes on an ordered test: quoted analytes may be taken off or put back (the price follows, keeping the quoted
 * discount %), never added; at least one stays; on a logged sample a change needs a reason. Replaces the database
 * triggers requested_analyte_rules and requested_analyte_reprice (migration 063).
 *
 * @param testStatus   the requested test's status
 * @param clockStarted whether its sample is logged
 */
public record AnalyteTrim(String testStatus, boolean clockStarted) {

    /** An analyte added to an ordered test must be on the quote line (ordering copies the quote's analytes). */
    public static void assertQuoted(boolean onQuoteLine) {
        if (!onQuoteLine) throw RuleException.database("That analyte is not on the client's quote; re-quote or accept list price to add it");
    }

    /**
     * A change to a requested analyte.
     *
     * @param stored  its analyte_id, analyte_price and included as stored
     * @param changes the columns being written
     * @return whether included changes (the test is then repriced)
     */
    public boolean checkChange(Map<String, Object> stored, Map<String, Object> changes, boolean reasonGiven) {
        if (changes.containsKey("analyte_id") && !Objects.equals(str(changes.get("analyte_id")), str(stored.get("analyte_id")))
            || changes.containsKey("analyte_price") && !Sample.same(stored.get("analyte_price"), changes.get("analyte_price")))
            throw RuleException.database("Analyte and price are fixed on a requested analyte");
        if ("Cancelled".equals(testStatus)) throw RuleException.database("The test is cancelled");
        boolean flips = changes.containsKey("included") && !Objects.equals(bool(changes.get("included")), bool(stored.get("included")));
        if (clockStarted && !reasonGiven && flips) throw RuleException.database("A Reason for Change is required to change analytes on a logged sample");
        return flips;
    }

    /** After trimming, at least one analyte stays on the test. */
    public static void assertOneLeft(int included) {
        if (included == 0) throw RuleException.database("At least one analyte must stay on the test (cancel the test instead)");
    }

    private static Boolean bool(Object v) { return v == null ? null : v instanceof Boolean b ? b : Boolean.valueOf("true".equalsIgnoreCase(v.toString()) || "t".equals(v.toString())); }

    private static String str(Object v) { return v == null ? null : v.toString(); }
}
