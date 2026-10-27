package com.tentamus.lims.core.db;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The one place a feature inserts or updates rows of a table: only the columns its code lists may be written
 * (the request never chooses a column). It saves grid rows as the Node backend's upsertRows does: a row with an id is
 * an update of the listed columns it carries ("" means null); a row without one is an insert of its non-null values.
 *
 * <p>Today the database triggers stamp, version and audit each write. When they are removed, this class is where the
 * stamping, the version check and the audit row go.
 */
public final class RecordWriter {
    private static final Pattern IDENT = Pattern.compile("^[a-z_][a-z0-9_]*$");
    private final String table;
    private final List<String> editable;

    public RecordWriter(String table, List<String> editable) {
        if (!IDENT.matcher(table).matches() || !editable.stream().allMatch(c -> IDENT.matcher(c).matches()))
            throw new IllegalArgumentException("Table and column names must be plain identifiers");
        this.table = table;
        this.editable = List.copyOf(editable);
    }

    /** The editable values a row carries, with "" turned into null (the Node backend's pick()). */
    public Map<String, Object> pick(Map<String, Object> row) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String c : editable) if (row.containsKey(c)) out.put(c, "".equals(row.get(c)) ? null : row.get(c));
        return out;
    }

    /**
     * Saves grid rows. Returns one {id} per row written, null for an update whose row was not found, and nothing for an
     * update that changes no listed column.
     */
    public List<Map<String, Object>> upsert(Db db, List<Map<String, Object>> rows, Map<String, Object> fixed) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> vals = pick(row);
            if (row.get("id") != null) {
                if (vals.isEmpty()) continue;
                out.add(update(db, row.get("id").toString(), vals));
            } else {
                Map<String, Object> all = new LinkedHashMap<>(vals);
                all.putAll(fixed);
                out.add(insert(db, all, "id"));
            }
        }
        return out;
    }

    /** UPDATE of the given columns; returns {id} or null when the row does not exist. */
    public Map<String, Object> update(Db db, String id, Map<String, Object> vals) {
        List<String> cols = new ArrayList<>(vals.keySet());
        check(cols);
        List<Object> p = new ArrayList<>(vals.values());
        p.add(id);
        return db.one("UPDATE " + table + " SET " + String.join(", ", cols.stream().map(c -> c + " = ?").toList()) + " WHERE id = ? RETURNING id", p.toArray());
    }

    /** INSERT of the non-null values; returns the requested columns of the new row. */
    public Map<String, Object> insert(Db db, Map<String, Object> vals, String returning) {
        Map<String, Object> nn = new LinkedHashMap<>();
        vals.forEach((k, v) -> { if (v != null) nn.put(k, v); });
        List<String> cols = new ArrayList<>(nn.keySet());
        check(cols);
        String marks = String.join(", ", cols.stream().map(c -> "?").toList());
        return db.one("INSERT INTO " + table + " (" + String.join(", ", cols) + ") VALUES (" + marks + ") RETURNING " + returning, nn.values().toArray());
    }

    private void check(List<String> cols) {
        for (String c : cols) if (!IDENT.matcher(c).matches()) throw new IllegalArgumentException("Bad column " + c);
    }
}
