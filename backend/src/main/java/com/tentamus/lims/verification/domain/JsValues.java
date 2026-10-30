package com.tentamus.lims.verification.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.excel.Js;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * JSON-shaped values handled as verification.js handles them: plain maps and lists (insertion order kept), JavaScript's
 * template text for a value, and "undefined" (a key JSON.stringify leaves out).
 */
public final class JsValues {
    private JsValues() {}

    /** JavaScript's undefined: a map entry holding it is left out when written as JSON. */
    public static final Object UNDEFINED = new Object() {
        @Override public String toString() { return "undefined"; }
    };
    private static final ObjectMapper JSON = new ObjectMapper();

    /** A database json value (or anything else) as plain maps, lists, strings, numbers and booleans. */
    public static Object plain(Object v) {
        if (!(v instanceof JsonNode n)) return v;
        if (n.isNull() || n.isMissingNode()) return null;
        if (n.isObject()) {
            Map<String, Object> m = new LinkedHashMap<>();
            for (Iterator<Map.Entry<String, JsonNode>> it = n.fields(); it.hasNext();) { Map.Entry<String, JsonNode> e = it.next(); m.put(e.getKey(), plain(e.getValue())); }
            return m;
        }
        if (n.isArray()) { List<Object> l = new ArrayList<>(); for (JsonNode x : n) l.add(plain(x)); return l; }
        if (n.isIntegralNumber() && n.canConvertToLong()) return n.asLong();
        if (n.isNumber()) return n.asDouble();
        if (n.isBoolean()) return n.asBoolean();
        return n.asText();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> map(Object v) {
        Object p = plain(v);
        return p instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    public static List<Object> list(Object v) {
        Object p = plain(v);
        return p instanceof List<?> l ? (List<Object>) l : new ArrayList<>();
    }

    /** `${v}` in JavaScript: numbers as JavaScript writes them, arrays joined with commas. */
    public static String str(Object v) {
        if (v == null) return "null";
        if (v instanceof Number n) return Js.number(n.doubleValue());
        if (v instanceof List<?> l) {
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < l.size(); i++) { if (i > 0) b.append(','); Object x = l.get(i); b.append(x == null || x == UNDEFINED ? "" : str(x)); }
            return b.toString();
        }
        if (v instanceof Map<?, ?>) return "[object Object]";
        return v.toString();
    }

    /** v || fallback, written as text. */
    public static String or(Object v, String fallback) { return Js.truthy(v) ? str(v) : fallback; }

    /** v ?? fallback, written as text. */
    public static String nn(Object v, String fallback) { return v == null || v == UNDEFINED ? fallback : str(v); }

    /** Number(v) (NaN for a value that is not a number). */
    public static double num(Object v) {
        if (v == null) return 0;
        if (v == UNDEFINED || v instanceof Map<?, ?>) return Double.NaN;
        if (v instanceof List<?> l) return l.isEmpty() ? 0 : l.size() == 1 ? num(l.get(0)) : Double.NaN;
        return Js.toNumber(v);
    }

    /** Number(v) || d. */
    public static double numOr(Object v, double d) { double x = num(v); return x == 0 || Double.isNaN(x) ? d : x; }

    /** A JSON-shaped value copied deeply (JSON.parse(JSON.stringify(x))). */
    @SuppressWarnings("unchecked")
    public static <T> T copy(T v) {
        if (v instanceof Map<?, ?> m) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : m.entrySet()) if (e.getValue() != UNDEFINED) out.put((String) e.getKey(), copy(e.getValue()));
            return (T) out;
        }
        if (v instanceof List<?> l) { List<Object> out = new ArrayList<>(); for (Object x : l) out.add(x == UNDEFINED ? null : copy(x)); return (T) out; }
        return v;
    }

    /** JSON.stringify(v): undefined entries left out. */
    public static String json(Object v) {
        try { return JSON.writeValueAsString(copy(v)); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** The database's number as JavaScript's Number would print it. */
    public static String number(Object v) { return v instanceof Number n ? Js.number(n.doubleValue()) : str(v); }

    /** pgList: an array, or PostgreSQL's array text "{a,b}", as a list of texts. */
    public static List<String> pgList(Object v) {
        List<String> out = new ArrayList<>();
        Object p = plain(v);
        if (p instanceof List<?> l) { for (Object x : l) out.add(x == null ? null : x.toString()); return out; }
        if (p == null || "{}".equals(p)) return out;
        for (String x : p.toString().replaceAll("^\\{|\\}$", "").split(",", -1)) out.add(x.replaceAll("^\"|\"$", ""));
        return out;
    }

    /** "0" padded to two digits (String(n).padStart(2, '0')). */
    public static String pad2(Object n) { String s = number(n); return s.length() < 2 ? "0".repeat(2 - s.length()) + s : s; }
}
