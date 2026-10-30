package com.tentamus.lims.logbooks.service;

import com.tentamus.lims.inventory.domain.Units;
import com.tentamus.lims.inventory.repo.UnitRepository;
import com.tentamus.lims.logbooks.domain.CoveredEquipment;
import com.tentamus.lims.logbooks.domain.Logbook;
import com.tentamus.lims.logbooks.domain.LogbookField;
import com.tentamus.lims.logbooks.repo.LogbookDesignRepository;
import static com.tentamus.lims.core.web.Answers.*;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.postgresql.util.PSQLException;
import org.springframework.stereotype.Service;

/**
 * Electronic logbooks: the lab's logbooks and what is due; a logbook's page (entries, recording entries in a grid
 * signed once, its design versions and the equipment it covers); an entry's page (values, its failure and what it
 * flags, corrections, return, void); QA's Logbook review; the equipment flags, lot entries and aliquots of a batch in
 * QC Review; logbook entries on the equipment and lot pages. Every rule lives in the database.
 */
@Service
public class LogbooksService {
    private static final String ENTRY_COLS = """
        e.id, e.entry_code, e.logbook_id, e.version_id, e.site_id, e.entry_at, e.entry_local, e.equipment_id, e.lot_id, e.sample_id, e.entry_values,
        e.result, to_jsonb(e.problems) AS problems, e.failure_reason, e.valid_until, e.status, e.approved_by, e.approved_at, e.review_id, e.approved_in_batch_id,
        e.returned_note, e.void_reason, e.created_lot_id, e.created_at, e.created_by, e.modified_at, e.record_version, e.recorded_signature_id,
        e.logbook_code, e.logbook_name, e.kind, e.subject, e.review_frequency, e.review_route, e.signing, e.version_no, e.site_code, e.equipment_code, e.equipment_name,
        e.lot_code, e.lot_name, e.sample_code, e.recorded_by_name, e.modified_by_name, e.approved_by_name, e.review_due, e.overdue, e.expired,
        e.approved_in_batch_code, e.created_lot_code,
        (SELECT jsonb_build_object('kind', x.sensor_kind, 'start', x.period_start, 'end', x.period_end, 'summary', x.sensor_summary, 'link_id', x.sensor_link_id,
            'sensor', (SELECT s.external_id || COALESCE(' ' || s.sensor_name, '') FROM sensor_link s WHERE s.id = x.sensor_link_id))
           FROM logbook_entry x WHERE x.id = e.id AND x.source = 'Sensor feed') AS sensor""";
    private static final List<String> SETTINGS = List.of("logbook_name", "kind", "subject", "entry_frequency", "review_frequency", "signing", "review_route", "validity_hours",
        "creates_lot", "lot_name", "lot_unit", "description", "status");
    private static final List<String> FIELD_COLS = List.of("field_key", "label", "field_type", "unit", "limit_min", "limit_max", "equipment_limits", "choices", "required",
        "formula", "publish", "help", "sort_order", "status");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern LOCAL = Pattern.compile("^(\\d{4}-\\d{2}-\\d{2})[ T](\\d{1,2}):(\\d{2})");
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final ObjectMapper json;
    private final LogbookDesignRepository design;
    private final UnitRepository units;

