package com.tentamus.lims.orders.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * A test requested on a sample. Its price, rush fee, turnaround and due date are worked out from the quote line or the
 * catalogue (the database trigger requested_test_derive still does this for every writer, the ordering functions of
 * quotes, packages, stability, OOS, training and media among them). Java checks a person's changes itself: the test,
 * sample and quote line are fixed, a cancelled test is not reinstated, a TAT override is whole days and needs a reason,
 * changes on a logged sample need a reason, and a test with results or in a batch is not cancelled.
 *
 * @param clockStarted whether its sample is logged (the clock has started)
 */
public record RequestedTest(String id, String label, String status, String rushTierId, String specialInstructions, Integer tatOverride, boolean clockStarted) {

    /** What a person may change on a requested test from the order page. */
    public static final List<String> EDITABLE = List.of("rush_tier_id", "status", "special_instructions", "tat_override");

    /**
     * Refuses changes the rules do not allow.
     *
     * @param changes      the columns being written ("" already null)
     * @param reasonGiven  whether a Reason for Change was given
     * @param cancelProblem why this test cannot be cancelled now (results or a batch), or null
     */
    public void checkChange(Map<String, Object> changes, boolean reasonGiven, String cancelProblem) {
        String newStatus = changes.containsKey("status") ? str(changes.get("status")) : status;
        if ("Cancelled".equals(status) && !"Cancelled".equals(newStatus)) throw RuleException.database("A cancelled test cannot be reinstated; order it again");
        if (clockStarted && !reasonGiven
            && (!Objects.equals(status, newStatus) || differs(changes, "rush_tier_id", rushTierId) || differs(changes, "special_instructions", specialInstructions)))
            throw RuleException.database("A Reason for Change is required to change a test on a logged sample");
        if (changes.containsKey("tat_override")) {
            Object o = changes.get("tat_override");
            Integer n = o == null ? null : wholeDays(o);
            if (n != null && n < 0) throw RuleException.withCode("new row for relation \"requested_test\" violates check constraint \"requested_test_tat_override_check\"", "23514");
            if (!Objects.equals(n, tatOverride) && !reasonGiven) throw RuleException.database("A Reason for Change is required to override the turnaround (TAT)");
        }
        if ("Cancelled".equals(newStatus) && !"Cancelled".equals(status) && cancelProblem != null) throw RuleException.database(cancelProblem);
    }

    /**
     * Why a test cannot be cancelled now, or null (was requested_test_cancel_problem).
     *
     * @param resultBatches the batches its active results come from, comma-separated, or null
     * @param openBatch     the open batch it is an active entry of, or null
     */
    public static String cancelProblem(String label, String resultBatches, String openBatch) {
        if (resultBatches != null) return label + " has results (" + resultBatches + "): it cannot be cancelled";
        if (openBatch != null) return label + " is in batch " + openBatch + ": take it out of the batch first (possible until bench work starts), or cancel the batch";
        return null;
    }

    /** A test whose clock starts goes into the pool. */
    public static String statusWhenClockStarts(String status) { return "Ordered".equals(status) ? "In Pool" : status; }

    private static boolean differs(Map<String, Object> changes, String col, String stored) {
        return changes.containsKey(col) && !Objects.equals(str(changes.get(col)), stored);
    }

    private static Integer wholeDays(Object v) {
        try { return new BigDecimal(v.toString().strip()).intValueExact(); }
        catch (ArithmeticException | NumberFormatException e) { throw RuleException.withCode("invalid input syntax for type integer: \"" + v + "\"", "22P02"); }
    }

    private static String str(Object v) { return v == null ? null : v.toString(); }
}
