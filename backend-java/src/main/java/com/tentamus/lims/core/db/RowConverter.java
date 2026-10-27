package com.tentamus.lims.core.db;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.RowMapper;

/**
 * Turns a database row into the same JSON values the Node backend sends, so the screens see no difference:
 * timestamps as UTC ISO strings with milliseconds, dates as YYYY-MM-DD, numbers as numbers, json as objects,
 * text/varchar/uuid arrays as arrays and every other array as its PostgreSQL text ("{a,b}").
 */
public final class RowConverter implements RowMapper<Map<String, Object>> {
    private static final DateTimeFormatter ISO_MILLIS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
    private static final Set<String> LIST_ARRAYS = Set.of("_text", "_varchar", "_uuid");
    private static final Set<String> NUMBERS = Set.of("int2", "int4", "int8", "oid", "float4", "float8", "numeric");
    private final ObjectMapper json;

    public RowConverter(ObjectMapper json) { this.json = json; }

    @Override
    public Map<String, Object> mapRow(ResultSet rs, int rowNum) throws SQLException {
        ResultSetMetaData md = rs.getMetaData();
        Map<String, Object> row = new LinkedHashMap<>();
        for (int i = 1; i <= md.getColumnCount(); i++) row.put(md.getColumnLabel(i), value(rs, i, md.getColumnTypeName(i)));
        return row;
    }

    Object value(ResultSet rs, int i, String type) throws SQLException {
        if (rs.getObject(i) == null) return null;
        switch (type) {
            case "timestamptz": return rs.getObject(i, OffsetDateTime.class).withOffsetSameInstant(ZoneOffset.UTC).format(ISO_MILLIS);
            case "timestamp": return rs.getObject(i, LocalDateTime.class).format(ISO_MILLIS);   // read as UTC, as the Node client does
            case "date": return rs.getString(i);
            case "bool": return rs.getBoolean(i);
            case "json": case "jsonb":
                try { return json.readTree(rs.getString(i)); } catch (Exception e) { return rs.getString(i); }
            default:
                if (NUMBERS.contains(type)) {
                    Object n = rs.getObject(i);
                    return n instanceof Number ? n : rs.getBigDecimal(i);
                }
                if (type.startsWith("_")) {
                    if (!LIST_ARRAYS.contains(type)) return rs.getString(i);
                    Array a = rs.getArray(i);
                    List<Object> out = new ArrayList<>();
                    for (Object o : (Object[]) a.getArray()) out.add(o == null ? null : o.toString());
                    return out;
                }
                return rs.getString(i);   // text, uuid, enums, time, interval
        }
    }

    /** A value for a query parameter, sent untyped as the Node client sends it (lists become PostgreSQL array text). */
    public static Object param(Object v) {
        if (v instanceof List<?> l) return toArrayLiteral(l);
        if (v instanceof Object[] a) return toArrayLiteral(Arrays.asList(a));
        if (v instanceof Map<?, ?> || v instanceof com.fasterxml.jackson.databind.JsonNode) return v.toString();
        return v;
    }

    static String toArrayLiteral(List<?> items) {
        StringBuilder b = new StringBuilder("{");
        for (int k = 0; k < items.size(); k++) {
            Object x = items.get(k);
            if (k > 0) b.append(',');
            if (x == null) b.append("NULL");
            else b.append('"').append(x.toString().replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
        }
        return b.append('}').toString();
    }
}
