package com.tentamus.lims.clients.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;

/**
 * A customer. Its account status decides what may happen for it (decision of 2026-10-12):
 * Active and On Hold may order; On Hold holds report release; Inactive may not order.
 * Replaces the database functions client_can_order, client_can_release_report and the trigger client_no_cycle.
 */
public record Client(String id, String accountStatus) {

    /** The columns a person may change on the client form. */
    public static final List<String> EDITABLE = List.of("legal_name", "display_name", "parent_client_id", "account_status", "is_gmp_client",
        "allow_partial_reports", "billing_address", "site_address", "default_report_delivery");

    public static boolean canOrder(String accountStatus) {
        return "Active".equals(accountStatus) || "On Hold".equals(accountStatus);
    }

    public static boolean canReleaseReport(String accountStatus) {
        return accountStatus != null && !"On Hold".equals(accountStatus);
    }

    /**
     * A new parent must not make the client its own ancestor.
     *
     * @param ancestorsOfNewParent the new parent and every client above it
     */
    public static void assertNoLoop(String clientId, List<String> ancestorsOfNewParent) {
        if (clientId != null && ancestorsOfNewParent.contains(clientId))
            throw RuleException.database("Parent Client would create a loop in the client hierarchy");
    }
}
