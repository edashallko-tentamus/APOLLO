package com.tentamus.lims.masterdata.service;

import static com.tentamus.lims.masterdata.domain.MasterLists.*;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.masterdata.domain.ControlledList;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Master data: labs and their holidays, compliance categories, analytes and unit conversions (the plain lists go straight
 * through {@link ControlledListService}). Who may change each list is still checked by the database's permission
 * triggers; that rule moves to Java with the rest of the rules.
 */
@Service
public class MasterDataService {
    private final ControlledListService lists;
    private final AccessPolicy access;
    private final Db db;

    public MasterDataService(ControlledListService lists, AccessPolicy access, Db db) {
        this.lists = lists;
        this.access = access;
        this.db = db;
    }

    public List<Map<String, Object>> sites(RequestContext ctx) {
        access.require(ctx, "admin.lab", "open the lab settings");
        return lists.read(SITES);
    }

    public List<Map<String, Object>> saveSites(RequestContext ctx, Map<String, Object> body) {
        access.requireSystemAdmin(ctx);
        return lists.save(ctx, SITES, body, Map.of());
    }

    public List<Map<String, Object>> holidays(RequestContext ctx, String siteId) {
        access.checkSite(ctx, siteId);
        return lists.read(HOLIDAYS, siteId);
    }

    public List<Map<String, Object>> saveHolidays(RequestContext ctx, String siteId, Map<String, Object> body) {
        return lists.save(ctx, HOLIDAYS, body, Map.of("site_id", siteId));
    }

    public List<Map<String, Object>> timezones() {
        return db.rows("SELECT name FROM pg_timezone_names WHERE name ~ '^(America|Europe|Asia|Australia|Pacific|Africa)/' ORDER BY name");
    }

    public Map<String, Object> complianceCategories(RequestContext ctx) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", lists.read(COMPLIANCE_CATEGORIES));
        out.put("can_edit", access.has(ctx, "master.compliance"));
        return out;
    }

    /** Analytes: signed only when the save carries a signature (the screen asks for one when a molar mass changes). */
    public List<Map<String, Object>> saveAnalytes(RequestContext ctx, Map<String, Object> body) {
        Object sig = body == null ? null : body.get("signature");
        ControlledList.Signing signing = sig == null || Boolean.FALSE.equals(sig) || "".equals(sig) ? null
            : new ControlledList.Signing("Changed by", "Analytes: " + ControlledListService.rows(body).size() + " row(s) including molar mass", "Catalog");
        return lists.save(ctx, ANALYTES, signing, body, Map.of());
    }

    /** For each unit (at most 40), the units that convert to it: the mixture page's unit choices. */
    public Map<String, Object> convertibleUnits(String units, String form) {
        List<String> given = new ArrayList<>();
        for (String u : (units == null ? "" : units).split(",")) if (!u.trim().isEmpty()) given.add(u.trim());
        Map<String, Object> out = new LinkedHashMap<>();
        for (String u : given.subList(0, Math.min(40, given.size())))
            out.put(u, db.rows("SELECT convertible_units(?, ?) AS u", u, emptyToNull(form)).stream().map(r -> r.get("u")).toList());
        return out;
    }

    public Map<String, Object> convert(String from, String to, String form) {
        return db.one("SELECT unit_factor(?, ?, ?) AS factor", from, to, emptyToNull(form));
    }

    private static String emptyToNull(String s) { return s == null || s.isEmpty() ? null : s; }
}
