package com.tentamus.lims.training.domain;

import java.math.BigDecimal;
import java.util.Map;

/**
 * A known value of a training sample's analyte, made into its specification: the min and max given, else the value
 * plus or minus the tolerance (start_competency_attempt's specification rows).
 */
public record KnownValue(String analyteId, BigDecimal min, BigDecimal max, String text) {

    public static KnownValue of(Map<String, Object> k) {
        BigDecimal v = dec(k.get("value")), tol = dec(k.get("tolerance_pct")), min = dec(k.get("min")), max = dec(k.get("max"));
        if (min == null && v != null && tol != null) min = v.multiply(BigDecimal.ONE.subtract(tol.movePointLeft(2)));
        if (max == null && v != null && tol != null) max = v.multiply(BigDecimal.ONE.add(tol.movePointLeft(2)));
        Object t = k.get("text");
        return new KnownValue(String.valueOf(k.get("analyte_id")), min, max, t == null || "".equals(t) ? null : t.toString());
    }

    private static BigDecimal dec(Object v) {
        if (v == null || "".equals(v.toString())) return null;
        return new BigDecimal(v.toString());
    }
}
