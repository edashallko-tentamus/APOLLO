package com.tentamus.lims.core.excel;

import java.math.BigDecimal;

/** Values written and compared as the Node backend's JavaScript does: Number(text), String(number), and so on. */
public final class Js {
    private Js() {}

    /** String(number) in JavaScript: 5, 5.5, 0.001 (never 5.0 or 5.50). */
    public static String number(Number n) {
        if (n instanceof BigDecimal d) return d.signum() == 0 ? "0" : d.stripTrailingZeros().toPlainString();
        double v = n.doubleValue();
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
}
