package com.tentamus.lims.testing.domain.calc;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * How a test rounds a result: half up (away from zero), to significant figures or decimal places, keeping trailing
 * zeros (2.5 to 3 significant figures is 2.50). Java's own copy of round_result and sig3, which stay in the database for
 * the bench's live results, the COA and the verification run.
 */
public record Rounding(String mode, int digits) {
    public static final String DECIMAL_PLACES = "Decimal places";

    public BigDecimal round(BigDecimal v) {
        if (v == null) return null;
        if (DECIMAL_PLACES.equals(mode)) return v.setScale(digits, RoundingMode.HALF_UP);
        if (v.signum() == 0) return BigDecimal.ZERO.setScale(Math.max(digits - 1, 0));
        return v.setScale(digits - 1 - magnitude(v), RoundingMode.HALF_UP);
    }

    /** 3 significant figures, as the COA prints amounts per serving (sig3). */
    public static BigDecimal sig3(BigDecimal v) {
        if (v == null || v.signum() == 0) return v;
        return v.setScale(2 - magnitude(v), RoundingMode.HALF_UP);
    }

    /** floor(log10(|v|)) for a non-zero value, exactly. */
    static int magnitude(BigDecimal v) { return v.precision() - v.scale() - 1; }

    /** The text PostgreSQL prints for a numeric (no exponent). */
    public static String text(BigDecimal v) { return v == null ? null : v.toPlainString(); }
}
