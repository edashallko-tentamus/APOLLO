package com.tentamus.lims.orders.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * Intake's decision on a rush request: Approved (only a rush waiting for approval), or Not Accepted with a reason, replaced by
 * a slower tier of the same schedule or standard turnaround, which sends the client the fixed "Rush Not Accepted" email
 * naming the staff member. Replaces the trigger rush_decision_apply and the check decline_needs_reason (migration 063).
 */
public final class RushDecision {
    /** A rush tier: its schedule and turnaround. */
    public record Tier(String id, String name, String scheduleId, int rushTat) {}

    /** The requested test's rush as stored. */
    public record Rush(String tierId, String status) {}

    public static final String APPROVED = "Approved";
    public static final String NOT_ACCEPTED = "Not Accepted";

    private final String decision;
    private final Tier requested;
    private final Tier replacement;
    private final String reason;

    public RushDecision(String decision, Tier requested, Tier replacement, String reason) {
        this.decision = decision;
        this.requested = requested;
        this.replacement = replacement;
        this.reason = reason;
    }

    public boolean approves() { return APPROVED.equals(decision); }

    public Tier replacement() { return replacement; }

    /** The rush status the test takes. */
    public String newStatus() { return approves() || replacement != null ? APPROVED : NOT_ACCEPTED; }

    /** Refuses a decision that does not fit the test's open rush request. */
    public void check(Rush rush) {
        if (!APPROVED.equals(decision) && !NOT_ACCEPTED.equals(decision))
            throw RuleException.withCode("invalid input value for enum rush_decision_type: \"" + decision + "\"", "22P02");
        if (NOT_ACCEPTED.equals(decision) && (reason == null || reason.isBlank()))
            throw RuleException.withCode("new row for relation \"rush_decision\" violates check constraint \"decline_needs_reason\"", "23514");
        String requestedId = requested == null ? null : requested.id();
        if (!Objects.equals(rush.tierId(), requestedId) || !java.util.List.of("Pending Approval", "Auto-accepted", "Approved").contains(rush.status()))
            throw RuleException.database("There is no open rush request for that tier on this test");
        if (approves()) {
            if (!"Pending Approval".equals(rush.status())) throw RuleException.database("This rush does not need approval");
            return;
        }
        if (replacement != null && !(Objects.equals(replacement.scheduleId(), requested.scheduleId()) && replacement.rushTat() > requested.rushTat()))
            throw RuleException.database("The replacement must be a slower tier on the same rush schedule, or standard turnaround");
    }

    /**
     * The values of the "Rush Not Accepted" email.
     *
     * @param sampleCode the sample's ID, or null before logging
     * @param newDue     the test's due date after the change, or null
     */
    public Map<String, Object> emailValues(String firstName, String testName, String sampleCode, String clientSampleId, String orderCode,
                                           BigDecimal oldFee, BigDecimal newFee, LocalDate newDue, String staffName, String siteName) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("first_name", firstName);
        v.put("test_name", testName);
        v.put("sample", sampleCode != null ? sampleCode : clientSampleId != null ? clientSampleId : "your sample");
        v.put("sample_logged", sampleCode != null ? sampleCode : clientSampleId != null ? clientSampleId : "(not yet logged)");
        v.put("client_sample_id", clientSampleId != null ? clientSampleId : "none");
        v.put("order_code", orderCode);
        v.put("requested_tier", requested.name());
        v.put("new_tier", replacement != null ? replacement.name() + " rush" : "standard turnaround");
        v.put("due_date", newDue == null ? "set when the sample is logged" : newDue.format(DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH)));
        v.put("old_fee", money(oldFee));
        v.put("new_fee", money(newFee));
        v.put("reason", reason);
        v.put("staff_name", staffName);
        v.put("site_name", siteName);
        return v;
    }

    /** to_char(x, 'FM999990.00'). */
    static String money(BigDecimal x) { return x == null ? null : x.setScale(2, RoundingMode.HALF_UP).toPlainString(); }
}
