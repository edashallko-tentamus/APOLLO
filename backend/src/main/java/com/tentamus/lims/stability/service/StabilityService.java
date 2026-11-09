package com.tentamus.lims.stability.service;

import com.tentamus.lims.core.config.Env;
import com.tentamus.lims.stability.domain.ExcursionAssessment;
import com.tentamus.lims.stability.domain.StabilityDesign;
import com.tentamus.lims.stability.repo.ExcursionRepository;
import com.tentamus.lims.stability.domain.StabilitySetup;
import com.tentamus.lims.stability.repo.StabilityDesignRepository;
import static com.tentamus.lims.core.web.Answers.*;
import static com.tentamus.lims.stability.service.StabilityData.jsNum;
import static com.tentamus.lims.stability.service.StabilityData.num;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Stability studies (migrations 032 and 041): conditions, chambers and racks; the stability quotes list, a new one, its
 * design (one save for the plan, conditions, timepoints, tests and matrix), a new version; the studies, placement in
 * chambers, pull orders, recording pulls, the cumulative report's data; cancelling, disposal, excursion assessments and
 * the reports due. Sending, the client's link, accepting and rejecting are the quote routes.
 *
 * <p>The report PDFs (summary, preview, issue, an issued report) are {@link StabilityReportsService}'s.
 */
@Service
public class StabilityService {
    private static final List<String> EDITABLE = List.of("Draft", "Submitted for Quote");
    private static final RecordWriter CONDITIONS = new RecordWriter("stability_condition",
        List.of("condition_name", "condition_type", "temperature_c", "temperature_tol", "humidity_pct", "humidity_tol", "description", "sort_order", "status", "site_id"));
    private static final RecordWriter CHAMBERS = new RecordWriter("stability_chamber", List.of("equipment_id", "condition_id", "notes", "status"));
    private static final RecordWriter RACKS = new RecordWriter("stability_rack", List.of("chamber_id", "rack_code", "description", "positions", "status"));
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final ObjectMapper json;
    private final StabilityDesignRepository facts;
    private final ExcursionRepository excursions;

