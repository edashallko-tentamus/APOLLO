package com.tentamus.lims.pricing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.math.RoundingMode;

/** Money and counts as the pricing rules read them from a request or a row. */
public final class Amount {
    private Amount() {}

    /** The value as a number; null for null or "" (an empty cell). */
    public static BigDecimal of(Object v) {
        if (v == null || "".equals(v)) return null;
        if (v instanceof BigDecimal d) return d;
        try { return new BigDecimal(v.toString().trim()); }
        catch (NumberFormatException e) { throw new RuleException("A value is in the wrong format: " + v); }
    }

    /** Rounded as PostgreSQL's round(x, digits) does (halves away from zero). */
    public static BigDecimal round(BigDecimal v, int digits) { return v.setScale(digits, RoundingMode.HALF_UP); }

    /** A former CHECK (... >= 0): refused with the given wording when the value is set and below zero. */
    public static void notNegative(Object v, String message) {
        BigDecimal d = of(v);
        if (d != null && d.signum() < 0) throw RuleException.withCode(message, "23514");
    }

    /** A former CHECK on a whole number of at least 1. */
    public static void atLeastOne(Object v, String message) {
        BigDecimal d = of(v);
        if (d != null && d.compareTo(BigDecimal.ONE) < 0) throw RuleException.withCode(message, "23514");
    }

    /** A former CHECK (btrim(x) <> ''): a set value that is blank is refused. */
    public static void notBlank(Object v, boolean required, String message) {
        if ((v == null && required) || (v != null && v.toString().strip().isEmpty())) throw RuleException.withCode(message, "23514");
    }
}
