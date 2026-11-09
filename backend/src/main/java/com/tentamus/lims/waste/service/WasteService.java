package com.tentamus.lims.waste.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.tentamus.lims.inventory.domain.ChemicalTypes;
import com.tentamus.lims.waste.domain.WasteClassification;
import com.tentamus.lims.waste.repo.WasteRepository;
import org.springframework.stereotype.Service;

/**
 * Waste classifications: the controlled list (shared ones kept by system administrators, each lab's own by
 * inventory.lists) and the choices for an inventory item. The rules are {@link WasteClassification}'s.
 */
@Service
public class WasteService {
    private static final List<String> FIELDS = List.of("waste_name", "epa_codes", "waste_stream", "container", "disposal_instructions", "segregation", "needs_review", "sort_order", "status");
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final WasteRepository waste;

    public WasteService(Db db, UnitOfWork uow, AccessPolicy access, WasteRepository waste) {
        this.waste = waste;
        this.db = db;
        this.uow = uow;
        this.access = access;
    }

    /** Postgres array text, or a list, or "a, b" typed in a grid: the trimmed, non-empty values. */
    static List<String> list(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof List<?> l) { for (Object x : l) { String s = String.valueOf(x).trim(); if (!s.isEmpty()) out.add(s); } return out; }
        String s = v == null ? "" : Js.string(v).trim();
        if (s.isEmpty()) return out;
        String[] parts = s.startsWith("{") && s.endsWith("}") ? s.substring(1, s.length() - 1).split(",") : s.split("[,;]");
        boolean pg = s.startsWith("{") && s.endsWith("}");
        for (String p : parts) {
            String x = pg ? p.replaceAll("^\"|\"$", "").replaceAll("\\\\(.)", "$1").trim() : p.trim();
            if (!x.isEmpty()) out.add(x);
        }
        return out;
    }

    /** Arrays go to the database as Postgres array text (enum arrays). */
    static String pgArr(List<String> a) {
        StringBuilder b = new StringBuilder("{");
        for (int i = 0; a != null && i < a.size(); i++) b.append(i == 0 ? "" : ",").append('"').append(a.get(i).replaceAll("([\"\\\\])", "\\\\$1")).append('"');
        return b.append('}').toString();
    }

    private static Map<String, Object> out(Map<String, Object> r) {
        Map<String, Object> m = new LinkedHashMap<>(r);
        m.put("hazard_classes", list(r.get("hazard_classes")));
        m.put("default_for", list(r.get("default_for")));
        return m;
    }

    public Map<String, Object> list(RequestContext ctx) {
        String site = access.currentSite(ctx);
        Map<String, Object> me = db.one("SELECT is_admin FROM app_user WHERE id = ?::uuid", ctx.userId());
        return map("rows", db.rows("SELECT * FROM waste_classification_view WHERE site_id IS NULL OR site_id = ?::uuid ORDER BY site_id NULLS FIRST, sort_order, waste_code", site)
                .stream().map(WasteService::out).toList(),
            "lab", db.one("SELECT id, site_code FROM lab_site WHERE id = ?::uuid", site),
            "can_edit", access.has(ctx, "inventory.lists"), "sysadmin", me != null && Js.truthy(me.get("is_admin")),
            "item_types", list(db.one("SELECT enum_range(NULL::chemical_type)::text AS t").get("t")),
            "hazard_classes", list(db.one("SELECT waste_hazard_classes()::text AS h").get("h")));
    }

    /** The active classifications an item at this lab may take. */
    public List<Map<String, Object>> options(RequestContext ctx) {
        String site = access.currentSite(ctx);
        return db.rows("""
            SELECT id, waste_code, waste_name, needs_review, hazard_classes, default_for, site_id FROM waste_classification
             WHERE status = 'Active' AND (site_id IS NULL OR site_id = ?::uuid) ORDER BY needs_review DESC, sort_order, waste_name""", site).stream().map(WasteService::out).toList();
    }

    public Map<String, Object> save(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        return uow.run(ctx, d -> {
            List<Object> ids = new ArrayList<>();
            for (Map<String, Object> r : rows(body, "rows")) {
                Map<String, Object> f = new LinkedHashMap<>();
                for (String k : FIELDS) if (r.containsKey(k)) f.put(k, "".equals(r.get(k)) ? null : r.get(k));
                if (r.containsKey("hazard_classes")) f.put("hazard_classes", list(r.get("hazard_classes")));
                if (r.containsKey("default_for")) f.put("default_for", list(r.get("default_for")));
                if (Js.truthy(r.get("id"))) {
                    if (!RequestContext.isUuid(r.get("id"))) throw new RuleException("Waste classification not found");
                    if (f.isEmpty()) continue;
                    Map<String, Object> stored = waste.row(d, r.get("id"));
                    if (stored != null) {
                        Map<String, Object> after = new LinkedHashMap<>(stored);
                        after.putAll(f);
                        WasteClassification before = waste.find(d, r.get("id"));
                        f = WasteClassification.checked(before, after, f, waste.sameList(d, before.siteId()), ChemicalTypes.ORDER);
                        mayKeep(ctx, (String) after.get("site_id"));
                    }
                    List<String> sets = new ArrayList<>();
                    List<Object> vals = new ArrayList<>();
                    for (Map.Entry<String, Object> e : f.entrySet()) {
                        String k = e.getKey();
                        sets.add(k + " = ?" + (k.equals("default_for") ? "::chemical_type[]" : k.equals("hazard_classes") ? "::text[]" : ""));
                        @SuppressWarnings("unchecked") Object v = k.equals("default_for") || k.equals("hazard_classes") ? pgArr((List<String>) e.getValue()) : e.getValue();
                        vals.add(v);
                    }
                    vals.add(r.get("id"));
                    d.update("UPDATE waste_classification SET " + String.join(", ", sets) + " WHERE id = ?::uuid", vals.toArray());
                    ids.add(r.get("id"));
                } else {
                    if (!Js.truthy(f.get("waste_name"))) throw new RuleException("Give the waste classification a name");
                    boolean every = (r.containsKey("site_id") && r.get("site_id") == null) || "Every lab".equals(r.get("lab")) || Boolean.TRUE.equals(r.get("every_lab"));
                    Map<String, Object> after = new LinkedHashMap<>(f);
                    after.put("site_id", every ? null : site);
                    after.putIfAbsent("hazard_classes", List.of());
                    after.putIfAbsent("default_for", List.of());
                    f = WasteClassification.checked(null, after, f, waste.sameList(d, every ? null : site), ChemicalTypes.ORDER);
                    mayKeep(ctx, every ? null : site);
                    @SuppressWarnings("unchecked") List<String> hz = (List<String>) f.get("hazard_classes");
                    @SuppressWarnings("unchecked") List<String> df = (List<String>) f.get("default_for");
                    double sort = Js.toNumber(f.get("sort_order"));
                    ids.add(d.one("""
                        INSERT INTO waste_classification (site_id, waste_name, hazard_classes, epa_codes, waste_stream, container, disposal_instructions, segregation, default_for, needs_review, sort_order)
                        VALUES (?::uuid, ?, ?::text[], ?, ?, ?, ?, ?, ?::chemical_type[], ?, ?) RETURNING id""",
                        every ? null : site, f.get("waste_name"), pgArr(hz), Js.orNull(f.get("epa_codes")), Js.orNull(f.get("waste_stream")), Js.orNull(f.get("container")),
                        Js.orNull(f.get("disposal_instructions")), Js.orNull(f.get("segregation")), pgArr(df), Js.truthy(f.get("needs_review")),
                        !f.containsKey("sort_order") || Double.isNaN(sort) || sort == 0 ? 100 : sort).get("id"));
                }
            }
            return map("ids", ids);
        });
    }

    /** Classifications for every lab are a system administrator's, a lab's need inventory.lists there (waste_classification_rules until 072). */
    private void mayKeep(RequestContext ctx, String site) {
        if (site == null) access.requireSystemAdmin(ctx, "Waste classifications for every lab are kept by a system administrator; add one for your lab instead");
        else access.requireAt(ctx, "inventory.lists", site);
    }
}
