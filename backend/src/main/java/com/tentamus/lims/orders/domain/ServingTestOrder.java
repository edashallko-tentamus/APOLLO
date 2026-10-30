package com.tentamus.lims.orders.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * Which serving test (Serving weight or Density) "Results per serving" orders on a sample: none when one is already
 * ordered; the client's quoted line for it when there is one; otherwise the lab's own serving test at its catalogue price
 * (decided with Alex, 2026-10-15). Java's own copy of order_serving_test, which stays in the database for the client's
 * consent to a serving test (split requests).
 *
 * @param existingTestId the sample's active test of that role, or null
 * @param quotedLineId   the client's orderable quoted line for a test of that role at the lab, or null
 * @param labTestId      the lab's serving test of that role with an approved workflow, or null
 */
public record ServingTestOrder(String role, String existingTestId, String quotedLineId, String labTestId, String siteCode) {

    public enum Way { ALREADY_ORDERED, FROM_QUOTE, AT_CATALOGUE_PRICE }

    public Way way() {
        if (!"Serving weight".equals(role) && !"Density".equals(role)) throw RuleException.database("Serving weight or Density");
        if (existingTestId != null) return Way.ALREADY_ORDERED;
        if (quotedLineId != null) return Way.FROM_QUOTE;
        if (labTestId == null)
            throw RuleException.database("No " + role + " test with an approved workflow at " + siteCode + ": mark one in the Test catalogue (\"Serving test\")");
        return Way.AT_CATALOGUE_PRICE;
    }
}
