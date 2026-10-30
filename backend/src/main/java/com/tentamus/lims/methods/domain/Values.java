package com.tentamus.lims.methods.domain;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/** Reading stored and sent values the way the database did (text, trimmed text, numbers, lists, settings in JSON). */
public final class Values {
    private static final Pattern NUMERIC = Pattern.compile("^\\s*-?[0-9]*\\.?[0-9]+\\s*$");

    private Values() {}

    public static String str(Object v) { return v == null ? null : v.toString(); }

    /** btrim, with an empty result as null (NULLIF(btrim(x), '')). */
    public static String trimmed(Object v) {
        if (v == null) return null;
        String s = v.toString().strip();
        return s.isEmpty() ? null : s;
    }

    public static boolean blank(Object v) { return trimmed(v) == null; }

    public static BigDecimal num(Object v) {
        if (v == null || "".equals(v)) return null;
        if (v instanceof BigDecimal b) return b;
        if (v instanceof JsonNode n) return n.isNumber() ? n.decimalValue() : num(n.isNull() ? null : n.asText());
        try { return new BigDecimal(v.toString().strip()); } catch (NumberFormatException e) { return null; }
    }

    public static Integer integer(Object v) {
        BigDecimal b = num(v);
        return b == null ? null : b.intValue();
    }

    public static boolean bool(Object v) { return Boolean.TRUE.equals(v) || "true".equals(v) || "t".equals(v); }

    /** A text[] as the database or the screen gives it: a list, or array text "{a,b}". */
    public static List<String> list(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof List<?> l) { for (Object x : l) out.add(x == null ? null : x.toString()); return out; }
        if (v instanceof JsonNode n && n.isArray()) { n.forEach(x -> out.add(x.isNull() ? null : x.asText())); return out; }
        if (v == null) return out;
        String s = v.toString().strip();
        if (s.startsWith("{") && s.endsWith("}")) s = s.substring(1, s.length() - 1);
        if (s.isEmpty()) return out;
        StringBuilder cur = new StringBuilder();
        boolean quoted = false, esc = false;
        for (char ch : s.toCharArray()) {
            if (esc) { cur.append(ch); esc = false; }
            else if (ch == '\\') esc = true;
            else if (ch == '"') quoted = !quoted;
            else if (ch == ',' && !quoted) { out.add(cur.toString()); cur.setLength(0); }
            else cur.append(ch);
        }
        out.add(cur.toString());
        return out;
    }

    /** Trimmed, blanks dropped, duplicates dropped keeping the first place (the database's value-list tidy). */
    public static List<String> tidy(List<String> values) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String x : values) if (x != null && !x.strip().isEmpty()) out.add(x.strip());
        return new ArrayList<>(out);
    }

    // ---------------------------------------------------------------- settings (jsonb)
    /** c->>'k': the text of a setting, or null when absent or JSON null. */
    public static String text(JsonNode c, String k) {
        if (c == null || !c.isObject() || !c.has(k) || c.get(k).isNull()) return null;
        JsonNode n = c.get(k);
        return n.isValueNode() ? n.asText() : n.toString();
    }

    /** COALESCE(c->>'k', ''). */
    public static String textOr(JsonNode c, String k) {
        String t = text(c, k);
        return t == null ? "" : t;
    }

    /** jsonb_array_elements(COALESCE(c->'k', '[]')). */
    public static List<JsonNode> array(JsonNode c, String k) {
        List<JsonNode> out = new ArrayList<>();
        if (c != null && c.isObject() && c.get(k) != null && c.get(k).isArray()) c.get(k).forEach(out::add);
        return out;
    }

    /** jnum_ok: the setting is a number at least the minimum; when it is missing, ok only if not required. */
    public static boolean numOk(JsonNode p, String k, BigDecimal min, boolean required) {
        if (p == null || !p.isObject() || !p.has(k) || p.get(k).isNull() || "".equals(text(p, k))) return !required;
        JsonNode n = p.get(k);
        BigDecimal v = n.isNumber() ? n.decimalValue() : n.isTextual() && NUMERIC.matcher(n.asText()).matches() ? new BigDecimal(n.asText().strip()) : null;
        if (v == null) return false;
        return min == null || v.compareTo(min) >= 0;
    }

    public static boolean numOk(JsonNode p, String k) { return numOk(p, k, null, true); }

    public static boolean numOk(JsonNode p, String k, int min) { return numOk(p, k, BigDecimal.valueOf(min), true); }

    /** (p->>k)::numeric, null when it is not a number. */
    public static BigDecimal number(JsonNode p, String k) {
        String t = text(p, k);
        return t == null ? null : num(t);
    }

    public static Object get(Map<String, Object> row, String k) { return row == null ? null : row.get(k); }
}
