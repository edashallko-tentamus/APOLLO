package com.tentamus.lims.core.db;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSetMetaData;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Reads and writes with positional parameters (?), returning rows as maps in the Node backend's JSON shape.
 * Inside a UnitOfWork the same calls run on the transaction's connection (Spring binds it to the thread).
 */
@Component
public class Db {
    private final JdbcTemplate jdbc;
    private final RowConverter rows;

    public Db(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.rows = new RowConverter(json);
    }

    public List<Map<String, Object>> rows(String sql, Object... params) {
        return jdbc.query(sql, rows, convert(params));
    }

    /** The first row, or null (the Node backend's c.db.one). */
    public Map<String, Object> one(String sql, Object... params) {
        List<Map<String, Object>> r = rows(sql, params);
        return r.isEmpty() ? null : r.get(0);
    }

    /**
     * A query's whole result as the Node backend answers it when a route returns t.query(...): {fields: [{name, dataTypeID}],
     * rows}. Only a few actions answer this way (receive, dispose...); the screens do not read it.
     */
    public Map<String, Object> raw(String sql, Object... params) {
        return jdbc.query(sql, rs -> {
            ResultSetMetaData md = rs.getMetaData();
            List<Map<String, Object>> fields = new ArrayList<>();
            for (int i = 1; i <= md.getColumnCount(); i++) {
                Map<String, Object> f = new LinkedHashMap<>();
                f.put("name", md.getColumnLabel(i));
                f.put("dataTypeID", typeOid(md.getColumnTypeName(i)));
                fields.add(f);
            }
            List<Map<String, Object>> out = new ArrayList<>();
            for (int n = 0; rs.next(); n++) out.add(rows.mapRow(rs, n));
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("fields", fields);
            r.put("rows", out);
            return r;
        }, convert(params));
    }

    private final Map<String, Long> oids = new ConcurrentHashMap<>();

    private Long typeOid(String typeName) {
        return oids.computeIfAbsent(typeName.replace("\"", ""), t -> {
            List<Long> r = jdbc.queryForList("SELECT oid::bigint FROM pg_type WHERE typname = ? LIMIT 1", Long.class, t);
            return r.isEmpty() ? 0L : r.get(0);
        });
    }

    public int update(String sql, Object... params) {
        return jdbc.update(sql, convert(params));
    }

    private static Object[] convert(Object[] params) {
        Object[] out = new Object[params.length];
        for (int i = 0; i < params.length; i++) out[i] = RowConverter.param(params[i]);
        return out;
    }
}
