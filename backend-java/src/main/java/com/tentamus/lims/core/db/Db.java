package com.tentamus.lims.core.db;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
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

    public int update(String sql, Object... params) {
        return jdbc.update(sql, convert(params));
    }

    private static Object[] convert(Object[] params) {
        Object[] out = new Object[params.length];
        for (int i = 0; i < params.length; i++) out[i] = RowConverter.param(params[i]);
        return out;
    }
}
