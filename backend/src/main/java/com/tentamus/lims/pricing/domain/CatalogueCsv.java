package com.tentamus.lims.pricing.domain;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** The test catalogue as a CSV download (all active tests, or only those shown in the public catalogue). */
public final class CatalogueCsv {
    public static final List<String> COLUMNS = List.of("test_code", "test_name", "description", "pricing_mode", "base_price", "prep_fee", "list_price",
        "analyte_count", "standard_tat", "tat_unit", "rush_schedule");

    private CatalogueCsv() {}

    public static String of(List<Map<String, Object>> rows) {
        StringBuilder out = new StringBuilder(String.join(",", COLUMNS));
        for (Map<String, Object> r : rows) out.append("\r\n").append(COLUMNS.stream().map(k -> cell(r.get(k))).collect(Collectors.joining(",")));
        return out.toString();
    }

    static String cell(Object v) {
        if (v == null) return "";
        String s = v instanceof BigDecimal d ? plain(d) : v.toString();
        return s.contains("\"") || s.contains(",") || s.contains("\n") ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
    }

    /** A number written as JavaScript writes it (180, not 180.00). */
    static String plain(BigDecimal d) {
        return d.signum() == 0 ? "0" : d.stripTrailingZeros().toPlainString();
    }
}
