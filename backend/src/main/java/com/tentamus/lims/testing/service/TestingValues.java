package com.tentamus.lims.testing.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Request values read as the Node backend's JavaScript reads them (Number(), ||, new Date()), for the testing routes. */
final class TestingValues {
    private TestingValues() {}

    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    /** The request's Reason for Change, or the fallback when none was given. */
    static RequestContext withReason(RequestContext ctx, Map<String, Object> body, String fallback) {
        return ctx.withReason(truthy(body.get("reason")) ? str(body.get("reason")) : fallback);
    }

    /** Number(body[key]): NaN when absent, 0 for null; whole numbers as integers. */
    static Object jsNumber(Map<String, Object> m, String key) {
        if (!m.containsKey(key)) return Double.NaN;
        return whole(Js.toNumber(m.get(key)));
    }

    /** Number(v) || 1. */
    static Object orOne(Object v) {
        double d = Js.toNumber(v);
        return Double.isNaN(d) || d == 0 ? (Object) 1L : whole(d);
    }

    /** null for nothing ("", null, absent), else Number(v). */
    static Object num(Object v) { return v == null || "".equals(v) ? null : whole(Js.toNumber(v)); }

    static Object whole(double d) { return d == Math.rint(d) && Math.abs(d) < 1e15 ? (Object) (long) d : (Object) d; }

    static String replicateWord(Object reps) {
        if (reps instanceof Long n && n >= 1 && n <= 3) return List.of("single", "duplicate", "triplicate").get((int) (n - 1));
        return reps instanceof Double d ? (Double.isNaN(d) ? "NaN" : Js.number(d)) : Js.string(reps);
    }

    /** new Date(v).toISOString(), "now" for now, null for nothing (incubator times; JavaScript reads a time without a zone as the server's local time). */
    static String when(Object v) {
        if ("now".equals(v)) return ISO.format(Instant.now());
        if (v == null || "".equals(v)) return null;
        String s = Js.string(v).trim();
        try { return ISO.format(OffsetDateTime.parse(s).toInstant()); } catch (DateTimeParseException ignored) { }
        try { return ISO.format(Instant.parse(s)); } catch (DateTimeParseException ignored) { }
        try { return ISO.format(LocalDateTime.parse(s.replaceFirst(" ", "T")).atZone(ZoneId.systemDefault()).toInstant()); } catch (DateTimeParseException ignored) { }
        try { return ISO.format(LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant()); } catch (DateTimeParseException ignored) { }   // a date alone is UTC midnight
        if (v instanceof Number n) return ISO.format(Instant.ofEpochMilli(n.longValue()));
        // shortcut: other text JavaScript's Date accepts ("Oct 27 2026 08:12") is refused here; the screens send ISO times
        throw new RuleException("Not a date and time: " + Js.string(v));
    }

    static String toJson(ObjectMapper json, Object v) {
        try { return json.writeValueAsString(v); } catch (JsonProcessingException e) { throw new IllegalArgumentException(e); }
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> maps(Object o) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) out.add(x instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of());
        return out;
    }

    static List<Object> uuids(Object o) {
        List<Object> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) if (RequestContext.isUuid(x)) out.add(x);
        return out;
    }

    static Map<String, Object> ok() { return kv("ok", true); }

    /** A one-entry answer that may hold null (Map.of refuses it). */
    static Map<String, Object> kv(String k, Object v) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put(k, v);
        return m;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o) { return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }

    static String str(Object o) { return o == null ? "" : Js.string(o); }

    static Object or(Object v) { return truthy(v) ? v : null; }

    static boolean truthy(Object v) {
        return v != null && !Boolean.FALSE.equals(v) && !"".equals(v) && !(v instanceof Number n && (n.doubleValue() == 0 || Double.isNaN(n.doubleValue())));
    }
}
