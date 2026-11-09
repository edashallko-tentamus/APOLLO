package com.tentamus.lims.inventory.bulk;

import java.util.Map;
import java.util.function.Function;

/**
 * One column of an Excel export / upload.
 *
 * @param header  the column heading in the sheet
 * @param field   the database field it writes ("__analytes" for an item's analytes); null for export-only columns
 * @param type    how a cell is read back: text, number, date, bool, list, choice, ref, analytes
 * @param readOnly export only (never read back)
 * @param lookup  for ref: the lookup (code or name -> id); for list / choice: the allowed values
 * @param width   the column width in characters
 * @param get     the exported value; null exports the field as stored
 */
public record BulkColumn(String header, String field, String type, boolean readOnly, String lookup, int width, Function<Map<String, Object>, Object> get) {

    public static BulkColumn text(String header, String field, int width) { return new BulkColumn(header, field, "text", false, null, width, null); }

    public static BulkColumn of(String type, String header, String field, int width, Function<Map<String, Object>, Object> get) {
        return new BulkColumn(header, field, type, false, null, width, get);
    }

    /** A list, choice or ref column: its lookup is named. */
    public static BulkColumn looked(String type, String header, String field, String lookup, int width, Function<Map<String, Object>, Object> get) {
        return new BulkColumn(header, field, type, false, lookup, width, get);
    }

    public static BulkColumn readOnly(String header, String field, int width, Function<Map<String, Object>, Object> get) {
        return new BulkColumn(header, field, "text", true, null, width, get);
    }

    /** The value exported for a row. */
    public Object exported(Map<String, Object> row) {
        if (get != null) return get.apply(row);
        Object v = row.get(field);
        return v == null ? "" : v;
    }
}
