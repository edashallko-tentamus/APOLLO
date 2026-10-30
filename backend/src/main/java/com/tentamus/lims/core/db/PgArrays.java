package com.tentamus.lims.core.db;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Enum arrays (Chemical Type, storage conditions) come from the database as Postgres array text such as
 * {Reagent,"Reference Standard"}. The inventory screens get them as lists, as the Node backend's fixArrays() sends them.
 */
public final class PgArrays {
    public static final Set<String> FIELDS = Set.of("chemical_types", "supported_conditions");

    private PgArrays() {}

    /** Turns every chemical_types / supported_conditions value in the answer (at any depth) into a list. */
    @SuppressWarnings("unchecked")
    public static <T> T fix(T x) {
        if (x instanceof List<?> l) for (Object o : l) fix(o);
        else if (x instanceof Map<?, ?> m) {
            for (Map.Entry<Object, Object> e : ((Map<Object, Object>) m).entrySet()) {
                if (FIELDS.contains(String.valueOf(e.getKey()))) e.setValue(parse(e.getValue()));
                else if (e.getValue() instanceof Map<?, ?> || e.getValue() instanceof List<?>) fix(e.getValue());
            }
        }
        return x;
    }

    /** Postgres array text to a list (lists and nulls pass unchanged). */
    public static Object parse(Object v) {
        if (v == null || v instanceof List<?>) return v;
        String s = v.toString();
        if (s.equals("{}")) return new ArrayList<>();
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean q = false;
        for (int i = 1; i < s.length() - 1; i++) {
            char ch = s.charAt(i);
            if (q) { if (ch == '\\') cur.append(s.charAt(++i)); else if (ch == '"') q = false; else cur.append(ch); }
            else if (ch == '"') q = true;
            else if (ch == ',') { out.add(cur.toString()); cur.setLength(0); }
            else cur.append(ch);
        }
        out.add(cur.toString());
        return out;
    }
}
