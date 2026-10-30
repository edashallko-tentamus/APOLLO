package com.tentamus.lims.pricing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.Map;

/**
 * A named rush fee schedule and its tiers (TAT, a percentage or flat surcharge, the approval default, escalation hours).
 * Replaces the CHECKs on rush_fee_schedule and rush_fee_tier (migration 061).
 */
public final class RushFeeSchedule {
    private RushFeeSchedule() {}

    /** The values about to be written to a schedule (a new one must have its name). */
    public static void checkSchedule(Map<String, Object> vals, boolean isNew) {
        if (isNew || vals.containsKey("schedule_name")) Amount.notBlank(vals.get("schedule_name"), true, "Give the rush fee schedule a name.");
    }

    /** The values about to be written to a tier. */
    public static void checkTier(Map<String, Object> vals, boolean isNew) {
        if (isNew || vals.containsKey("tier_name")) Amount.notBlank(vals.get("tier_name"), true, "Give the rush tier a name.");
        Amount.notNegative(vals.get("rush_tat"), "A rush TAT cannot be negative.");
        Amount.notNegative(vals.get("surcharge_value"), "A rush surcharge cannot be negative.");
        BigDecimal h = Amount.of(vals.get("escalation_hours"));
        if (h != null && h.signum() <= 0) throw RuleException.withCode("Escalation hours must be more than 0.", "23514");
    }
}
