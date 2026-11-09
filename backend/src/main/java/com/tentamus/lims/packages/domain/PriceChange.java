package com.tentamus.lims.packages.domain;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.PriceAdjustment;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * A dated change of a lab's catalogue prices by a percentage (PC-0001): Scheduled, then Applied on its date (or
 * Cancelled before). Replaces the rules of the database trigger catalog_price_change_rules and its CHECKs (migration 061);
 * the trigger keeps only the permission check. A scheduled change is never edited because Java writes nothing but its
 * status. Applying is Java's own apply_catalog_price_change when the change starts today (the database keeps that
 * function for the Node hourly job).
 */
public record PriceChange(String id, String code, String siteId, List<String> tests, BigDecimal pct, String rounding,
                          boolean includePackages, LocalDate effectiveOn, String status, String reason) {
    public static final String SCHEDULED = "Scheduled";

    /** A new change: today or later, some tests or every test, its own lab's tests, a percentage the tool allows, a reason. */
    public static void checkNew(LocalDate effectiveOn, LocalDate today, List<?> tests, boolean allOwnLab, BigDecimal pct, String reason) {
        PriceAdjustment.of(pct, null);
        if (reason == null || reason.strip().isEmpty()) throw RuleException.withCode("A Reason for Change is required for a price change", "23514");
        if (effectiveOn.isBefore(today)) throw RuleException.database("A price change starts today or later");
        if (tests != null && tests.isEmpty()) throw RuleException.database("Choose the tests, or every test");
        if (!allOwnLab) throw RuleException.database("A price change covers its own lab's tests only");
    }

    /** Cancelling: only a scheduled change (a cancelled one stays cancelled). */
    public void checkCancel() {
        if (!SCHEDULED.equals(status) && !"Cancelled".equals(status))
            throw RuleException.database("An " + status.toLowerCase() + " price change does not change");
    }

    public boolean isCancelled() { return "Cancelled".equals(status); }

    /** Applying it: a scheduled change on or after its date. */
    public PriceAdjustment toApply(LocalDate today) {
        if (!SCHEDULED.equals(status)) throw RuleException.database("Price change " + code + " is " + status.toLowerCase());
        if (effectiveOn.isAfter(today)) throw RuleException.database("Price change " + code + " starts on " + effectiveOn);
        return PriceAdjustment.of(pct, rounding);
    }

    /** The audit reason of every price it moves. */
    public String auditReason() { return "Price change " + code + ": " + reason; }
}
