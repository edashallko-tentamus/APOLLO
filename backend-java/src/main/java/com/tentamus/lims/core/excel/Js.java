package com.tentamus.lims.core.excel;

import java.math.BigDecimal;

/** Values written and compared as the Node backend's JavaScript does: Number(text), String(number), and so on. */
public final class Js {
    private Js() {}

    /** String(number) in JavaScript: 5, 5.5, 0.001 (never 5.0 or 5.50). */
    public static String number(Number n) {
        if (n instanceof BigDecimal d) return d.signum() == 0 ? "0" : d.stripTrailingZeros().toPlainString();
        double v = n.doubleValue();
        if (Double.isNaN(v)) return "NaN";
        if (Double.isInfinite(v)) return v > 0 ? "Infinity" : "-Infinity";
        if (v == Math.rint(v) && Math.abs(v) < 1e21) return Long.toString((long) v);
        return BigDecimal.valueOf(v).stripTrailingZeros().toPlainString();
    }

    /** String(value): numbers as JavaScript writes them, null as "". */
    public static String string(Object v) {
        if (v == null) return "";
        return v instanceof Number n ? number(n) : v.toString();
    }

    /** Number(text) in JavaScript, as a double (NaN when it is not a number; "" and blanks are 0). */
    public static double toNumber(Object v) {
        if (v == null) return 0;
        if (v instanceof Number n) return n.doubleValue();
        if (v instanceof Boolean b) return b ? 1 : 0;
        String s = v.toString().trim();
        if (s.isEmpty()) return 0;
        try { return Double.parseDouble(s); } catch (NumberFormatException e) { return Double.NaN; }
    }

    /** JavaScript truthiness for a request or row value: null, "", false, 0 and NaN are false. */
    public static boolean truthy(Object v) {
        if (v == null || Boolean.FALSE.equals(v) || "".equals(v)) return false;
        if (v instanceof Number n) { double d = n.doubleValue(); return d != 0 && !Double.isNaN(d); }
        return true;
    }

    /** parseInt(v, 10): the leading whole number, or null for NaN. */
    public static Long parseInt(Object v) {
        if (v == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^\\s*([+-]?\\d+)").matcher(v instanceof Number n ? number(n) : v.toString());
        if (!m.find()) return null;
        try { return Long.parseLong(m.group(1)); } catch (NumberFormatException e) { return null; }
    }

    /** parseInt(v, 10) || d. */
    public static long intOr(Object v, long d) {
        Long n = parseInt(v);
        return n == null || n == 0 ? d : n;
    }

    /** The routes' num(): null for null, undefined and "", else Number(v) (NaN stays NaN). */
    public static Double num(Object v) {
        return v == null || "".equals(v) ? null : toNumber(v);
    }

    /** v || null. */
    public static Object orNull(Object v) { return truthy(v) ? v : null; }

    /** v || "". */
    public static Object orBlank(Object v) { return truthy(v) ? v : ""; }
}
