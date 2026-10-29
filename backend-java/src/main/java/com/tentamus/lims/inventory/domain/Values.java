package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.db.PgArrays;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Reading the loosely typed values of rows and requests (numbers as text or numbers, dates as text, arrays as Postgres text). */
public final class Values {
    private Values() {}

    public static String str(Object v) { return v == null ? null : v.toString(); }

    /** Text with surrounding spaces removed; empty becomes null (the database's NULLIF(btrim(x), '')). */
    public static String trimmed(Object v) {
        if (v == null) return null;
        String s = v.toString().strip();
        return s.isEmpty() ? null : s;
    }

    public static boolean blank(Object v) { return trimmed(v) == null; }

    public static BigDecimal dec(Object v) {
        if (v == null || "".equals(v)) return null;
        if (v instanceof BigDecimal b) return b;
        if (v instanceof Number n) return new BigDecimal(n.toString());
        try { return new BigDecimal(v.toString().strip()); } catch (NumberFormatException e) { return null; }
    }

    public static LocalDate date(Object v) {
        if (v == null || "".equals(v)) return null;
        if (v instanceof LocalDate d) return d;
        String s = v.toString();
        return LocalDate.parse(s.length() > 10 ? s.substring(0, 10) : s);
    }

    public static boolean bool(Object v) { return Boolean.TRUE.equals(v) || "true".equals(v) || "t".equals(v); }

    /** A list given as a list or as Postgres array text. */
    public static List<String> list(Object v) {
        Object p = PgArrays.parse(v);
        List<String> out = new ArrayList<>();
        if (p instanceof List<?> l) for (Object o : l) if (o != null) out.add(o.toString());
        return out;
    }

    /** 1000.0000 -> 1000, 10.5000 -> 10.5 (the database's fmt_num). */
    public static String fmt(BigDecimal n) {
        if (n == null) return null;
        String s = n.toPlainString();
        return s.contains(".") ? s.replaceAll("0+$", "").replaceAll("\\.$", "") : s;
    }

    static Object get(Map<String, Object> m, String k) { return m == null ? null : m.get(k); }
}
