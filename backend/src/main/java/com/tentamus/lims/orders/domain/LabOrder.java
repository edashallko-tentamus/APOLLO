package com.tentamus.lims.orders.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Map;
import java.util.Objects;

/**
 * A lab order: who orders (an active contact with the Ordering role, for a client that may order), the license it names,
 * and its status. Replaces the checks of the database triggers lab_order_rules and lab_order_license_rule (migration 063);
 * the submitted time is still stamped by the database too, because logging and receiving there submit orders.
 */
public final class LabOrder {
    /** The order's facts the rules read. */
    public record State(String id, String clientId, String status, String orderingContactId, String licenseId, boolean hasSamples) {}

    /** Who is ordering: may the client order, and is the contact an active ordering contact of that client. */
    public record Party(String accountStatus, boolean contactOrders) {
        boolean clientCanOrder() { return "Active".equals(accountStatus) || "On Hold".equals(accountStatus); }
    }

    /** The license an order names. */
    public record License(String code, String clientId, String status) {}

    private final State before;
    private final State after;

    private LabOrder(State before, State after) {
        this.before = before;
        this.after = after;
    }

    /** A new order (before is null) or a change to a stored one. */
    public static LabOrder change(State before, State after) { return new LabOrder(before, after); }

    /** The order as it will be once the given columns are written over the stored one. */
    public static State apply(State before, Map<String, Object> vals) {
        return new State(before.id(),
            vals.containsKey("client_id") ? str(vals.get("client_id")) : before.clientId(),
            vals.containsKey("status") ? str(vals.get("status")) : before.status(),
            vals.containsKey("ordering_contact_id") ? str(vals.get("ordering_contact_id")) : before.orderingContactId(),
            vals.containsKey("client_license_id") ? str(vals.get("client_license_id")) : before.licenseId(),
            before.hasSamples());
    }

    /** Whether the client or the ordering contact is (re)chosen, so who may order is checked again. */
    public boolean partyChosen() {
        return before == null || !Objects.equals(before.clientId(), after.clientId()) || !Objects.equals(before.orderingContactId(), after.orderingContactId());
    }

    public boolean licenseChecked() {
        return after.licenseId() != null && (before == null || !Objects.equals(before.licenseId(), after.licenseId()) || !Objects.equals(before.clientId(), after.clientId()));
    }

    /**
     * Refuses an order the client may not place, or the contact may not place for it, a client changed once samples are
     * on the order, and another client's or a newly chosen retired license.
     *
     * @param party   who orders (only read when {@link #partyChosen()})
     * @param license the license the order names (only read when {@link #licenseChecked()})
     */
    public void check(Party party, License license) {
        if (partyChosen()) {
            if (!party.clientCanOrder()) throw RuleException.database("This client is Inactive and cannot place new orders");
            if (!(party.contactOrders() && party.clientCanOrder()))
                throw RuleException.database("The ordering contact must be an active contact of this client with the Ordering role");
        }
        if (before != null && !Objects.equals(before.clientId(), after.clientId()) && before.hasSamples())
            throw RuleException.database("The client cannot be changed once samples are on the order");
        if (licenseChecked() && license != null) {
            if (!Objects.equals(license.clientId(), after.clientId())) throw RuleException.database("License " + license.code() + " belongs to another client");
            if ("Retired".equals(license.status()) && (before == null || !Objects.equals(before.licenseId(), after.licenseId())))
                throw RuleException.database("License " + license.code() + " is retired: choose a current one");
        }
    }

    /** The order's status once some of its samples are logged: a Draft is submitted, and it is Received when none is still expected. */
    public static String statusAfterLogging(String status, boolean anyStillExpected) {
        String s = "Draft".equals(status) ? "Submitted" : status;
        return "Submitted".equals(s) && !anyStillExpected ? "Received" : s;
    }

    /** Submitting stamps the time once. */
    public static boolean stampsSubmitted(String status, Object submittedAt) {
        return "Submitted".equals(status) && submittedAt == null;
    }

    private static String str(Object v) { return v == null || "".equals(v) ? null : v.toString(); }
}