    public LogbooksService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, ObjectMapper json, LogbookDesignRepository design, UnitRepository units) {
        this.design = design;
        this.units = units;
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.json = json;
    }

    // ---------------------------------------------------------------- helpers
    private Map<String, Object> perms(RequestContext ctx, String site) {
        UserAccess a = access.load(ctx.userId());
        return map("can_design", a.can("logbook.design", site), "can_record", a.can("logbook.record", site), "can_review", a.can("logbook.review", site));
    }

    private String toJson(Object v) {
        try { return json.writeValueAsString(v); } catch (JsonProcessingException e) { throw new IllegalArgumentException(e); }
    }

    private <T> T signedOrNot(boolean sign, RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return sign ? signatures.signed(ctx, body, new SignatureService.Meaning(meaning, action, "Logbooks"), work) : uow.run(ctx, work);
    }

    private Map<String, Object> logbookOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Logbook not found");
        Map<String, Object> l = db.one("SELECT * FROM logbook_view WHERE id = ?::uuid", id);
        if (l == null) throw new RuleException("Logbook not found");
        access.checkSite(ctx, (String) l.get("site_id"));
        return l;
    }

    private Map<String, Object> entryOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Entry not found");
        Map<String, Object> e = db.one("SELECT " + ENTRY_COLS + " FROM logbook_entry_view e WHERE e.id = ?::uuid", id);
        if (e == null) throw new RuleException("Entry not found");
        access.checkSite(ctx, (String) e.get("site_id"));
        return new LinkedHashMap<>(e);
    }

    private static List<Map<String, Object>> copies(List<Map<String, Object>> rows) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) out.add(new LinkedHashMap<>(r));
        return out;
    }

    /** A field's choices as a list (text[] read back as a list or as Postgres array text). */
    private static Object choicesOf(Object c) {
        if (c instanceof List<?> l) return l;
        if (!Js.truthy(c)) return null;
        List<String> out = new ArrayList<>();
        for (String s : Js.string(c).replaceAll("^\\{|\\}$", "").split(",", -1)) out.add(s.replaceAll("^\"|\"$", ""));
        return out;
    }

    private List<Map<String, Object>> fieldsOf(List<Object> versionIds, boolean withChoices) {
        List<Object> ids = versionIds.stream().filter(Objects::nonNull).toList();
        List<Map<String, Object>> rows = copies(db.rows("""
            SELECT id, version_id, field_key, label, field_type, unit, limit_min, limit_max, equipment_limits, choices, required, formula,
                publish, help, sort_order FROM logbook_field WHERE version_id = ANY(?::uuid[]) AND status = 'Active' ORDER BY sort_order, label""", ids));
        if (withChoices) for (Map<String, Object> f : rows) f.put("choices", choicesOf(f.get("choices")));
        return rows;
    }

    /** An entry's values as plain Java values (jsonb is read back as a JSON tree). */
    @SuppressWarnings("unchecked")
    private Map<String, Object> values(Object v) {
        if (v instanceof JsonNode n && n.isObject()) return json.convertValue(n, Map.class);
        if (v instanceof Map<?, ?> m) return (Map<String, Object>) m;
        return null;
    }

    private static boolean idField(Map<String, Object> f) { return List.of("Equipment", "Lot").contains(f.get("field_type")); }

    /** Equipment and Lot fields hold ids: their codes for the screen (entry.display). */
    private void decorate(List<Map<String, Object>> entries, List<Map<String, Object>> fields) {
        Set<String> ids = new LinkedHashSet<>();
        for (Map<String, Object> e : entries) {
            Map<String, Object> vals = values(e.get("entry_values"));
            for (Map<String, Object> f : fields) if (idField(f) && vals != null && Js.truthy(vals.get(f.get("field_key")))) ids.add(String.valueOf(vals.get(f.get("field_key"))));
        }
        List<Object> list = ids.stream().filter(RequestContext::isUuid).collect(Collectors.toList());
        Map<String, Object> names = new HashMap<>();
        if (!list.isEmpty()) for (Map<String, Object> x : db.rows("""
            SELECT id, equipment_code || ' ' || equipment_name AS t FROM equipment WHERE id = ANY(?::uuid[])
            UNION ALL SELECT id, lot_code || COALESCE(' ' || item_name, '') FROM inventory_lot WHERE id = ANY(?::uuid[])""", list, list)) names.put(String.valueOf(x.get("id")), x.get("t"));
        for (Map<String, Object> e : entries) {
            Map<String, Object> display = new LinkedHashMap<>();
            Map<String, Object> vals = values(e.get("entry_values"));
            for (Map<String, Object> f : fields) {
                if (!Objects.equals(f.get("version_id"), e.get("version_id"))) continue;
                Object v = vals == null ? null : vals.get(f.get("field_key"));
                if (v == null) continue;
                Object name = names.get(String.valueOf(v));
                display.put((String) f.get("field_key"), idField(f) ? (Js.truthy(name) ? name : v) : v);
            }
            e.put("display", display);
        }
    }

    private static String fmtN(Number n) {
        double v = n.doubleValue();
        if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v != 0)) return Js.toExponential(v, 3);
        return Js.number(Double.parseDouble(Js.toPrecision(v, 6)));
    }

    /** String(v) in JavaScript, for a value read from JSON. */
    private static String text(Object v) {
        if (v instanceof List<?> l) return l.stream().map(x -> x == null ? "" : text(x)).collect(Collectors.joining(","));
        if (v instanceof Map<?, ?>) return "[object Object]";
        return v instanceof Number n ? Js.number(n) : String.valueOf(v);
    }

    @SuppressWarnings("unchecked")
    private static String summary(Map<String, Object> e, List<Map<String, Object>> fields) {
        Map<String, Object> display = (Map<String, Object>) e.get("display");
        List<String> parts = new ArrayList<>();
        for (Map<String, Object> f : fields) {
            if (!Objects.equals(f.get("version_id"), e.get("version_id")) || display == null || !display.containsKey(f.get("field_key"))) continue;
            Object v = display.get(f.get("field_key"));
            boolean num = v instanceof Number;
            parts.add(f.get("label") + ": " + (num ? fmtN((Number) v) : text(v)) + (Js.truthy(f.get("unit")) && num ? " " + f.get("unit") : ""));
        }
        return String.join("; ", parts);
    }

    /** The database's own message for an error (what the Node client reports). */
    private static String message(RuntimeException e) {
        if (e instanceof RuleException) return e.getMessage();
        PSQLException pg = ApiExceptionHandler.find(e);
        return pg != null && pg.getServerErrorMessage() != null ? pg.getServerErrorMessage().getMessage() : String.valueOf(e.getMessage());
    }

    // ---------------------------------------------------------------- the lab's logbooks and what is due
    public Map<String, Object> list(RequestContext ctx) {
        String site = access.currentSite(ctx);
        Map<String, Object> toReview = db.one("""
            SELECT count(*)::int AS n, count(*) FILTER (WHERE overdue)::int AS late FROM logbook_entry_view
             WHERE site_id = ?::uuid AND status IN ('Recorded','Returned') AND review_route = 'Logbook'""", site);
        Map<String, Object> out = map("rows", db.rows("SELECT * FROM logbook_view WHERE site_id = ?::uuid ORDER BY status, logbook_code", site),
            "due", db.rows("SELECT * FROM logbook_due_view WHERE site_id = ?::uuid AND due ORDER BY logbook_code, equipment_code", site),
            "to_review", toReview.get("n"), "overdue", toReview.get("late"));
        out.putAll(perms(ctx, site));
        return out;
    }

    private static Map<String, Object> settingsOf(Map<String, Object> b) {
        Map<String, Object> o = new LinkedHashMap<>();
        for (String k : SETTINGS) if (b.containsKey(k)) o.put(k, "".equals(b.get(k)) ? null : b.get(k));
        if (o.containsKey("creates_lot")) { Object v = o.get("creates_lot"); o.put("creates_lot", Boolean.TRUE.equals(v) || "true".equals(v) || "yes".equals(v)); }
        if (o.get("validity_hours") != null) o.put("validity_hours", Js.toNumber(o.get("validity_hours")));
        return o;
    }

    public Map<String, Object> create(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> o = settingsOf(body);
        if (Js.string(o.get("logbook_name")).trim().isEmpty()) throw new RuleException("Name the logbook");
        o.remove("status");
        Map<String, Object> cols = Logbook.checked(null, LogbookDesignRepository.after(Map.of("site_id", site), o), o, false, this::lotUnit);
        return uow.run(ctx.orReason("New logbook"), d -> design.insert(d, "logbook", "site_id", site, cols, "id, logbook_code"));
    }

    /** The lots' unit in the Units list's spelling (a quantity unit), or refused. */
    private String lotUnit(String code) { return units.load().canonical(code, Units.QUANTITY, "Unit of the lots it makes");
    }

    // ---------------------------------------------------------------- QA: Logbook review
    public Map<String, Object> review(RequestContext ctx) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = copies(db.rows("SELECT " + ENTRY_COLS + """
             FROM logbook_entry_view e WHERE e.site_id = ?::uuid AND e.status IN ('Recorded','Returned') AND e.review_route = 'Logbook'
             ORDER BY e.overdue DESC, e.logbook_code, e.entry_at""", site));
        List<Map<String, Object>> fields = fieldsOf(new ArrayList<>(rows.stream().map(x -> x.get("version_id")).collect(Collectors.toCollection(LinkedHashSet::new))), true);
        decorate(rows, fields);
        for (Map<String, Object> x : rows) x.put("summary", summary(x, fields));
        Map<String, Object> out = map("rows", rows, "me", ctx.userId());
        out.putAll(perms(ctx, site));
        return out;
    }

    public Map<String, Object> approveEntries(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Object> ids = uuids(body.get("ids"));
        if (ids.isEmpty()) throw new RuleException("Choose the entries to approve");
        return signatures.signed(ctx.withSite(site).orReason("Logbook entries approved by QA"), body,
            new SignatureService.Meaning("Approved by", "QA approval of " + ids.size() + " logbook entr" + (ids.size() == 1 ? "y" : "ies"), "Logbooks"),
            d -> map("approved", d.one("SELECT approve_logbook_entries(?::uuid[], ?) AS n", ids, Js.orNull(body.get("comment"))).get("n")));
    }

    /** Stability excursions of a study. */
    public Map<String, Object> excursions(RequestContext ctx, Map<String, String> query) {
        if (!RequestContext.isUuid(query.get("study"))) return map("rows", List.of());
        Map<String, Object> st = db.one("SELECT id, site_id FROM stability_study WHERE id = ?::uuid", query.get("study"));
        if (st == null) throw new RuleException("Study not found");
        access.checkSite(ctx, (String) st.get("site_id"));
        return map("rows", db.rows("""
            SELECT logbook_entry_id, entry_code, logbook_name, equipment_id, equipment_code, equipment_name, entry_at, to_jsonb(problems) AS problems, failure_reason,
                status, storage_code, rack_code, condition_name, window_end FROM stability_excursion_view WHERE study_id = ?::uuid ORDER BY entry_at DESC""", st.get("id")));
    }

    // ---------------------------------------------------------------- a logbook
    public Map<String, Object> logbook(RequestContext ctx, String id, Map<String, String> q) {
        Map<String, Object> l = logbookOf(ctx, id);
        List<Map<String, Object>> versions = db.rows("""
            SELECT v.*, au.full_name AS approved_by_name, cu.full_name AS created_by_name FROM logbook_version v
              LEFT JOIN app_user au ON au.id = v.approved_by JOIN app_user cu ON cu.id = v.created_by WHERE v.logbook_id = ?::uuid ORDER BY v.version_no DESC""", l.get("id"));
        Map<String, Object> eff = versions.stream().filter(v -> "Effective".equals(v.get("status"))).findFirst().orElse(null);
        Map<String, Object> draft = versions.stream().filter(v -> "Draft".equals(v.get("status"))).findFirst().orElse(null);
        List<String> cond = new ArrayList<>(List.of("e.logbook_id = ?::uuid"));
        List<Object> args = new ArrayList<>(List.of(l.get("id")));
        if (q.get("from") != null && DATE.matcher(q.get("from")).matches()) { args.add(q.get("from")); cond.add("left(e.entry_local, 10) >= ?"); }
        if (q.get("to") != null && DATE.matcher(q.get("to")).matches()) { args.add(q.get("to")); cond.add("left(e.entry_local, 10) <= ?"); }
        if (RequestContext.isUuid(q.get("equipment"))) { args.add(q.get("equipment")); cond.add("e.equipment_id = ?::uuid"); }
        String status = q.get("status");
        if (status != null && !status.isEmpty() && !status.equals("All")) { args.add(status); cond.add("e.status = ?"); }
        else if (status == null || status.isEmpty()) cond.add("e.status <> 'Voided'");
        List<Map<String, Object>> entries = copies(db.rows("SELECT " + ENTRY_COLS + " FROM logbook_entry_view e WHERE " + String.join(" AND ", cond) + " ORDER BY e.entry_at DESC LIMIT 500", args.toArray()));
        Object siteId = l.get("site_id");
        List<Map<String, Object>> fields = fieldsOf(new ArrayList<>(java.util.Arrays.asList(eff == null ? null : eff.get("id"), draft == null ? null : draft.get("id"))), true);
        Set<Object> older = new LinkedHashSet<>();
        for (Map<String, Object> e : entries) {
            Object v = e.get("version_id");
            if (!Objects.equals(v, eff == null ? null : eff.get("id")) && !Objects.equals(v, draft == null ? null : draft.get("id"))) older.add(v);
        }
        List<Map<String, Object>> oldFields = older.isEmpty() ? List.of() : fieldsOf(new ArrayList<>(older), true);
        List<Map<String, Object>> all = new ArrayList<>(fields);
        all.addAll(oldFields);
        decorate(entries, all);
        Map<String, Object> out = map("logbook", l, "versions", versions, "effective_id", eff == null ? null : eff.get("id"), "draft_id", draft == null ? null : draft.get("id"),
            "fields", fields, "old_fields", oldFields,
            "equipment", db.rows("""
                SELECT le.id, le.equipment_id, le.limits, le.notes, le.status, e.equipment_code, e.equipment_name, e.admin_status::text AS admin_status, t.type_name,
                    sc.condition_name, sc.temperature_c, sc.temperature_tol, sc.humidity_pct, sc.humidity_tol
                  FROM logbook_equipment le JOIN equipment e ON e.id = le.equipment_id JOIN equipment_type t ON t.id = e.equipment_type_id
                  LEFT JOIN stability_chamber ch ON ch.equipment_id = e.id AND ch.status = 'Active' LEFT JOIN stability_condition sc ON sc.id = ch.condition_id
                 WHERE le.logbook_id = ?::uuid AND le.status = 'Active' ORDER BY e.equipment_name""", l.get("id")),
            "entries", entries,
            "due", db.rows("SELECT * FROM logbook_due_view WHERE logbook_id = ?::uuid ORDER BY equipment_code", l.get("id")),
            "problems", draft == null ? List.of() : db.rows("SELECT * FROM logbook_version_problems(?::uuid)", draft.get("id")),
            "opts", map("equipment", db.rows("""
                    SELECT e.id, e.equipment_code, e.equipment_name, e.type_name, e.availability, e.calibration_status FROM equipment_view e
                     WHERE e.site_id = ?::uuid AND e.admin_status <> 'Retired' ORDER BY e.equipment_name""", siteId),
                "lots", db.rows("""
                    SELECT l.id, l.lot_code, COALESCE(l.item_name, '') AS item_name, l.expiration_date, l.status::text AS status FROM inventory_lot l
                     WHERE l.site_id = ?::uuid AND l.receipt_status = 'Received' AND l.status = 'Available' AND NOT ('Consumable' = ANY(l.chemical_types) AND cardinality(l.chemical_types) = 1)
                     ORDER BY l.item_name, l.lot_code""", siteId)));
        out.putAll(perms(ctx, (String) siteId));
        return out;
    }

    public Map<String, Object> saveSettings(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> l = logbookOf(ctx, id);
        Map<String, Object> o = settingsOf(body);
        if (o.isEmpty()) return ok();
        return uow.run(ctx.orReason("Logbook settings changed"), d -> {
            Map<String, Object> before = design.logbook(d, l.get("id"));
            design.update(d, "logbook", l.get("id"), Logbook.checked(before, LogbookDesignRepository.after(before, o), o, design.hasEntries(d, l.get("id")), this::lotUnit));
            return ok();
        });
    }

    public Map<String, Object> newVersion(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> l = logbookOf(ctx, id);
        return uow.run(ctx.orReason("New logbook version"), d -> map("id", d.one("SELECT new_logbook_version(?::uuid, ?) AS id", l.get("id"), Js.orNull(body.get("summary"))).get("id")));
    }

    public Map<String, Object> saveFields(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> l = logbookOf(ctx, id);
        Map<String, Object> draft = db.one("SELECT id FROM logbook_version WHERE logbook_id = ?::uuid AND status = 'Draft'", l.get("id"));
        if (draft == null) throw new RuleException("Start a new version first: the Effective design is locked");
        List<Map<String, Object>> rows = rows(body, "rows");
        return uow.run(ctx.orReason("Logbook design changed"), d -> {
            for (Map<String, Object> x : rows) {
                Map<String, Object> o = new LinkedHashMap<>();
                for (String k : FIELD_COLS) if (x.containsKey(k)) o.put(k, "".equals(x.get(k)) ? null : x.get(k));
                if (o.get("choices") != null) {
                    Object c = o.get("choices");
                    List<?> list = c instanceof List<?> l2 ? l2 : List.of(Js.string(c).split("[;,]", -1));
                    o.put("choices", "{" + list.stream().map(s -> String.valueOf(s).trim()).filter(s -> !s.isEmpty()).map(s -> "\"" + s.replaceAll("[\"\\\\]", "") + "\"")
                        .collect(Collectors.joining(",")) + "}");
                }
                for (String k : List.of("equipment_limits", "required", "publish")) if (o.get(k) != null) { Object v = o.get(k); o.put(k, Boolean.TRUE.equals(v) || "true".equals(v) || "yes".equals(v)); }
                for (String k : List.of("limit_min", "limit_max", "sort_order")) if (o.get(k) != null) o.put(k, Js.toNumber(o.get(k)));
                if (Js.truthy(x.get("id"))) {
                    if (!RequestContext.isUuid(x.get("id"))) throw new RuleException("Unknown field");
                    if (o.isEmpty()) continue;
                    Map<String, Object> before = design.field(d, x.get("id"), draft.get("id"));
                    if (before == null) continue;   // not a field of this Draft: nothing to change, as the UPDATE's WHERE had it
                    design.update(d, "logbook_field", x.get("id"), LogbookField.checked(before, LogbookDesignRepository.after(before, o), o, (String) l.get("subject")));
                } else {
                    Map<String, Object> cols = LogbookField.checked(null, LogbookDesignRepository.after(Map.of("version_id", draft.get("id")), o), o, (String) l.get("subject"));
                    design.insert(d, "logbook_field", "version_id", draft.get("id"), cols, null);
                }
            }
            return map("saved", rows.size());
        });
    }

    public Map<String, Object> approveDesign(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> l = logbookOf(ctx, id);
        Map<String, Object> draft = db.one("SELECT id, version_no FROM logbook_version WHERE logbook_id = ?::uuid AND status = 'Draft'", l.get("id"));
        if (draft == null) throw new RuleException("There is no Draft to approve");
        return signatures.signed(ctx.orReason("Logbook design approved"), body,
            new SignatureService.Meaning("Approved by", "Design version " + Js.string(draft.get("version_no")) + " of " + l.get("logbook_code") + " " + l.get("logbook_name"), "Logbooks"),
            d -> { d.one("SELECT approve_logbook_version(?::uuid)", draft.get("id")); return ok(); });
    }

    private CoveredEquipment covered(Db d, Map<String, Object> l, Object equipmentId, Object limits) {
        Map<String, Object> e = design.equipment(d, equipmentId);
        if (e == null) throw RuleException.database("Equipment not found");
        return new CoveredEquipment((String) l.get("logbook_code"), (String) l.get("subject"), (String) l.get("site_id"), (String) e.get("equipment_code"),
            (String) e.get("site_id"), Boolean.TRUE.equals(e.get("retired")), json.valueToTree(limits));
    }

    public Map<String, Object> saveEquipment(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> l = logbookOf(ctx, id);
        List<Map<String, Object>> rows = rows(body, "rows");
        return uow.run(ctx.orReason("Equipment covered by the logbook changed"), d -> {
            for (Map<String, Object> x : rows) {
                Object lim = x.get("limits");
                String limits = lim instanceof Map<?, ?> || lim instanceof List<?> ? toJson(lim) : null;
                if (Js.truthy(x.get("id"))) {
                    if (!RequestContext.isUuid(x.get("id"))) throw new RuleException("Unknown row");
                    Map<String, Object> row = design.covered(d, x.get("id"), l.get("id"));
                    if (row != null && limits != null) covered(d, l, row.get("equipment_id"), lim).check(false);
                    List<String> sets = new ArrayList<>();
                    List<Object> vals = new ArrayList<>();
                    if (limits != null) { sets.add("limits = ?::jsonb"); vals.add(limits); }
                    if (x.containsKey("notes")) { sets.add("notes = ?"); vals.add(Js.orNull(x.get("notes"))); }
                    if (x.containsKey("status")) { sets.add("status = ?"); vals.add(x.get("status")); }
                    if (sets.isEmpty()) continue;
                    vals.add(x.get("id"));
                    vals.add(l.get("id"));
                    d.update("UPDATE logbook_equipment SET " + String.join(", ", sets) + " WHERE id = ?::uuid AND logbook_id = ?::uuid", vals.toArray());
                } else {
                    if (!RequestContext.isUuid(x.get("equipment_id"))) throw new RuleException("Choose the equipment");
                    covered(d, l, x.get("equipment_id"), limits == null ? Map.of() : lim).check(true);
                    d.update("INSERT INTO logbook_equipment (logbook_id, equipment_id, limits, notes) VALUES (?::uuid, ?::uuid, COALESCE(?::jsonb, '{}'), ?)",
                        l.get("id"), x.get("equipment_id"), limits, Js.orNull(x.get("notes")));
                }
            }
            return map("saved", rows.size());
        });
    }

    // ---------------------------------------------------------------- recording entries: one save (and one signature) for the rows
    private static Object resolve(Db t, Object site, String kind, Object v) {
        String s = v == null ? "" : text(v).trim();
        if (s.isEmpty()) return null;
        Map<String, Object> x;
        switch (kind) {
            case "equipment" -> {
                x = t.one("SELECT id FROM equipment WHERE site_id = ?::uuid AND (id::text = ? OR lower(equipment_code) = lower(?) OR lower(equipment_name) = lower(?)) LIMIT 1", site, s, s, s);
                if (x == null) throw new RuleException("No equipment \"" + s + "\" at this lab");
            }
            case "lot" -> {
                x = t.one("SELECT id FROM inventory_lot WHERE site_id = ?::uuid AND (id::text = ? OR lower(lot_code) = lower(?)) LIMIT 1", site, s, s);
                if (x == null) throw new RuleException("No lot \"" + s + "\" at this lab");
            }
            default -> {
                x = t.one("SELECT s.id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = ?::uuid AND (s.id::text = ? OR lower(s.sample_code) = lower(?)) LIMIT 1", site, s, s);
                if (x == null) throw new RuleException("No sample \"" + s + "\" at this lab");
            }
        }
        return x.get("id");
    }

    /** "YYYY-MM-DD HH:MM" from what was typed, or null when nothing was. */
    private static String toLocal(Object v) {
        String s = Js.truthy(v) ? Js.string(v).trim() : "";
        if (s.isEmpty()) return null;
        Matcher m = LOCAL.matcher(s);
        if (!m.find()) throw new RuleException("\"" + s + "\": write the date and time as YYYY-MM-DD HH:MM");
        return m.group(1) + " " + (m.group(2).length() == 1 ? "0" : "") + m.group(2) + ":" + m.group(3);
    }

    private static Object either(Map<String, Object> x, String a, String b) { return Js.truthy(x.get(a)) ? x.get(a) : x.get(b); }

    public Map<String, Object> record(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> l = logbookOf(ctx, id);
        List<Map<String, Object>> rows = rows(body, "rows");
        if (rows.isEmpty()) throw new RuleException("Nothing to record");
        Object site = l.get("site_id"), subject = l.get("subject");
        boolean createsLot = Js.truthy(l.get("creates_lot"));
        Function<Db, Map<String, Object>> go = t -> {
            List<Map<String, Object>> made = new ArrayList<>();
            for (int i = 0; i < rows.size(); i++) {
                Map<String, Object> x = rows.get(i);
                try {
                    String at = toLocal(x.get("entry_at"));
                    Object eq = "Equipment".equals(subject) ? resolve(t, site, "equipment", either(x, "equipment_id", "equipment")) : null;
                    Object lot = "Lot".equals(subject) && !createsLot ? resolve(t, site, "lot", either(x, "lot_id", "lot")) : null;
                    Object smp = "Sample".equals(subject) ? resolve(t, site, "sample", either(x, "sample_id", "sample")) : null;
                    Object vals = x.get("values") instanceof Map<?, ?> m ? m : Map.of();
                    made.add(t.one("""
                        INSERT INTO logbook_entry (logbook_id, entry_at, equipment_id, lot_id, sample_id, entry_values, failure_reason)
                        VALUES (?::uuid, CASE WHEN ?::text IS NULL THEN clock_timestamp() ELSE (?::timestamp AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = ?::uuid)) END,
                            ?::uuid, ?::uuid, ?::uuid, ?::jsonb, ?)
                        RETURNING id, entry_code, result, lot_id""", l.get("id"), at, at, site, eq, lot, smp, toJson(vals), Js.orNull(x.get("failure_reason"))));
                } catch (RuntimeException err) {
                    throw new RuleException("Row " + (i + 1) + ": " + message(err));
                }
            }
            // the lots made by the entries (an AFTER INSERT trigger makes them, so RETURNING does not see them yet)
            List<Object> ids = made.stream().map(m -> m.get("id")).toList();
            List<Map<String, Object>> lots = createsLot && !made.isEmpty() ? t.rows("""
                SELECT l.id, l.lot_code FROM logbook_entry e JOIN inventory_lot l ON l.id = e.created_lot_id WHERE e.id = ANY(?::uuid[]) ORDER BY l.lot_code""", ids) : List.of();
            return map("made", made.stream().map(m -> m.get("entry_code")).toList(), "failed", made.stream().filter(m -> "Fail".equals(m.get("result"))).map(m -> m.get("entry_code")).toList(),
                "lots", lots);
        };
        return signedOrNot("Signature".equals(l.get("signing")), ctx.orReason("Logbook entries recorded"), body, "Recorded by",
            rows.size() + " entr" + (rows.size() == 1 ? "y" : "ies") + " in " + l.get("logbook_code") + " " + l.get("logbook_name"), go);
    }

    // ---------------------------------------------------------------- an entry
    public Map<String, Object> entry(RequestContext ctx, String id) {
        Map<String, Object> e = entryOf(ctx, id);
        List<Map<String, Object>> fields = fieldsOf(new ArrayList<>(java.util.Arrays.asList(e.get("version_id"))), true);
        decorate(List.of(e), fields);
        Map<String, Object> limits = new LinkedHashMap<>();
        for (Map<String, Object> x : db.rows("SELECT f.field_key, x.lo, x.hi FROM logbook_field f CROSS JOIN LATERAL logbook_limits(f.id, ?::uuid) x WHERE f.version_id = ?::uuid AND f.status = 'Active'",
            e.get("equipment_id"), e.get("version_id"))) limits.put((String) x.get("field_key"), map("lo", x.get("lo"), "hi", x.get("hi")));
        List<Map<String, Object>> uses;
        try { uses = db.rows("SELECT * FROM logbook_entry_uses(?::uuid)", e.get("id")); } catch (RuntimeException ex) { uses = List.of(); }
        Map<String, Object> out = map("entry", e, "fields", fields, "limits", limits,
            "failure", db.one("SELECT window_start, window_end FROM equipment_failure_view WHERE logbook_entry_id = ?::uuid", e.get("id")),
            "flags", db.rows("""
                WITH w AS (SELECT * FROM equipment_failure_view WHERE logbook_entry_id = ?::uuid),
                  b AS (SELECT DISTINCT r.batch_id FROM entry_equipment q JOIN step_run r ON r.id = q.step_run_id, w
                         WHERE q.equipment_id = w.equipment_id AND q.status = 'Active' AND q.created_at > w.window_start AND q.created_at < COALESCE(w.window_end, 'infinity'::timestamptz)
                        UNION SELECT DISTINCT r.batch_id FROM incubation_load il JOIN step_run r ON r.id = il.step_run_id, w
                         WHERE il.equipment_id = w.equipment_id AND il.status = 'Active' AND COALESCE(il.time_out, clock_timestamp()) > w.window_start
                           AND il.time_in < COALESCE(w.window_end, 'infinity'::timestamptz))
                SELECT tb.id AS batch_id, tb.batch_code, tb.status::text AS batch_status, f.step_name, f.accepted, f.justification, f.accepted_by_name, f.used_at
                  FROM b JOIN test_batch tb ON tb.id = b.batch_id CROSS JOIN LATERAL batch_equipment_flags(b.batch_id) f WHERE f.logbook_entry_id = ?::uuid ORDER BY tb.batch_code""",
                e.get("id"), e.get("id")),
            "excursions", db.rows("SELECT study_id, study_code, storage_code, rack_code, condition_name FROM stability_excursion_view WHERE logbook_entry_id = ?::uuid ORDER BY study_code", e.get("id")),
            "review", e.get("review_id") != null ? db.one("SELECT r.*, u.full_name AS by_name FROM logbook_review r JOIN app_user u ON u.id = r.created_by WHERE r.id = ?::uuid", e.get("review_id")) : null,
            "logbook", db.one("SELECT * FROM logbook WHERE id = ?::uuid", e.get("logbook_id")),
            "uses", uses,
            "can_resolve", access.load(ctx.userId()).can("testing.review", (String) e.get("site_id")));
        out.putAll(perms(ctx, (String) e.get("site_id")));
        out.put("me", ctx.userId());
        return out;
    }

    public Map<String, Object> correct(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = entryOf(ctx, id);
        Object vals = body.get("values") instanceof Map<?, ?> m ? m : null;
        if (vals == null) throw new RuleException("Nothing to correct");
        if (Js.string(body.get("reason")).trim().isEmpty()) throw new RuleException("Give the reason for the correction");
        String at = toLocal(body.get("entry_at"));
        return signedOrNot("Signature".equals(e.get("signing")), ctx, body, "Changed by", "Correct " + e.get("entry_code") + " (" + e.get("logbook_code") + ")", d -> {
            d.update("""
                UPDATE logbook_entry SET entry_values = ?::jsonb, failure_reason = ?,
                    entry_at = CASE WHEN ?::text IS NULL THEN entry_at ELSE (?::timestamp AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = site_id)) END WHERE id = ?::uuid""",
                toJson(vals), Js.orNull(body.get("failure_reason")), at, at, e.get("id"));
            return ok();
        });
    }

    public Map<String, Object> returnEntry(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = entryOf(ctx, id);
        return uow.run(ctx.orReason("Returned for correction by QA"), d -> { d.one("SELECT return_logbook_entry(?::uuid, ?)", e.get("id"), Js.orBlank(body.get("note"))); return ok(); });
    }

    public Map<String, Object> voidEntry(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = entryOf(ctx, id);
        String why = Js.string(Js.truthy(body.get("void_reason")) ? body.get("void_reason") : Js.orBlank(body.get("reason"))).trim();
        return signedOrNot("Signature".equals(e.get("signing")), ctx.orReason("Logbook entry voided"), body, "Changed by", "Void " + e.get("entry_code") + " (" + e.get("logbook_code") + ")",
            d -> { d.one("SELECT void_logbook_entry(?::uuid, ?)", e.get("id"), why); return ok(); });
    }

    // ---------------------------------------------------------------- QC Review and the bench
    private Map<String, Object> batchSite(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Batch not found");
        Map<String, Object> b = db.one("SELECT id, site_id, status::text AS status FROM test_batch WHERE id = ?::uuid", id);
        if (b == null) throw new RuleException("Batch not found");
        access.checkSite(ctx, (String) b.get("site_id"));
        return b;
    }

    public Map<String, Object> equipmentFlags(RequestContext ctx, String batchId) {
        Map<String, Object> b = batchSite(ctx, batchId);
        return map("rows", db.rows("SELECT f.*, to_char(f.entry_at, 'YYYY-MM-DD HH24:MI') AS entry_at_text FROM batch_equipment_flags(?::uuid) f", b.get("id")));
    }

    public Map<String, Object> acceptFlag(RequestContext ctx, String batchId, Map<String, Object> body) {
        if (!RequestContext.isUuid(batchId) || !RequestContext.isUuid(body.get("logbook_entry_id"))) throw new RuleException("Not found");
        Map<String, Object> b = batchSite(ctx, batchId);
        return uow.run(ctx.orReason("Equipment flag accepted by the reviewer"), d -> {
            d.one("SELECT accept_equipment_flag(?::uuid, ?::uuid, ?)", b.get("id"), body.get("logbook_entry_id"), Js.orBlank(body.get("justification")));
            return ok();
        });
    }

    /** The usable logbook entries of the lab's lots (offered when a lot has several). */
    public Map<String, Object> lotEntries(RequestContext ctx, String batchId) {
        Map<String, Object> b = batchSite(ctx, batchId);
        return map("rows", db.rows("""
            SELECT x.*, l.lot_code FROM inventory_lot l CROSS JOIN LATERAL lot_value_entries(l.id) x
             WHERE l.site_id = ?::uuid AND l.status = 'Available' AND x.usable ORDER BY l.lot_code, x.entry_at DESC""", b.get("site_id")));
    }

    public Map<String, Object> scanAliquot(RequestContext ctx, String runId, Map<String, Object> body) {
        if (!RequestContext.isUuid(runId)) throw new RuleException("Step not found");
        Map<String, Object> run = db.one("SELECT r.id, b.site_id FROM step_run r JOIN test_batch b ON b.id = r.batch_id WHERE r.id = ?::uuid", runId);
        if (run == null) throw new RuleException("Step not found");
        access.checkSite(ctx, (String) run.get("site_id"));
        String code = Js.string(body.get("code")).trim();
        if (code.isEmpty()) throw new RuleException("Scan the aliquot's barcode");
        return uow.run(ctx.orReason("Weight from aliquot " + code.toUpperCase()), d -> map("label", d.one("SELECT scan_aliquot(?::uuid, ?) AS x", run.get("id"), code).get("x")));
    }

    public Map<String, Object> aliquots(RequestContext ctx, String batchId) {
        Map<String, Object> b = batchSite(ctx, batchId);
        return map("rows", db.rows("SELECT * FROM batch_aliquots(?::uuid)", b.get("id")));
    }

    /** A reviewer resolves a result flagged by a logbook correction. */
    public Map<String, Object> resolveFlag(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Flag not found");
        Map<String, Object> f = db.one("""
            SELECT f.id, b.site_id FROM logbook_result_flag f JOIN test_result tr ON tr.id = f.test_result_id JOIN test_batch b ON b.id = tr.batch_id WHERE f.id = ?::uuid""", id);
        if (f == null) throw new RuleException("Flag not found");
        access.checkSite(ctx, (String) f.get("site_id"));
        return uow.run(ctx.orReason("Logbook correction reviewed for a result"), d -> { d.one("SELECT resolve_logbook_flag(?::uuid, ?)", f.get("id"), Js.orBlank(body.get("note"))); return ok(); });
    }

    // ---------------------------------------------------------------- logbook entries on other pages
    private List<Map<String, Object>> summarized(List<Map<String, Object>> rows) {
        List<Map<String, Object>> entries = copies(rows);
        List<Map<String, Object>> fields = fieldsOf(new ArrayList<>(entries.stream().map(x -> x.get("version_id")).collect(Collectors.toCollection(LinkedHashSet::new))), false);
        decorate(entries, fields);
        for (Map<String, Object> x : entries) x.put("summary", summary(x, fields));
        return entries;
    }

    public Map<String, Object> forEquipment(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Equipment not found");
        Map<String, Object> eq = db.one("SELECT id, site_id FROM equipment WHERE id = ?::uuid", id);
        if (eq == null) throw new RuleException("Equipment not found");
        access.checkSite(ctx, (String) eq.get("site_id"));
        Object e = eq.get("id");
        return map("logbooks", db.rows("""
                WITH p AS (SELECT ?::uuid AS eq)
                SELECT l.id, l.logbook_code, l.logbook_name, l.kind, l.entry_frequency,
                    (SELECT x.result FROM logbook_entry x WHERE x.logbook_id = l.id AND x.equipment_id = (SELECT eq FROM p) AND x.status <> 'Voided' ORDER BY x.entry_at DESC LIMIT 1) AS last_result,
                    (SELECT max(x.entry_at) FROM logbook_entry x WHERE x.logbook_id = l.id AND x.equipment_id = (SELECT eq FROM p) AND x.status <> 'Voided') AS last_entry_at,
                    (SELECT d.due FROM logbook_due_view d WHERE d.logbook_id = l.id AND d.equipment_id = (SELECT eq FROM p)) AS due
                  FROM logbook l JOIN logbook_equipment le ON le.logbook_id = l.id AND le.status = 'Active' WHERE le.equipment_id = (SELECT eq FROM p) ORDER BY l.logbook_code""", e),
            "entries", summarized(db.rows("SELECT " + ENTRY_COLS + " FROM logbook_entry_view e WHERE e.equipment_id = ?::uuid AND e.status <> 'Voided' ORDER BY e.entry_at DESC LIMIT 40", e)),
            "open_failures", db.rows("""
                SELECT logbook_entry_id, entry_code, logbook_name, entry_at, to_jsonb(problems) AS problems, failure_reason FROM equipment_failure_view
                 WHERE equipment_id = ?::uuid AND window_end IS NULL ORDER BY entry_at DESC""", e));
    }

    public Map<String, Object> forLot(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Lot not found");
        Map<String, Object> lot = db.one("SELECT id, site_id FROM inventory_lot WHERE id = ?::uuid", id);
        if (lot == null) throw new RuleException("Lot not found");
        access.checkSite(ctx, (String) lot.get("site_id"));
        return map("entries", summarized(db.rows("SELECT " + ENTRY_COLS
            + " FROM logbook_entry_view e WHERE (e.lot_id = ?::uuid OR e.created_lot_id = ?::uuid) AND e.status <> 'Voided' ORDER BY e.entry_at DESC LIMIT 40", lot.get("id"), lot.get("id"))));
    }
}