    public StabilityService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, ObjectMapper json, StabilityDesignRepository facts,
                            ExcursionRepository excursions) {
        this.facts = facts;
        this.excursions = excursions;
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.json = json;
    }

    private String toJson(Object v) {
        try { return json.writeValueAsString(v); } catch (JsonProcessingException e) { throw new IllegalArgumentException(e); }
    }

    private boolean isAdmin(RequestContext ctx) {
        Map<String, Object> u = db.one("SELECT is_admin FROM app_user WHERE id = ?::uuid", ctx.userId());
        return u != null && Boolean.TRUE.equals(u.get("is_admin"));
    }

    private static Object today(Db d, Object site) { return d.one("SELECT site_today(?::uuid) AS d", site).get("d"); }

    /** Number(v) for a request value: NaN when the key is missing (undefined), 0 for null. */
    private static double number(Map<String, Object> m, String k) { return m.containsKey(k) ? Js.toNumber(m.get(k)) : Double.NaN; }

    /** '' / null / undefined as null, else Number(v). */
    private static Object numOrNull(Object v) { return v == null || "".equals(v) ? null : (Object) Js.toNumber(v); }

    // ---------------------------------------------------------------- setup: conditions, chambers, racks
    public Map<String, Object> setup(RequestContext ctx) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> conditions = db.rows("""
            SELECT sc.*, sc.status::text AS status, s.site_code,
                (SELECT count(*) FROM stability_chamber ch WHERE ch.condition_id = sc.id AND ch.site_id = ?::uuid AND ch.status = 'Active')::int AS chambers
              FROM stability_condition sc LEFT JOIN lab_site s ON s.id = sc.site_id WHERE sc.site_id IS NULL OR sc.site_id = ?::uuid
             ORDER BY sc.site_id NULLS FIRST, sc.sort_order, sc.condition_name""", site, site);
        List<Map<String, Object>> chambers;
        try {
            chambers = db.rows("""
                SELECT ch.id, ch.equipment_id, ch.condition_id, ch.notes, ch.status::text AS status, e.equipment_code, e.equipment_name, e.admin_status::text AS admin_status,
                    sc.condition_name, ev.availability,
                    (SELECT count(*) FROM stability_rack rk WHERE rk.chamber_id = ch.id AND rk.status = 'Active')::int AS racks,
                    (SELECT count(*) FROM stability_storage s JOIN stability_rack rk ON rk.id = s.rack_id WHERE rk.chamber_id = ch.id AND s.status = 'Stored')::int AS stored
                  FROM stability_chamber ch JOIN equipment e ON e.id = ch.equipment_id JOIN stability_condition sc ON sc.id = ch.condition_id
                  LEFT JOIN equipment_view ev ON ev.id = e.id WHERE ch.site_id = ?::uuid ORDER BY e.equipment_name""", site);
        } catch (RuntimeException e) {
            chambers = db.rows("""
                SELECT ch.id, ch.equipment_id, ch.condition_id, ch.notes, ch.status::text AS status,
                    e.equipment_code, e.equipment_name, e.admin_status::text AS admin_status, sc.condition_name, NULL AS availability, 0 AS racks, 0 AS stored
                  FROM stability_chamber ch JOIN equipment e ON e.id = ch.equipment_id JOIN stability_condition sc ON sc.id = ch.condition_id
                 WHERE ch.site_id = ?::uuid ORDER BY e.equipment_name""", site);
        }
        List<Map<String, Object>> racks = db.rows("""
            SELECT rk.id, rk.chamber_id, rk.rack_code, rk.description, rk.positions, rk.status::text AS status, e.equipment_name, sc.condition_name,
                (SELECT string_agg(s.storage_code || COALESCE(' @ ' || s.position, ''), ', ') FROM stability_storage s WHERE s.rack_id = rk.id AND s.status = 'Stored') AS holds
              FROM stability_rack rk JOIN stability_chamber ch ON ch.id = rk.chamber_id JOIN equipment e ON e.id = ch.equipment_id JOIN stability_condition sc ON sc.id = ch.condition_id
             WHERE ch.site_id = ?::uuid ORDER BY e.equipment_name, rk.rack_code""", site);
        List<Map<String, Object>> equipment = db.rows("""
            SELECT e.id, e.equipment_code, e.equipment_name, t.type_name FROM equipment e JOIN equipment_type t ON t.id = e.equipment_type_id
             WHERE e.site_id = ?::uuid AND e.admin_status <> 'Retired' ORDER BY (t.type_name ILIKE '%stability%') DESC, e.equipment_name""", site);
        List<Map<String, Object>> upcoming = db.rows("""
            SELECT p.id, p.study_id, p.study_code, p.client_name, p.condition_name, p.timepoint_label, p.scheduled_date, p.window_start, p.window_end, p.status,
                p.equipment_name, p.equipment_code, p.rack_code, p.position, p.storage_code, p.units_required, p.overdue
              FROM stability_pull_view p WHERE p.site_id = ?::uuid AND p.status IN ('Scheduled','Ordered') AND p.scheduled_date <= site_today(?::uuid) + 120
             ORDER BY p.scheduled_date, p.equipment_name""", site, site);
        Map<String, Object> lab = db.one("SELECT stability_pull_window_days, stability_reserve_pct, site_code FROM lab_site WHERE id = ?::uuid", site);
        return map("conditions", conditions, "chambers", chambers, "racks", racks, "equipment", equipment, "upcoming", upcoming, "lab", lab,
            "can", access.has(ctx, "stability.configure"), "sysadmin", isAdmin(ctx));
    }

    public Object saveConditions(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> x : rows(body, "rows")) {
            Map<String, Object> r = new LinkedHashMap<>(x);
            if (Js.truthy(x.get("id"))) r.remove("site_id");
            else r.put("site_id", "all".equals(x.get("site_id")) ? null : site);
            rows.add(r);
        }
        return uow.run(ctx.withSite(site).orReason("Stability conditions changed"), d -> upsert(d, CONDITIONS, "stability_condition", rows, Map.of(), (before, after) -> {
            StabilitySetup.checkCondition(before, after, before != null && facts.onQuote(d, before.get("id")));
            if (after.get("site_id") == null || (before != null && before.get("site_id") == null))
                access.requireSystemAdmin(ctx, "Conditions for every lab are kept by a system administrator; add one for your lab instead");
            else access.requireAt(ctx, "stability.configure", after.get("site_id").toString());
        }));
    }

    public Object saveChambers(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        return uow.run(ctx.withSite(site).orReason("Stability chambers changed"), d -> upsert(d, CHAMBERS, "stability_chamber", rows(body, "rows"), Map.of("site_id", site), (before, after) -> {
            Map<String, Object> eq = facts.equipment(d, after.get("equipment_id"));
            if (eq == null) throw RuleException.database("Equipment not found");
            Map<String, Object> cond = facts.condition(d, after.get("condition_id"));
            StabilitySetup.checkChamber(before, after, (String) eq.get("equipment_code"), (String) eq.get("site_id"), Boolean.TRUE.equals(eq.get("retired")),
                cond == null ? null : (String) cond.get("site_id"), before != null && facts.chamberHoldsMaterial(d, before.get("id")));
            after.put("site_id", eq.get("site_id"));   // the equipment decides the chamber's lab
            access.requireAt(ctx, "stability.configure", (String) eq.get("site_id"));
        }));
    }

    public Object saveRacks(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        return uow.run(ctx.withSite(site).orReason("Stability racks changed"), d -> upsert(d, RACKS, "stability_rack", rows(body, "rows"), Map.of(), (before, after) -> {
            StabilitySetup.checkRack(before, after, before != null && facts.rackHoldsMaterial(d, before.get("id")));
            Map<String, Object> chamber = facts.row(d, "stability_chamber", after.get("chamber_id"));
            access.requireAt(ctx, "stability.configure", chamber == null ? null : (String) chamber.get("site_id"));
        }));
    }

    /**
     * RecordWriter.upsert with the setup rules: each row checked against what is stored before it is written (the check
     * may add derived values to the row, e.g. a chamber's lab).
     */
    private List<Map<String, Object>> upsert(Db d, RecordWriter w, String table, List<Map<String, Object>> rows, Map<String, Object> fixed,
                                             java.util.function.BiConsumer<Map<String, Object>, Map<String, Object>> rule) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> vals = w.pick(row);
            if (row.get("id") != null) {
                if (vals.isEmpty()) continue;
                Map<String, Object> before = facts.row(d, table, row.get("id"));
                if (before == null) { out.add(null); continue; }
                Map<String, Object> after = new LinkedHashMap<>(before);
                after.putAll(vals);
                rule.accept(before, after);
                if (table.equals("stability_chamber")) vals.put("site_id", after.get("site_id"));
                out.add(w.update(d, row.get("id").toString(), vals));
            } else {
                Map<String, Object> all = new LinkedHashMap<>(vals);
                all.putAll(fixed);
                rule.accept(null, all);
                out.add(w.insert(d, all, "id"));
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- stability quotes
    public Map<String, Object> quotes(RequestContext ctx) {
        return map("rows", db.rows("""
                SELECT q.*, pl.product, s.site_code, st.id AS study_id, st.study_code, st.status AS study_status
                  FROM quote_list_view q LEFT JOIN stability_plan pl ON pl.project_version_id = q.version_id LEFT JOIN lab_site s ON s.id = pl.site_id
                  LEFT JOIN stability_study st ON st.project_id = q.project_id WHERE q.kind = 'Stability' ORDER BY COALESCE(q.sent_at, q.quoted_at, q.version_created_at) DESC"""),
            "labs", db.rows("SELECT id, site_code, site_name, stability_pull_window_days FROM lab_site WHERE status = 'Active' ORDER BY site_code"),
            "me", ctx.userId(), "can_edit", access.has(ctx, "quotes.edit"));
    }

    public Map<String, Object> newQuote(RequestContext ctx, Map<String, Object> b) {
        return uow.run(ctx.orReason("New stability quote"), t -> {
            if (!RequestContext.isUuid(b.get("client_id"))) throw new RuleException("Choose the client");
            if (!RequestContext.isUuid(b.get("site_id"))) throw new RuleException("Choose the lab that stores and tests the study");
            Map<String, Object> cl = t.one("SELECT COALESCE(display_name, legal_name) AS name FROM client WHERE id = ?::uuid", b.get("client_id"));
            if (cl == null) throw new RuleException("Cannot read properties of null (reading 'name')");
            Map<String, Object> lab = t.one("SELECT stability_pull_window_days AS w FROM lab_site WHERE id = ?::uuid", b.get("site_id"));
            String name = Js.string(Js.orBlank(b.get("project_name"))).trim();
            Map<String, Object> p = t.one("INSERT INTO project (client_id, project_name, kind, quote_contact_id, site_id) VALUES (?::uuid, ?, 'Stability', ?::uuid, ?::uuid) RETURNING id, project_code",
                b.get("client_id"), name.isEmpty() ? "Stability study for " + cl.get("name") : name, uuidOrNull(b.get("quote_contact_id")), b.get("site_id"));
            Object vid = t.one("SELECT new_project_version(?::uuid) AS id", p.get("id")).get("id");
            String unit = Js.string(Js.orBlank(b.get("unit_name"))).trim();
            t.update("INSERT INTO stability_plan (project_version_id, site_id, product, lot, unit_name) VALUES (?::uuid, ?::uuid, ?, ?, ?)",
                vid, b.get("site_id"), Js.orNull(b.get("product")), Js.orNull(b.get("lot")), unit.isEmpty() ? "units" : unit);
            // a start: real time and accelerated, the usual ICH timepoints, the lab's pull window
            t.update("""
                INSERT INTO stability_version_condition (project_version_id, condition_id, sort_order)
                SELECT ?::uuid, id, sort_order FROM stability_condition WHERE site_id IS NULL AND condition_name IN ('25 °C / 60% RH','40 °C / 75% RH') AND status = 'Active'""", vid);
            Object w = lab == null ? null : lab.get("w");
            t.update("""
                INSERT INTO stability_timepoint (project_version_id, label, interval_value, interval_unit, days_early, days_late)
                SELECT ?::uuid, l, n, 'Months', CASE WHEN n = 0 THEN 0 ELSE ?::int END, CASE WHEN n = 0 THEN 0 ELSE ?::int END
                  FROM (VALUES ('T0', 0), ('3 M', 3), ('6 M', 6), ('9 M', 9), ('12 M', 12), ('18 M', 18), ('24 M', 24)) x(l, n)""", vid, w, w);
            return map("id", p.get("id"), "version_id", vid, "project_code", p.get("project_code"));
        });
    }

    public Map<String, Object> quote(RequestContext ctx, String pid) {
        if (!RequestContext.isUuid(pid)) throw new RuleException("Stability quote not found");
        Map<String, Object> p = db.one("""
            SELECT p.*, COALESCE(cl.display_name, cl.legal_name) AS client_name, ou.full_name AS owner_name,
                NULLIF(btrim(COALESCE(qc.first_name, '') || ' ' || COALESCE(qc.last_name, '')), '') AS quote_contact_name
              FROM project p JOIN client cl ON cl.id = p.client_id LEFT JOIN app_user ou ON ou.id = COALESCE(p.owner_id, p.created_by)
              LEFT JOIN contact qc ON qc.id = p.quote_contact_id WHERE p.id = ?::uuid AND p.kind = 'Stability'""", pid);
        if (p == null) throw new RuleException("Stability quote not found");
        List<Map<String, Object>> versions = db.rows("""
            SELECT pv.*, pv.status::text AS status, NULLIF(btrim(COALESCE(sc.first_name, '') || ' ' || COALESCE(sc.last_name, '')), '') AS sent_to_name,
                NULLIF(btrim(COALESCE(ac.first_name, '') || ' ' || COALESCE(ac.last_name, '')), '') AS accepted_by_name
              FROM project_version pv LEFT JOIN contact sc ON sc.id = pv.sent_to_contact_id LEFT JOIN contact ac ON ac.id = pv.accepted_by_contact_id
             WHERE pv.project_id = ?::uuid ORDER BY pv.version_no DESC""", pid);
        Map<String, Object> v = versions.get(0);
        Map<String, Object> d = StabilityData.design(db, v.get("id"));
        @SuppressWarnings("unchecked")
        Map<String, Object> plan = (Map<String, Object>) d.get("plan");
        Object site = plan == null ? null : plan.get("site_id");
        List<Map<String, Object>> conditions = db.rows("""
            SELECT id, condition_name, condition_type, site_id FROM stability_condition WHERE status = 'Active' AND (site_id IS NULL OR site_id = ?::uuid)
             ORDER BY site_id NULLS FIRST, sort_order, condition_name""", site);
        List<Map<String, Object>> catalog = db.rows("""
            SELECT tc.test_id, tc.test_code, tc.test_name, tc.list_price, tc.pricing_mode, t.site_id,
                EXISTS (SELECT 1 FROM test_version tv WHERE tv.test_id = t.id AND tv.status = 'Effective') AS has_effective
              FROM test_catalogue tc JOIN test t ON t.id = tc.test_id WHERE tc.test_status = 'Active' AND (t.site_id IS NULL OR t.site_id = ?::uuid) ORDER BY tc.test_name""", site);
        List<Map<String, Object>> contacts = db.rows("""
            SELECT ct.id, NULLIF(btrim(COALESCE(ct.first_name, '') || ' ' || COALESCE(ct.last_name, '')), '') AS name, ct.email, cc.roles
              FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id WHERE cc.client_id = ?::uuid AND cc.status = 'Active' AND ct.status = 'Active' ORDER BY ct.last_name""", p.get("client_id"));
        Map<String, Object> study = db.one("SELECT id, study_code, status, project_version_id, amendment_no FROM stability_study WHERE project_id = ?::uuid", pid);
        String link = null;
        if (Js.truthy(v.get("client_token"))) {
            String pub = Env.get("LIMS_PUBLIC_URL");
            String port = Env.get("PORT");
            String base = Js.truthy(pub) ? pub : "http://localhost:" + (Js.truthy(port) ? port : "3000");
            link = base.replaceAll("/$", "") + "/quote-response.html?t=" + v.get("client_token");
        }
        return map("project", p, "version", v, "versions", versions, "design", d, "years", StabilityData.priceByYear(d), "problems", d.get("problems"),
            "conditions", conditions, "catalog", catalog, "contacts", contacts, "study", study, "link", link,
            "labs", db.rows("SELECT id, site_code, stability_pull_window_days FROM lab_site WHERE status = 'Active' ORDER BY site_code"),
            "editable", EDITABLE.contains(v.get("status")), "can_edit", access.has(ctx, "quotes.edit"));
    }

    /** One save for the whole design. body: { plan, condition_ids, timepoints[], lines[{test_id, final_price, units, t0}], matrix[{test_id, condition_id, labels[]}] } */
    @SuppressWarnings("unchecked")
    public Map<String, Object> saveDesign(RequestContext ctx, String vid, Map<String, Object> b) {
        if (!RequestContext.isUuid(vid)) throw new RuleException("Version not found");
        return uow.run(ctx.orReason("Stability study design changed"), t -> {
            Map<String, Object> v = t.one("SELECT pv.status::text AS status FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = ?::uuid AND p.kind = 'Stability'", vid);
            if (v == null) throw new RuleException("Version not found");
            if (!EDITABLE.contains(v.get("status"))) throw new RuleException("The design is locked once the quote is issued: start a new version to change it");
            StabilityDesign design = facts.design(t, vid);
            // the plan
            if (Js.truthy(b.get("plan")) && b.get("plan") instanceof Map<?, ?> pm) {
                Map<String, Object> pl = (Map<String, Object>) pm;
                design.checkPlan(null, (Double) numOrNull(pl.get("escalation_pct")), (Double) numOrNull(pl.get("reserve_pct")));
                t.update("""
                    UPDATE stability_plan SET product = ?, lot = ?, protocol_ref = ?, unit_name = COALESCE(NULLIF(btrim(?), ''), 'units'),
                      planned_placement = ?::date, escalation_pct = COALESCE(?::numeric, 0), reserve_pct = ?::numeric, notes = ? WHERE project_version_id = ?::uuid""",
                    Js.orNull(pl.get("product")), Js.orNull(pl.get("lot")), Js.orNull(pl.get("protocol_ref")), Js.orBlank(pl.get("unit_name")), Js.orNull(pl.get("planned_placement")),
                    numOrNull(pl.get("escalation_pct")), numOrNull(pl.get("reserve_pct")), Js.orNull(pl.get("notes")), vid);
            }
            // conditions
            if (b.get("condition_ids") instanceof List<?>) {
                List<Object> want = uuids(b.get("condition_ids"));
                t.update("UPDATE stability_cell SET status = 'Removed' WHERE project_version_id = ?::uuid AND status = 'Active' AND condition_id IS NOT NULL AND NOT (condition_id = ANY(?::uuid[]))", vid, want);
                t.update("UPDATE stability_version_condition SET status = 'Removed' WHERE project_version_id = ?::uuid AND status = 'Active' AND NOT (condition_id = ANY(?::uuid[]))", vid, want);
                int i = 0;
                for (Object id : want) {
                    i += 1;
                    Map<String, Object> has = t.one("SELECT id FROM stability_version_condition WHERE project_version_id = ?::uuid AND condition_id = ?::uuid AND status = 'Active'", vid, id);
                    Map<String, Object> cond = facts.condition(t, id);
                    design.checkCondition(cond != null, cond != null && Boolean.TRUE.equals(cond.get("active")), has == null, cond == null ? null : (String) cond.get("site_id"));
                    if (has != null) t.update("UPDATE stability_version_condition SET sort_order = ? WHERE id = ?::uuid AND sort_order <> ?", i, has.get("id"), i);
                    else t.update("INSERT INTO stability_version_condition (project_version_id, condition_id, sort_order) VALUES (?::uuid, ?::uuid, ?)", vid, id, i);
                }
            }
            // timepoints (by id; new ones by label)
            if (b.get("timepoints") instanceof List<?>) {
                List<Object> keep = new ArrayList<>();
                for (Map<String, Object> x : rows(b, "timepoints")) {
                    String label = Js.string(Js.orBlank(x.get("label"))).trim();
                    if (label.isEmpty()) continue;
                    double interval = number(x, "interval_value");
                    if (Double.isNaN(interval)) throw new RuleException(label + ": type the interval (0 for T0)");
                    Object early = x.get("days_early") != null ? x.get("days_early") : 7;
                    Object late = x.get("days_late") != null ? x.get("days_late") : early;
                    Object[] vals = { label, interval, Js.truthy(x.get("interval_unit")) ? x.get("interval_unit") : "Months", Js.toNumber(early), Js.toNumber(late) };
                    StabilityDesign.checkTimepointValues(label, interval, (double) vals[3], (double) vals[4]);
                    Map<String, Object> tp = RequestContext.isUuid(x.get("id")) ? facts.timepoint(t, x.get("id")) : null;
                    if (tp != null && Objects.equals(tp.get("project_version_id"), vid)) {
                        boolean changed = num(tp.get("interval_value")) != interval || !Objects.equals(tp.get("interval_unit"), vals[2]);
                        design.checkTimepointAmendment(label, (int) num(tp.get("interval_value")), changed, tp.get("carried_from_id") != null,
                            facts.timepointUsed(t, design.studyId(), tp.get("carried_from_id"), null), interval, "Active".equals(tp.get("status")));
                    } else if (!RequestContext.isUuid(x.get("id"))) design.checkTimepointAmendment(label, null, false, false, false, interval, true);
                    if (RequestContext.isUuid(x.get("id"))) {
                        t.update("UPDATE stability_timepoint SET label = ?, interval_value = ?, interval_unit = ?, days_early = ?, days_late = ? WHERE id = ?::uuid AND project_version_id = ?::uuid",
                            vals[0], vals[1], vals[2], vals[3], vals[4], x.get("id"), vid);
                        keep.add(x.get("id"));
                    } else keep.add(t.one("""
                        INSERT INTO stability_timepoint (project_version_id, label, interval_value, interval_unit, days_early, days_late) VALUES (?::uuid, ?, ?, ?, ?, ?) RETURNING id""",
                        vid, vals[0], vals[1], vals[2], vals[3], vals[4]).get("id"));
                }
                t.update("UPDATE stability_cell SET status = 'Removed' WHERE project_version_id = ?::uuid AND status = 'Active' AND NOT (timepoint_id = ANY(?::uuid[]))", vid, keep);
                t.update("UPDATE stability_timepoint SET status = 'Removed' WHERE project_version_id = ?::uuid AND status = 'Active' AND NOT (id = ANY(?::uuid[]))", vid, keep);
            }
            // tests (quote lines) and the matrix
            if (b.get("lines") instanceof List<?>) {
                List<Map<String, Object>> want = rows(b, "lines").stream().filter(x -> RequestContext.isUuid(x.get("test_id"))).toList();
                List<Object> ids = want.stream().map(x -> x.get("test_id")).toList();
                t.update("""
                    UPDATE stability_cell c SET status = 'Removed' FROM quoted_test_configuration q WHERE q.id = c.line_id AND c.project_version_id = ?::uuid AND c.status = 'Active'
                       AND NOT (q.test_id = ANY(?::uuid[]))""", vid, ids);
                t.update("UPDATE quoted_test_configuration SET status = 'Removed' WHERE project_version_id = ?::uuid AND status = 'Active' AND NOT (test_id = ANY(?::uuid[]))", vid, ids);
                List<Map<String, Object>> tps = t.rows("SELECT id, label, interval_value, carried_from_id FROM stability_timepoint WHERE project_version_id = ?::uuid AND status = 'Active'", vid);
                Map<String, Object> t0 = tps.stream().filter(y -> num(y.get("interval_value")) == 0).findFirst().orElse(null);
                List<Object> conds = t.rows("SELECT condition_id FROM stability_version_condition WHERE project_version_id = ?::uuid AND status = 'Active'", vid)
                    .stream().map(y -> y.get("condition_id")).toList();
                List<Map<String, Object>> matrix = rows(b, "matrix");
                for (Map<String, Object> x : want) {
                    Map<String, Object> line = t.one("SELECT id, list_price FROM quoted_test_configuration WHERE project_version_id = ?::uuid AND test_id = ?::uuid AND status = 'Active'", vid, x.get("test_id"));
                    if (line == null) line = t.one("INSERT INTO quoted_test_configuration (project_version_id, test_id) VALUES (?::uuid, ?::uuid) RETURNING id, list_price", vid, x.get("test_id"));
                    Object fp = x.get("final_price") == null || "".equals(x.get("final_price")) ? line.get("list_price") : (Object) Js.toNumber(x.get("final_price"));
                    t.update("UPDATE quoted_test_configuration SET final_price = ? WHERE id = ?::uuid AND final_price IS DISTINCT FROM ?", fp, line.get("id"), fp);
                    double u = Js.toNumber(x.get("units"));
                    long units = Math.max(1, Math.round(Js.truthy(u) ? u : 1));
                    // the cells this line should have: T0 when ticked, and the matrix rows' timepoints per condition
                    List<Object[]> wantCells = new ArrayList<>();
                    if (Js.truthy(x.get("t0")) && t0 != null) wantCells.add(new Object[] { t0.get("id"), null });
                    for (Map<String, Object> m : matrix) {
                        if (!Objects.equals(m.get("test_id"), x.get("test_id")) || !conds.contains(m.get("condition_id"))) continue;
                        if (!(m.get("labels") instanceof List<?> labels)) continue;
                        for (Object lb : labels) {
                            Map<String, Object> tp = tps.stream().filter(y -> Objects.equals(y.get("label"), lb) && num(y.get("interval_value")) > 0).findFirst().orElse(null);
                            if (tp != null) wantCells.add(new Object[] { tp.get("id"), m.get("condition_id") });
                        }
                    }
                    Map<String, Object> lf = facts.line(t, line.get("id"));
                    java.util.function.BiConsumer<Object[], Boolean> cell = (w, isNew) -> {
                        Map<String, Object> tp = tps.stream().filter(y -> Objects.equals(y.get("id"), w[0])).findFirst().orElse(null);
                        if (tp == null) return;   // a timepoint no longer on the design: its cells were just removed
                        Map<String, Object> cn = w[1] == null ? null : facts.condition(t, w[1]);
                        design.checkCell(true, (int) num(tp.get("interval_value")), (String) w[1], conds.contains(w[1]), (String) lf.get("test_site"), (String) lf.get("test_name"),
                            (String) lf.get("site_code"), isNew, tp.get("carried_from_id") != null, facts.timepointUsed(t, design.studyId(), tp.get("carried_from_id"), w[1]),
                            (String) tp.get("label"), cn == null ? null : (String) cn.get("condition_name"), units);
                    };
                    List<Map<String, Object>> have = t.rows("SELECT id, timepoint_id, condition_id, units_required FROM stability_cell WHERE line_id = ?::uuid AND status = 'Active'", line.get("id"));
                    for (Map<String, Object> h : have) {
                        if (wantCells.stream().noneMatch(w -> Objects.equals(w[0], h.get("timepoint_id")) && Objects.equals(w[1], h.get("condition_id"))))
                            t.update("UPDATE stability_cell SET status = 'Removed' WHERE id = ?::uuid", h.get("id"));
                        else if (num(h.get("units_required")) != units && cellCheck(cell, h)) t.update("UPDATE stability_cell SET units_required = ? WHERE id = ?::uuid", units, h.get("id"));
                    }
                    for (Object[] w : wantCells) {
                        if (have.stream().noneMatch(h -> Objects.equals(h.get("timepoint_id"), w[0]) && Objects.equals(h.get("condition_id"), w[1])) && cellCheck(cell, w))
                            t.update("INSERT INTO stability_cell (project_version_id, line_id, timepoint_id, condition_id, units_required) VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?)",
                                vid, line.get("id"), w[0], w[1], units);
                    }
                }
            }
            return ok();
        });
    }

    /** Runs the cell rule (true, to write) for a stored cell or a wanted one. */
    private static boolean cellCheck(java.util.function.BiConsumer<Object[], Boolean> cell, Object c) {
        if (c instanceof Map<?, ?> h) cell.accept(new Object[] { h.get("timepoint_id"), h.get("condition_id") }, false);
        else cell.accept((Object[]) c, true);
        return true;
    }

    public Map<String, Object> newVersion(RequestContext ctx, String id) {
        return uow.run(ctx.orReason("New version of the stability quote"),
            t -> map("version_id", t.one("SELECT new_stability_version(?::uuid) AS id", id).get("id")));
    }

    // ---------------------------------------------------------------- studies
    private void makeDue(RequestContext ctx, Object site) {
        try {
            uow.run(ctx.withSite((String) site), "Stability pulls due", t -> t.one("SELECT create_due_stability_pulls(?::uuid) AS n", site));
        } catch (RuntimeException ignored) {
            // as in Node: making the due pull orders never stops the page from opening
        }
    }

    public Map<String, Object> studies(RequestContext ctx, Map<String, String> q) {
        String site = access.currentSite(ctx);
        makeDue(ctx, site);
        Map<String, Object> out = new LinkedHashMap<>();
        if (PagedList.wanted(q)) {
            out.putAll(PagedList.of("SELECT * FROM stability_study_view WHERE site_id = ?::uuid", site)
                .filter("current", "status::text IN ('Awaiting material','Active')")
                .filter("finished", "status::text NOT IN ('Awaiting material','Active')")
                .filter("all", "true")
                .search("study_code", "client_name", "product", "project_code", "conditions", "last_report_code")
                .ids("study_code", "project_code")
                .order("ORDER BY created_at DESC, study_code DESC")
                .run(db, q));
        } else {
            out.put("rows", db.rows("""
                SELECT * FROM stability_study_view WHERE site_id = ?::uuid
                 ORDER BY CASE status WHEN 'Awaiting material' THEN 0 WHEN 'Active' THEN 1 ELSE 2 END, next_pull NULLS LAST, study_code""", site));
        }
        out.put("pulls", db.rows("""
            SELECT * FROM stability_pull_view WHERE site_id = ?::uuid AND status IN ('Scheduled','Ordered') AND scheduled_date <= site_today(?::uuid) + 60
             ORDER BY scheduled_date, study_code""", site, site));
        out.put("today", today(db, site));
        out.put("can_manage", access.has(ctx, "stability.manage"));
        return out;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> study(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Study not found");
        Map<String, Object> st = db.one("SELECT * FROM stability_study_view WHERE id = ?::uuid", id);
        if (st == null) throw new RuleException("Study not found");
        String site = (String) st.get("site_id");
        access.checkSite(ctx, site);
        makeDue(ctx, site);
        Map<String, Object> d = StabilityData.design(db, st.get("project_version_id"));
        List<Map<String, Object>> storage = db.rows("SELECT * FROM stability_storage_view WHERE study_id = ?::uuid ORDER BY storage_code", st.get("id"));
        List<Map<String, Object>> pulls = db.rows("SELECT * FROM stability_pull_view WHERE study_id = ?::uuid ORDER BY scheduled_date, condition_name", st.get("id"));
        List<Map<String, Object>> racks = db.rows("""
            SELECT rk.id, rk.rack_code, rk.positions, ch.condition_id, e.equipment_code, e.equipment_name, e.admin_status::text AS admin_status
              FROM stability_rack rk JOIN stability_chamber ch ON ch.id = rk.chamber_id JOIN equipment e ON e.id = ch.equipment_id
             WHERE ch.site_id = ?::uuid AND rk.status = 'Active' AND ch.status = 'Active' ORDER BY e.equipment_name, rk.rack_code""", site);
        Set<Object> placed = new HashSet<>();
        for (Map<String, Object> x : storage) placed.add(x.get("condition_id"));
        List<Map<String, Object>> cells = (List<Map<String, Object>>) d.get("cells");
        List<Map<String, Object>> need = new ArrayList<>();
        for (Map<String, Object> cd : (List<Map<String, Object>>) d.get("conditions")) {
            if (!("Awaiting material".equals(st.get("status")) || !placed.contains(cd.get("condition_id")))) continue;
            double units = 0;
            for (Map<String, Object> x : cells) if (Objects.equals(x.get("condition_id"), cd.get("condition_id"))) units += num(x.get("units_required"));
            need.add(map("condition_id", cd.get("condition_id"), "condition_name", cd.get("condition_name"), "units", jsNum(units),
                "with_reserve", jsNum(Math.ceil(units * (1 + num(st.get("reserve_pct")) / 100)))));
        }
        Map<String, Object> t0 = ((List<Map<String, Object>>) d.get("timepoints")).stream().filter(x -> num(x.get("interval_value")) == 0).findFirst().orElse(null);
        double t0units = 0;
        if (t0 != null) for (Map<String, Object> x : cells) if (Objects.equals(x.get("timepoint_id"), t0.get("id"))) t0units += num(x.get("units_required"));
        List<Map<String, Object>> t0tests = db.rows("""
            SELECT rt.id, t.test_name, rt.status::text AS status, rt.due_date FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = ?::uuid ORDER BY t.test_name""",
            st.get("t0_sample_id"));
        List<Map<String, Object>> amendments = db.rows("""
            SELECT a.*, fv.version_no AS from_version, tv.version_no AS to_version, u.full_name AS applied_by_name FROM stability_amendment a
              JOIN project_version fv ON fv.id = a.from_version_id JOIN project_version tv ON tv.id = a.to_version_id JOIN app_user u ON u.id = a.applied_by
             WHERE a.study_id = ?::uuid ORDER BY a.amendment_no DESC""", st.get("id"));
        List<Map<String, Object>> excursions = db.rows("""
            SELECT logbook_entry_id, entry_code, equipment_id, equipment_code, equipment_name, entry_at, window_start, window_end, to_jsonb(problems) AS problems, failure_reason,
                storage_code, condition_name, assessment_id, decision, justification, assessed_at, assessed_by_name, affected_pulls
              FROM stability_excursion_status_view WHERE study_id = ?::uuid ORDER BY entry_at DESC""", st.get("id"));
        List<Map<String, Object>> reports = db.rows("""
            SELECT r.id, r.report_code, r.version_no, r.is_final, r.issued_at, u.full_name AS issued_by_name FROM stability_report r JOIN app_user u ON u.id = r.issued_by
             WHERE r.study_id = ?::uuid ORDER BY r.version_no DESC""", st.get("id"));
        List<Map<String, Object>> reportProblems = db.rows("SELECT * FROM stability_report_problems(?::uuid, ?::uuid)", st.get("id"), ctx.userId());
        UserAccess a = access.load(ctx.userId());
        return map("study", st, "design", d, "storage", storage, "pulls", pulls, "racks", racks, "need", need, "t0units", jsNum(t0units), "t0tests", t0tests,
            "amendments", amendments, "excursions", excursions, "reports", reports, "report_problems", reportProblems,
            "today", today(db, site),
            "can_manage", a.can("stability.manage", site), "can_cancel", a.can("stability.cancel", site), "can_assess", a.can("stability.assess", site),
            "can_report", a.can("reports.finalize", site), "can_amend", a.can("quotes.edit", site));
    }

    public Map<String, Object> place(RequestContext ctx, String id, Map<String, Object> b) {
        Map<String, Object> st = db.one("SELECT id, site_id FROM stability_study WHERE id = ?::uuid", id);
        if (st == null) throw new RuleException("Study not found");
        String site = (String) st.get("site_id");
        access.checkSite(ctx, site);
        Object rows = Js.truthy(b.get("rows")) ? b.get("rows") : List.of();
        // Number(undefined) is NaN, Number(null) is 0, '' means none
        Object t0 = "".equals(b.get("t0_units")) ? null : (Object) number(b, "t0_units");
        return uow.run(ctx.withSite(site).orReason("Stability material placed in the chambers"),
            t -> t.one("SELECT place_stability_study(?::uuid, ?::date, ?::jsonb, ?) AS pulls", st.get("id"), Js.orNull(b.get("placement_date")), toJson(rows), t0));
    }

    public Map<String, Object> recordPull(RequestContext ctx, String id, Map<String, Object> b) {
        Map<String, Object> p = db.one("SELECT p.id, s.site_id FROM stability_pull p JOIN stability_study s ON s.id = p.study_id WHERE p.id = ?::uuid", id);
        if (p == null) throw new RuleException("Pull not found");
        String site = (String) p.get("site_id");
        access.checkSite(ctx, site);
        double units = Js.toNumber(b.get("units"));
        Object u = Js.truthy(units) ? (Object) units : null;
        return uow.run(ctx.withSite(site).orReason("Stability pull taken"),
            t -> t.one("SELECT record_stability_pull(?::uuid, ?::timestamptz, ?, ?) AS left", p.get("id"), Js.orNull(b.get("pulled_at")), u, Js.orBlank(b.get("note"))));
    }

    public Map<String, Object> createDue(RequestContext ctx) {
        String site = access.currentSite(ctx);
        return uow.run(ctx.withSite(site), "Stability pull orders made", t -> t.one("SELECT create_due_stability_pulls(?::uuid) AS n", site));
    }

    public Map<String, Object> report(RequestContext ctx, String id) {
        Map<String, Object> st = db.one("SELECT site_id FROM stability_study WHERE id = ?::uuid", id);
        if (st == null) throw new RuleException("Study not found");
        access.checkSite(ctx, (String) st.get("site_id"));
        return StabilityData.reportData(db, id, false);
    }

    // ---------------------------------------------------------------- S-2 (migration 041): cancel, dispose, excursions, reports due
    private Map<String, Object> studyOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Study not found");
        Map<String, Object> st = db.one("SELECT id, site_id, study_code FROM stability_study WHERE id = ?::uuid", id);
        if (st == null) throw new RuleException("Study not found");
        access.checkSite(ctx, (String) st.get("site_id"));
        return st;
    }

    /** Cancel: signed "Cancelled by", with the reason and every stored material's fate. */
    public Map<String, Object> cancel(RequestContext ctx, String id, Map<String, Object> b) {
        Map<String, Object> st = studyOf(ctx, id);
        Object disp = Js.truthy(b.get("dispositions")) ? b.get("dispositions") : List.of();
        return signatures.signed(ctx.withSite((String) st.get("site_id")), b,
            new SignatureService.Meaning("Cancelled by", "Stability study " + st.get("study_code") + " cancelled", "Stability"),
            t -> t.one("SELECT cancel_stability_study(?::uuid, ?, ?::jsonb) AS pulls", st.get("id"), Js.orBlank(b.get("reason")), toJson(disp)));
    }

    /** Material no longer needed: signed "Disposed by". */
    public Map<String, Object> dispose(RequestContext ctx, String id, Map<String, Object> b) {
        Map<String, Object> s = db.one("SELECT s.id, s.storage_code, st.site_id FROM stability_storage s JOIN stability_study st ON st.id = s.study_id WHERE s.id = ?::uuid", uuidOrNull(id));
        if (s == null) throw new RuleException("Stored material not found");
        access.checkSite(ctx, (String) s.get("site_id"));
        signatures.signed(ctx.withSite((String) s.get("site_id")), b,
            new SignatureService.Meaning("Disposed by", s.get("storage_code") + ": " + Js.string(Js.orBlank(b.get("disposition"))), "Stability"),
            t -> t.one("SELECT dispose_stability_material(?::uuid, ?, ?)", s.get("id"), Js.orNull(b.get("disposition")), Js.orNull(b.get("note"))));
        return ok();
    }

    /** QA's assessment of an excursion for this study: signed "Assessed by", with the justification. */
    public Map<String, Object> assess(RequestContext ctx, String id, String entry, Map<String, Object> b) {
        Map<String, Object> st = studyOf(ctx, id);
        return signatures.signed(ctx.withSite((String) st.get("site_id")).orReason("Chamber excursion assessed"), b,
            new SignatureService.Meaning("Assessed by", "Excursion assessed for " + st.get("study_code") + ": " + Js.string(Js.orBlank(b.get("decision"))), "Stability"),
            t -> {
                access.require(ctx.withSite((String) st.get("site_id")), "stability.assess", "assess chamber excursions");
                Object decision = Js.orNull(b.get("decision"));
                String why = new ExcursionAssessment((String) st.get("study_code"), excursions.isExcursion(t, st.get("id"), uuidOrNull(entry)),
                    decision == null ? null : Js.string(decision), Js.string(Js.orBlank(b.get("justification")))).check();
                return map("id", excursions.record(t, st.get("id"), uuidOrNull(entry), Js.string(decision), why).get("id"));
            });
    }

    /** Report Finalization > Stability reports: the lab's studies that have, or will have, a report to issue. */
    public Map<String, Object> reportsDue(RequestContext ctx) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = db.rows("""
            SELECT s.id, s.study_code, s.client_id, s.client_name, s.product, s.status, s.pulls_done, s.pulls_total, s.excursions_open,
                s.last_report_code, s.last_report_at, cardinality(stability_finalized_results(s.id)) AS finalized,
                (SELECT string_agg(p.problem, '; ') FROM stability_report_problems(s.id, ?::uuid) p WHERE p.severity = 'Block') AS blocked,
                (SELECT p.problem FROM stability_report_problems(s.id, ?::uuid) p WHERE p.severity = 'Info') AS next_report
              FROM stability_study_view s WHERE s.site_id = ?::uuid AND s.status <> 'Awaiting material'
             ORDER BY (SELECT count(*) FROM stability_report_problems(s.id, ?::uuid) p WHERE p.severity = 'Block') = 0 DESC, s.study_code""",
            ctx.userId(), ctx.userId(), site, ctx.userId());
        return map("rows", rows, "can_report", access.has(ctx, "reports.finalize"));
    }
}
