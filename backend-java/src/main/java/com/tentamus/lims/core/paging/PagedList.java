package com.tentamus.lims.core.paging;

import com.tentamus.lims.core.db.Db;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * One page of a list, as the Node backend's paging.js builds it: the count of every filter tab, a search across chosen
 * columns, the exact record when the search is an ID typed or scanned, and the requested page (50 rows by default,
 * at most 200). The list's own SQL is wrapped, so its columns are what filters, search and order use.
 *
 * <p>Filters, search columns, ids and order are written by the code, never taken from the request; only the search text
 * is the person's, and it is always a bound parameter.
 */
public final class PagedList {
    private static final int MAX = 200;
    private final String sql;
    private final List<Object> params = new ArrayList<>();
    private final LinkedHashMap<String, String> filters = new LinkedHashMap<>();
    private final List<String> search = new ArrayList<>();
    private final List<String> ids = new ArrayList<>();
    private String order = "ORDER BY created_at DESC";
    private String defaultFilter;
    private Function<String, Map<String, Object>> findExact;

    private PagedList(String sql, Object... params) {
        this.sql = sql;
        this.params.addAll(List.of(params));
    }

    public static PagedList of(String sql, Object... params) { return new PagedList(sql, params); }

    public PagedList filter(String key, String condition) { filters.put(key, condition); return this; }
    public PagedList defaultFilter(String key) { defaultFilter = key; return this; }
    public PagedList search(String... columns) { search.addAll(List.of(columns)); return this; }
    public PagedList ids(String... columns) { ids.addAll(List.of(columns)); return this; }
    public PagedList order(String clause) { order = clause; return this; }
    public PagedList findExact(Function<String, Map<String, Object>> f) { findExact = f; return this; }

    /** true when the screen asked for a page (callers that want the whole list send no "page"). */
    public static boolean wanted(Map<String, String> query) { return query.containsKey("page"); }

    public Map<String, Object> run(Db db, Map<String, String> query) {
        String q = query.getOrDefault("q", "").trim();
        int size = Math.min(MAX, Math.max(1, orDefault(parseInt(query.get("size")), 50)));
        List<String> keys = new ArrayList<>(filters.keySet());
        String f = keys.contains(query.get("f")) ? query.get("f") : (defaultFilter != null && keys.contains(defaultFilter) ? defaultFilter : (keys.isEmpty() ? null : keys.get(0)));
        String base = "WITH base AS (" + sql + ")";

        Map<String, Object> counts = new LinkedHashMap<>();
        if (!keys.isEmpty()) {
            StringBuilder sel = new StringBuilder();
            for (int i = 0; i < keys.size(); i++) sel.append(i == 0 ? "" : ", ").append("count(*) FILTER (WHERE ").append(filters.get(keys.get(i))).append(")::int AS \"").append(i).append('"');
            Map<String, Object> c = db.one(base + " SELECT " + sel + " FROM base", params.toArray());
            for (int i = 0; i < keys.size(); i++) counts.put(keys.get(i), c == null ? 0 : c.get(String.valueOf(i)));
        }
        Map<String, Object> exact = null;
        if (!q.isEmpty() && !ids.isEmpty()) {
            String where = String.join(" OR ", ids.stream().map(col -> "upper(replace(" + col + "::text, ' ', '')) = upper(replace(?, ' ', ''))").toList());
            List<Object> pp = new ArrayList<>(params);
            for (int i = 0; i < ids.size(); i++) pp.add(q);
            exact = db.one(base + " SELECT * FROM base WHERE " + where + " LIMIT 1", pp.toArray());
        }
        if (!q.isEmpty() && exact == null && findExact != null) exact = findExact.apply(q);

        List<String> where = new ArrayList<>();
        List<Object> p = new ArrayList<>(params);
        if (f != null && filters.get(f) != null) where.add("(" + filters.get(f) + ")");
        if (!q.isEmpty() && !search.isEmpty()) {
            String like = "%" + q.replaceAll("([\\\\%_])", "\\\\$1") + "%";
            where.add("(" + String.join(" OR ", search.stream().map(col -> col + "::text ILIKE ?").toList()) + ")");
            for (int i = 0; i < search.size(); i++) p.add(like);
        }
        String w = where.isEmpty() ? "" : "WHERE " + String.join(" AND ", where);
        int total = ((Number) db.one(base + " SELECT count(*)::int AS n FROM base " + w, p.toArray()).get("n")).intValue();
        int pages = Math.max(1, (int) Math.ceil(total / (double) size));
        int page = Math.min(pages, Math.max(1, orDefault(parseInt(query.get("page")), 1)));
        List<Map<String, Object>> rows = db.rows(base + " SELECT * FROM base " + w + " " + order + " LIMIT " + size + " OFFSET " + (page - 1) * size, p.toArray());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", rows);
        out.put("total", total);
        out.put("page", page);
        out.put("pages", pages);
        out.put("size", size);
        out.put("filter", f);
        out.put("counts", counts);
        out.put("q", q);
        out.put("exact", exact);
        return out;
    }

    /** JavaScript parseInt: leading digits, else null. */
    static Integer parseInt(String s) {
        if (s == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("^\\s*([+-]?\\d+)").matcher(s);
        if (!m.find()) return null;
        try { return Integer.parseInt(m.group(1)); } catch (NumberFormatException e) { return null; }
    }

    /** JavaScript (x || d): null and 0 fall back to d. */
    static int orDefault(Integer v, int d) { return v == null || v == 0 ? d : v; }
}
