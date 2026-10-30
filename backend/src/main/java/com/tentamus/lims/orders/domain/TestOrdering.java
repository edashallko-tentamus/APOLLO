package com.tentamus.lims.orders.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * Ordering a quoted test on a sample: the sample is not cancelled, the line is on an accepted, unexpired quote of the
 * client, the client may order, and the test has an Effective version to pin. Java's own copy of order_test and
 * apply_project, which stay in the database for the ordering functions of serving tests, packages, catalogue orders and
 * the demo data load.
 *
 * @param sampleStatus  the sample's status, or null when there is no such sample
 * @param lineOrderable whether the line is one of the client's orderable lines
 * @param accountStatus the client's account status
 * @param versionId     the test's Effective version, or null
 */
public record TestOrdering(String sampleStatus, boolean lineOrderable, String accountStatus, String versionId) {

    /** Refuses the order, or returns the version to pin. */
    public String check() {
        if (sampleStatus == null) throw RuleException.database("Sample not found");
        if ("Cancelled".equals(sampleStatus)) throw RuleException.database("The sample is cancelled");
        if (!lineOrderable) throw RuleException.database("This test is not on an accepted quote for this client. Quote it, or record list price acceptance, first");
        if (!("Active".equals(accountStatus) || "On Hold".equals(accountStatus))) throw RuleException.database("This client is Inactive and cannot order");
        if (versionId == null) throw RuleException.database("This test has no Effective version yet, so it cannot be ordered");
        return versionId;
    }

    /** Applying a project that has no orderable line for this client is refused (when nothing was ordered). */
    public static void assertProjectOrderable(int ordered, int orderableLines) {
        if (ordered == 0 && orderableLines == 0) throw RuleException.database("That project has no accepted, orderable tests for this client");
    }
}
