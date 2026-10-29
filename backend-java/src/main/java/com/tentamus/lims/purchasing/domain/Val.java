package com.tentamus.lims.purchasing.domain;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** Reads the stored values purchasing's domain objects are made from (rows come back as strings, numbers, lists). */
final class Val {
    private Val() {}

    static String str(Object o) { return o == null ? null : o.toString(); }

    static boolean blank(Object o) { return o == null || o.toString().strip().isEmpty(); }

    static BigDecimal dec(Object o) {
        if (o == null || "".equals(o)) return null;
        return o instanceof BigDecimal b ? b : new BigDecimal(o.toString());
    }

    static LocalDate date(Object o) {
        if (o == null || "".equals(o)) return null;
        return o instanceof LocalDate d ? d : LocalDate.parse(o.toString().substring(0, 10));
    }

    /** A uuid[] or enum[] value: a List, Postgres array text "{a,b}", or null (kept null: it means "every"). */
    static List<String> list(Object o) {
        if (o == null) return null;
        List<String> out = new ArrayList<>();
        if (o instanceof List<?> l) { for (Object x : l) if (x != null) out.add(x.toString()); return out; }
        String s = o.toString().replaceAll("^\\{|}$", "");
        for (String x : s.split(",")) { String t = x.replace("\"", "").strip(); if (!t.isEmpty()) out.add(t); }
        return out;
    }

    static String lower(String s) { return s == null ? "" : s.toLowerCase(); }
}
