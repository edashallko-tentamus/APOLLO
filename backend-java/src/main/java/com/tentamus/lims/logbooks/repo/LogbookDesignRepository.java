package com.tentamus.lims.logbooks.repo;

import com.tentamus.lims.core.db.Db;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Repository;

/**
 * Reads and writes a logbook's design rows (the logbook, its fields, the equipment it covers) as column maps; the rules
 * are in the domain classes Logbook, LogbookField and CoveredEquipment.
 */
@Repository
public class LogbookDesignRepository {
    public Map<String, Object> logbook(Db d, Object id) { return d.one("SELECT * FROM logbook WHERE id = ?::uuid FOR UPDATE", id); }

    public boolean hasEntries(Db d, Object id) { return d.one("SELECT 1 AS x FROM logbook_entry WHERE logbook_id = ?::uuid LIMIT 1", id) != null; }

    public Map<String, Object> field(Db d, Object id, Object version) {
        return d.one("SELECT * FROM logbook_field WHERE id = ?::uuid AND version_id = ?::uuid FOR UPDATE", id, version);
    }

    public Map<String, Object> equipment(Db d, Object id) {
        return d.one("SELECT id, site_id, equipment_code, admin_status::text = 'Retired' AS retired FROM equipment WHERE id = ?::uuid", id);
    }

    public Map<String, Object> covered(Db d, Object id, Object logbook) {
        return d.one("SELECT * FROM logbook_equipment WHERE id = ?::uuid AND logbook_id = ?::uuid FOR UPDATE", id, logbook);
    }

    /** INSERT of the non-null columns, the first column given as a uuid; returns RETURNING's row when asked. */
    public Map<String, Object> insert(Db d, String table, String firstCol, Object first, Map<String, Object> cols, String returning) {
        List<String> keys = cols.keySet().stream().filter(k -> cols.get(k) != null).toList();
        List<Object> vals = new ArrayList<>(List.of(first));
        for (String k : keys) vals.add(cols.get(k));
        String sql = "INSERT INTO " + table + " (" + firstCol + keys.stream().map(k -> ", " + k).collect(Collectors.joining()) + ") VALUES (?::uuid" + ", ?".repeat(keys.size()) + ")";
        if (returning == null) { d.update(sql, vals.toArray()); return null; }
        return d.one(sql + " RETURNING " + returning, vals.toArray());
    }

    public void update(Db d, String table, Object id, Map<String, Object> cols) {
        if (cols.isEmpty()) return;
        List<Object> vals = new ArrayList<>(cols.values());
        vals.add(id);
        d.update("UPDATE " + table + " SET " + cols.keySet().stream().map(k -> k + " = ?").collect(Collectors.joining(", ")) + " WHERE id = ?::uuid", vals.toArray());
    }

    /** The stored row with the changes applied (what it will be). */
    public static Map<String, Object> after(Map<String, Object> before, Map<String, Object> changes) {
        Map<String, Object> a = before == null ? new LinkedHashMap<>() : new LinkedHashMap<>(before);
        a.putAll(changes);
        return a;
    }
}
