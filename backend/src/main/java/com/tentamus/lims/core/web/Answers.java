package com.tentamus.lims.core.web;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/** Small answer and request-reading helpers shared by the ported routes (what Node's routes write inline). */
public final class Answers {
    private Answers() {}

    /** What Node answers when a route returns nothing: {ok: true}. */
    public static Map<String, Object> ok() { return map("ok", true); }

    /** An ordered map from key, value pairs (values may be null, unlike Map.of). */
    public static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    /** body[key] when it is an array of objects, else []. */
    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> rows(Map<String, Object> body, String key) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (body.get(key) instanceof List<?> l) for (Object x : l) if (x instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
        return out;
    }

    /** The uuids of an array (others dropped), as (Array.isArray(a) ? a : []).filter(isUuid). */
    public static List<Object> uuids(Object o) {
        List<Object> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) if (RequestContext.isUuid(x)) out.add(x);
        return out;
    }

    /** A uuid when the value is one, else null. */
    public static Object uuidOrNull(Object v) { return RequestContext.isUuid(v) ? v : null; }

    /** A route's answer that may be null: Node writes the JSON text null. */
    public static ResponseEntity<Object> json(Object x) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(x == null ? "null" : x);
    }
}
