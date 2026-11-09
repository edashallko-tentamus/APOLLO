package com.tentamus.lims.equipment.domain;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;

/** Reading the loosely typed values of rows and requests (dates as text, numbers as text or numbers). */
public final class Fields {
    private Fields() {}

    public static String str(Object v) { return v == null ? null : v.toString(); }

    /** Text with surrounding spaces removed; empty becomes null (the database's NULLIF(btrim(x), '')). */
    public static String trimmed(Object v) {
        if (v == null) return null;
        String s = v.toString().strip();
        return s.isEmpty() ? null : s;
    }

    public static boolean blank(Object v) { return trimmed(v) == null; }

    public static LocalDate date(Object v) {
        if (blank(v)) return null;
        if (v instanceof LocalDate d) return d;
        String s = v.toString().strip();
        try { return LocalDate.parse(s.length() > 10 ? s.substring(0, 10) : s); } catch (RuntimeException e) { return null; }
    }

    /** A whole number, or null when absent or not a number (the database then answers for the type itself). */
    public static Integer integer(Object v) {
        if (blank(v)) return null;
        if (v instanceof Number n) return n.intValue();
        try { return Integer.valueOf(v.toString().strip()); } catch (NumberFormatException e) { return null; }
    }

    public static boolean bool(Object v) { return Boolean.TRUE.equals(v) || "true".equals(v) || "t".equals(v); }

    /** The row as it will be: the stored row with the changes laid over it (or just the changes for a new row). */
    public static Map<String, Object> after(Map<String, Object> stored, Map<String, Object> changes) {
        Map<String, Object> a = new LinkedHashMap<>(stored == null ? Map.of() : stored);
        a.putAll(changes);
        return a;
    }
}
