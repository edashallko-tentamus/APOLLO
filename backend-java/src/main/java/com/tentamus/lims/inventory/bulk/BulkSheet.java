package com.tentamus.lims.inventory.bulk;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.excel.Xlsx;
import com.tentamus.lims.core.web.RuleException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * The export of a list to Excel and the preview of a sheet uploaded back (the Node backend's bulk.js): every change and
 * every error per row, compared with what is stored. Rows are matched on the list's key; rows without one are new.
 */
public final class BulkSheet {
    private static final Object ABSENT = new Object();   // the column is not in the file: the field is left as it is
    private static final Pattern ANALYTE = Pattern.compile("^(.+?)(?:\\s+([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)\\s*(\\S.*)?)?$");
    private final BulkKind kind;

    public BulkSheet(BulkKind kind) { this.kind = kind; }

    public byte[] export(List<Map<String, Object>> rows) {
        List<List<Object>> cells = new ArrayList<>();
        for (Map<String, Object> r : rows) cells.add(kind.cols().stream().map(c -> c.exported(r)).toList());
        return Xlsx.write(kind.title(), kind.cols().stream().map(BulkColumn::header).toList(), cells, kind.cols().stream().map(BulkColumn::width).toList());
    }

    /** One row of the preview; payload is what would be written (kept off the screen). */
    public record Row(Object row, String key, String action, Map<String, List<Object>> changes, List<String> errors, Map<String, Object> payload) {
        public Map<String, Object> shown() {
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("row", row); o.put("key", key); o.put("action", action); o.put("changes", changes); o.put("errors", errors);
            return o;
        }
    }

    public record Preview(List<Row> rows, List<String> unknownHeaders, int total) {}

    public Preview preview(Db db, List<Map<String, Object>> current, byte[] file, String fileName, String site) {
        Xlsx.Table t = Xlsx.read(file, fileName);
        Lookups L = Lookups.load(db, site);
        Set<String> known = kind.cols().stream().map(c -> c.header().toLowerCase()).collect(Collectors.toSet());
        List<String> unknown = t.headers().stream().filter(h -> !known.contains(h.toLowerCase())).toList();
        BulkColumn keyCol = kind.keyColumn();
        if (t.headers().stream().noneMatch(h -> h.equalsIgnoreCase(keyCol.header())))
            throw new RuleException("The sheet needs a \"" + keyCol.header() + "\" column (export the list first and edit that file)");
        Map<String, Map<String, Object>> index = new HashMap<>();
        for (Map<String, Object> r : current) index.put(Js.string(r.get(kind.key())).toLowerCase(), r);
        Set<String> seen = new HashSet<>();
        List<Row> out = new ArrayList<>();
        for (Map<String, Object> raw : t.rows()) {
            String keyVal = Js.string(cell(t, raw, keyCol) == ABSENT ? null : cell(t, raw, keyCol)).trim();
            Map<String, Object> existing = keyVal.isEmpty() ? null : index.get(keyVal.toLowerCase());
            Map<String, List<Object>> changes = new LinkedHashMap<>();
            List<String> errors = new ArrayList<>();
            Map<String, Object> payload = new LinkedHashMap<>();
            if (!keyVal.isEmpty() && seen.contains(keyVal.toLowerCase())) errors.add(keyCol.header() + " " + keyVal + " appears more than once in the file");
            if (!keyVal.isEmpty()) seen.add(keyVal.toLowerCase());
            if (existing == null) {
                if (!kind.creates()) errors.add(keyCol.header() + " " + (keyVal.isEmpty() ? "(empty)" : keyVal) + " was not found");
                else if (!keyVal.isEmpty() && kind.newKeyGenerated())
                    errors.add(keyCol.header() + " " + keyVal + " was not found (leave " + keyCol.header() + " empty to create a new row; the system gives it an ID)");
            }
            for (BulkColumn c : kind.cols()) {
                if (c.readOnly() || (c.field().equals(kind.key()) && kind.newKeyGenerated())) continue;
                Object v = cell(t, raw, c);
                if (v == ABSENT) continue;
                if (c.type().equals("analytes")) {
                    Parsed p = analytes(v, L);
                    if (p.error() != null) { errors.add(p.error()); continue; }
                    String cur = existing == null ? "" : Js.string(existing.get("analytes_text"));
                    @SuppressWarnings("unchecked") List<Map<String, Object>> list = (List<Map<String, Object>>) p.value();
                    String labels = list.stream().map(a -> a.get("label").toString()).collect(Collectors.joining(";"));
                    if (!canonAnalytes(labels).equals(canonAnalytes(cur))) { changes.put(c.header(), List.of(cur, Js.string(v))); payload.put("__analytes", list); }
                    continue;
                }
                Parsed p = parse(c, v, L);
                if (p.error() != null) { errors.add(p.error()); continue; }
                Object old = existing == null ? null : existing.get(c.field());
                if (!norm(c, p.value()).equals(norm(c, c.type().equals("list") ? BulkKinds.arr(old) : old))) {
                    Object was = existing == null ? "" : c.get() != null ? c.get().apply(existing) : Js.string(old);
                    @SuppressWarnings("unchecked") Object now = c.type().equals("list") ? (p.value() == null ? "" : String.join(", ", (List<String>) p.value())) : Js.string(v);
                    changes.put(c.header(), Arrays.asList(was, now));
                    payload.put(c.field(), p.value());
                }
            }
            if (existing != null) payload.put("id", existing.get("id"));
            String action = !errors.isEmpty() ? "Error" : existing == null ? "Create" : !changes.isEmpty() ? "Update" : "No change";
            out.add(new Row(raw.get("__row"), keyVal.isEmpty() ? "(new)" : keyVal, action, changes, errors, payload));
        }
        return new Preview(out, unknown, t.rows().size());
    }

    private static Object cell(Xlsx.Table t, Map<String, Object> raw, BulkColumn c) {
        for (String h : t.headers()) if (h.equalsIgnoreCase(c.header())) return raw.get(h);
        return ABSENT;
    }

    record Parsed(Object value, String error) {}

    /** How a cell is read back (bulk.js parseCell). */
    static Parsed parse(BulkColumn col, Object raw, Lookups L) {
        if (raw == null || (raw instanceof String s && s.trim().isEmpty())) return new Parsed(null, null);
        Object txt = raw instanceof String s ? s.trim() : raw;
        String h = col.header();
        switch (col.type()) {
            case "number" -> {
                double n = txt instanceof Number x ? x.doubleValue() : Js.toNumber(txt.toString().replaceAll("[,\\s]", ""));
                return Double.isNaN(n) ? new Parsed(null, h + ": \"" + Js.string(txt) + "\" is not a number") : new Parsed(n, null);
            }
            case "date" -> {
                if (txt instanceof Number n) return new Parsed(serialToDate(n.doubleValue()), null);
                Matcher m = Pattern.compile("^(\\d{4})-(\\d{1,2})-(\\d{1,2})").matcher(txt.toString());
                if (m.find()) return new Parsed(m.group(1) + "-" + pad(m.group(2)) + "-" + pad(m.group(3)), null);
                m = Pattern.compile("^(\\d{1,2})/(\\d{1,2})/(\\d{4})$").matcher(txt.toString());
                if (m.find()) return new Parsed(m.group(3) + "-" + pad(m.group(1)) + "-" + pad(m.group(2)), null);
                return new Parsed(null, h + ": \"" + Js.string(txt) + "\" is not a date (use YYYY-MM-DD)");
            }
            case "bool" -> { return new Parsed(Set.of("yes", "y", "true", "1", "x").contains(Js.string(txt).toLowerCase()), null); }
            case "list" -> {
                List<String> allowed = L.values(col.lookup());
                List<String> out = new ArrayList<>();
                for (String it : Js.string(txt).split("[;,]")) {
                    if (it.trim().isEmpty()) continue;
                    String hit = allowed.stream().filter(a -> a.equalsIgnoreCase(it.trim())).findFirst().orElse(null);
                    if (hit == null) return new Parsed(null, h + ": \"" + it.trim() + "\" is not one of " + String.join(", ", allowed));
                    out.add(hit);
                }
                return new Parsed(out, null);
            }
            case "choice" -> {
                List<String> allowed = L.values(col.lookup());
                String hit = allowed.stream().filter(a -> a.equalsIgnoreCase(Js.string(txt))).findFirst().orElse(null);
                return hit != null ? new Parsed(hit, null) : new Parsed(null, h + ": \"" + Js.string(txt) + "\" is not one of " + String.join(", ", allowed));
            }
            case "ref" -> {
                String hit = L.id(col.lookup(), Js.string(txt).trim());
                return hit != null ? new Parsed(hit, null) : new Parsed(null, h + ": \"" + Js.string(txt) + "\" was not found");
            }
            default -> { return new Parsed(Js.string(txt), null); }
        }
    }

    /** "Lead 1000 µg/mL; Cadmium 1000 µg/mL" (or just "Lead") -> [{analyte_id, concentration, concentration_unit, label}]. */
    static Parsed analytes(Object txt, Lookups L) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (txt == null || Js.string(txt).trim().isEmpty()) return new Parsed(out, null);
        for (String part : Js.string(txt).split(";")) {
            part = part.trim();
            if (part.isEmpty()) continue;
            Matcher m = ANALYTE.matcher(part);
            m.matches();
            String name = m.group(1).trim();
            String id = L.id("analytes", name);
            if (id == null) return new Parsed(null, "Analytes: \"" + name + "\" is not on the Analytes list");
            if (m.group(2) != null && m.group(3) == null) return new Parsed(null, "Analytes: give a unit after " + m.group(2) + " for " + name);
            Map<String, Object> a = new LinkedHashMap<>();
            a.put("analyte_id", id);
            a.put("concentration", m.group(2) == null ? null : Js.toNumber(m.group(2)));
            a.put("concentration_unit", m.group(3) == null ? null : m.group(3).trim());
            a.put("label", part);
            out.add(a);
        }
        return new Parsed(out, null);
    }

    /** For comparing what is stored with what was uploaded (bulk.js norm). */
    static String norm(BulkColumn col, Object v) {
        if (v == null || "".equals(v)) return "";
        return switch (col.type()) {
            case "number" -> Js.number(Js.toNumber(v));
            case "date" -> BulkKinds.d10(v);
            case "bool" -> Boolean.TRUE.equals(v) || (!(v instanceof Boolean) && !Js.string(v).isEmpty()) ? "Yes" : "No";
            case "list" -> BulkKinds.arr(v).stream().map(String::toLowerCase).sorted().collect(Collectors.joining(","));
            default -> Js.string(v).trim();
        };
    }

    private static String canonAnalytes(String x) {
        return Arrays.stream(x.toLowerCase().replaceAll("\\s+", " ").split(";")).map(String::trim).filter(s -> !s.isEmpty()).sorted().collect(Collectors.joining(";"));
    }

    /** Excel stores dates as days since 1899-12-30. */
    static String serialToDate(double n) {
        return Instant.ofEpochMilli(Math.round((n - 25569) * 864e5)).atOffset(ZoneOffset.UTC).toLocalDate().toString();
    }

    private static String pad(String s) { return s.length() == 1 ? "0" + s : s; }

    /** The lists and lookups a sheet's cells are checked against (bulk.js lookups). */
    record Lookups(Map<String, List<String>> values, Map<String, Map<String, String>> ids) {
        List<String> values(String name) { return values.getOrDefault(name, List.of()); }

        String id(String name, String text) {
            Map<String, String> m = ids.get(name);
            return m == null ? null : m.get(text.toLowerCase());
        }

        static Lookups load(Db db, String site) {
            Map<String, List<String>> v = new HashMap<>();
            for (String[] e : new String[][] {{"chemicalTypes", "chemical_type"}, {"conditions", "storage_condition"}, {"locationTypes", "location_type"},
                {"supplierTypes", "supplier_type"}, {"lotStatuses", "lot_status"}, {"subjects", "threshold_subject"}, {"ruleTypes", "threshold_type"},
                {"dimensions", "unit_dimension"}})
                v.put(e[0], db.rows("SELECT unnest(enum_range(NULL::" + e[1] + "))::text AS v").stream().map(r -> (String) r.get("v")).toList());
            v.put("forms", List.of("Solid", "Liquid"));
            v.put("activeInactive", List.of("Active", "Inactive"));
            v.put("appliesTo", List.of("Any", "Liquid", "Solid"));
            Map<String, Map<String, String>> ids = new HashMap<>();
            ids.put("suppliers", map(db.rows("SELECT id, supplier_code, supplier_name FROM supplier"), "supplier_code", "supplier_name"));
            ids.put("sites", map(db.rows("SELECT id, site_code FROM lab_site"), "site_code"));
            ids.put("units", map(db.rows("SELECT id, unit_code FROM unit_of_measure"), "unit_code"));
            ids.put("analytes", map(db.rows("SELECT id, analyte_code, analyte_name, report_name FROM analyte"), "analyte_code", "analyte_name", "report_name"));
            if (site != null) {
                ids.put("locations", map(db.rows("SELECT id, location_code FROM storage_location WHERE site_id = ?::uuid", site), "location_code"));
                ids.put("sampleLocations", map(db.rows("SELECT id, location_code FROM storage_location WHERE site_id = ?::uuid AND holds_samples", site), "location_code"));
            } else ids.put("locations", Map.of());
            return new Lookups(v, ids);
        }

        private static Map<String, String> map(List<Map<String, Object>> rows, String... keys) {
            Map<String, String> m = new HashMap<>();
            for (Map<String, Object> r : rows) for (String k : keys) {
                Object x = r.get(k);
                if (x != null && !"".equals(x)) m.put(Js.string(x).toLowerCase(), (String) r.get("id"));
            }
            return m;
        }
    }
}
