package com.tentamus.lims.core.calc;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.regex.Pattern;

/**
 * How a numeric result is reported and judged against its specification, worked out independently of the database (the
 * Node backend's verification.js reportValue, roundResult and conformance). The COA's release check and the workflow
 * verification both use it. Values are decimal text, so BigDecimal is exact here (the Node code used exact rationals).
 */
public final class ResultReporting {
    private ResultReporting() {}

    private static final Pattern PLAIN = Pattern.compile("^\\s*-?[0-9]*\\.?[0-9]+\\s*$");
    private static final Pattern DECIMAL = Pattern.compile("^([+-]?)(\\d*)(?:\\.(\\d*))?(?:[eE]([+-]?\\d+))?$");

    /** A specification's numeric limits (decimal text, either may be null); a spec with both null is a text limit. */
    public record Spec(String min, String max) {}

    /** Q.of(text): the decimal value of the text, or the error Node gave ("Not a number: ..."). */
    public static BigDecimal of(String s) {
        String t = s == null ? "" : s.trim();
        java.util.regex.Matcher m = DECIMAL.matcher(t);
        if (!m.matches() || (m.group(2).isEmpty() && (m.group(3) == null || m.group(3).isEmpty()))) throw new RuleException("Not a number: " + t);
        String digits = (m.group(2).isEmpty() ? "0" : m.group(2)) + (m.group(3) == null ? "" : m.group(3));
        int scale = (m.group(3) == null ? 0 : m.group(3).length()) - (m.group(4) == null ? 0 : Integer.parseInt(m.group(4)));
        BigDecimal v = new BigDecimal(new java.math.BigInteger(digits), scale);
        return "-".equals(m.group(1)) ? v.negate() : v;
    }

    /** Q.round(scale): rounded half away from zero to scale decimals (scale may be negative), as PostgreSQL prints numeric. */
    public static String round(BigDecimal v, int scale) {
        BigDecimal r = v.setScale(scale, RoundingMode.HALF_UP);
        if (scale >= 0) return r.toPlainString().replaceFirst("^-(0\\.?0*)$", "$1");
        return r.setScale(0, RoundingMode.UNNECESSARY).toPlainString();
    }

    /** floor(log10(|x|)), exactly. */
    static int log10Floor(BigDecimal v) {
        BigDecimal a = v.abs().stripTrailingZeros();
        return a.precision() - a.scale() - 1;
    }

    /** roundResult: decimal places, or significant figures (the default). */
    public static String roundResult(BigDecimal v, String mode, int digits) {
        if ("Decimal places".equals(mode)) return round(v, digits);
        if (v.signum() == 0) return round(BigDecimal.ZERO, Math.max(digits - 1, 0));
        return round(v, digits - 1 - log10Floor(v));
    }

    /**
     * A numeric result as reported for an analyte: "ND" below the LOD when the version reports so, "< LOQ" below the LOQ,
     * else rounded (the analyte's rounding, else the version's). Null for no value.
     */
    public static String reportValue(String value, String loq, String lod, String mode, Integer digits, boolean ndBelowLod, String versionMode, Integer versionDigits) {
        if (value == null) return null;
        BigDecimal v = of(value);
        if (ndBelowLod && lod != null && v.compareTo(of(lod)) < 0) return "ND";
        if (loq != null && v.compareTo(of(loq)) < 0) return "< " + loq;
        String m = mode == null || mode.isEmpty() ? versionMode : mode;
        Integer d = digits != null ? digits : versionDigits;
        return roundResult(v, m, d == null ? 0 : d);
    }

    /** Whether a reported result conforms to the specification (limits in the result's unit). */
    public static String conformance(Spec spec, List<String> foundValues, String reported, String valueText) {
        if (spec == null) return "No specification";
        if (spec.min() == null && spec.max() == null) {
            if (valueText == null) return "Not compared";
            return foundValues != null && foundValues.contains(valueText) ? "Does not conform" : "Conforms";
        }
        BigDecimal x;
        boolean below = false;
        if (reported != null && PLAIN.matcher(reported).matches()) x = of(reported);
        else if (reported != null && !reported.isEmpty() && (reported.startsWith("<") || reported.equals("ND"))) {
            below = true;
            String d = reported.replaceAll("[^0-9.]", "");
            x = d.isEmpty() ? BigDecimal.ZERO : of(d);
        } else return "Not compared";
        boolean out = (spec.max() != null && x.compareTo(of(spec.max())) > 0 && !below) || (spec.min() != null && (x.compareTo(of(spec.min())) < 0 || below));
        return out ? "Does not conform" : "Conforms";
    }
}
