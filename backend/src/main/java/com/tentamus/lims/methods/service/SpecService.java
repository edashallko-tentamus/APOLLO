package com.tentamus.lims.methods.service;

import static com.tentamus.lims.methods.service.DesignerService.rows;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.methods.domain.Specification;
import com.tentamus.lims.methods.domain.VersionAnalyte;
import com.tentamus.lims.methods.repo.DesignStore;
import com.tentamus.lims.methods.repo.MethodsRepository;
import java.util.ArrayList;
import java.util.Set;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Specifications on a quoted test (copied to every order from it) or on one requested test: the specifications dialog. */
@Service
public class SpecService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final DesignStore store;

    public SpecService(Db db, UnitOfWork uow, AccessPolicy access, DesignStore store) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.store = store;
    }

    /** Whose specifications: a requested test (?requested_test=) or a quoted test (?quoted_line=), from the query or the body. */
    private Map<String, Object> owner(RequestContext ctx, Map<String, String> query, Map<String, Object> body) {
        Object q = first(query.get("quoted_line"), body.get("quoted_line")), rt = first(query.get("requested_test"), body.get("requested_test"));
        Map<String, Object> out = new LinkedHashMap<>();
        if (RequestContext.isUuid(rt)) {
            Map<String, Object> x = db.one("""
                SELECT rt.id, rt.test_version_id AS version_id, rt.status, t.test_name, t.test_code, s.sample_code, o.site_id, s.id AS sample_id
                  FROM requested_test rt JOIN test t ON t.id = rt.test_id JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = ?::uuid""", rt);
            if (x == null) throw new RuleException("Test not found");
            access.checkSite(ctx, (String) x.get("site_id"));
            out.put("kind", "requested_test");
            out.putAll(x);
            out.put("editable", !"Cancelled".equals(x.get("status")) && access.load(ctx.userId()).can("orders.edit", (String) x.get("site_id")));
            return out;
        }
        if (RequestContext.isUuid(q)) {
            Map<String, Object> x = db.one("""
                SELECT q.id, v.id AS version_id, t.test_name, t.test_code, pv.status AS quote_status, version_is_editable(pv.id) AS open
                  FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id JOIN project_version pv ON pv.id = q.project_version_id
                  LEFT JOIN test_version v ON v.test_id = q.test_id AND v.status = 'Effective' WHERE q.id = ?::uuid""", q);
            if (x == null) throw new RuleException("Quoted test not found");
            out.put("kind", "quoted_line");
            out.putAll(x);
            Object open = x.get("open");   // JavaScript's open && can: a false or null open is the answer itself
            out.put("editable", Boolean.TRUE.equals(open) ? access.has(ctx, "quotes.edit") : open);
            return out;
        }
        throw new RuleException("Say which test the specifications are for");
    }

    private static Object first(Object a, Object b) { return a != null && !"".equals(a) ? a : b; }

    private static String column(Map<String, Object> o) { return "requested_test".equals(o.get("kind")) ? "requested_test_id" : "quoted_line_id"; }

    public Map<String, Object> specs(RequestContext ctx, Map<String, String> query) {
        Map<String, Object> o = owner(ctx, query, Map.of());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("owner", o);
        out.put("analytes", o.get("version_id") == null ? List.of() : db.rows("""
            SELECT a.analyte_id, an.analyte_name, a.result_type, a.reporting_unit, a.default_spec_min, a.default_spec_max, a.default_spec_text
              FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id WHERE a.test_version_id = ?::uuid AND a.status = 'Active' ORDER BY a.sort_order, an.analyte_name""",
            o.get("version_id")));
        out.put("specs", db.rows("SELECT s.*, u.full_name AS created_by_name FROM specification s JOIN app_user u ON u.id = s.created_by WHERE s." + column(o)
            + " = ?::uuid AND s.status = 'Active'", o.get("id")));
        return out;
    }

    public List<Map<String, Object>> save(RequestContext ctx, Map<String, String> query, Map<String, Object> body) {
        Map<String, Object> o = owner(ctx, query, body);
        String reason = "quoted_line".equals(o.get("kind")) && ctx.reason().isEmpty() ? "Quote edited" : ctx.reason();
        String col = column(o);
        return uow.run(ctx, reason, d -> {
            Specification.Owner who = specOwner(d, o);
            VersionAnalyte.Units units = store.units(d);
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> r : rows(body)) {
                Map<String, Object> vals = MethodsRepository.SPECS.pick(r);
                if (r.get("id") != null) {
                    if (vals.isEmpty()) continue;
                    Map<String, Object> before = store.row(d, "specification", r.get("id"));
                    if (before == null) { out.add(null); continue; }
                    Object analyte = vals.containsKey("analyte_id") ? vals.get("analyte_id") : before.get("analyte_id");
                    out.add(MethodsRepository.SPECS.update(d, r.get("id").toString(), Specification.checked(before, vals, who, store.analyteName(d, analyte), units)));
                } else {
                    Map<String, Object> all = new LinkedHashMap<>(vals);
                    all.put(col, o.get("id"));
                    out.add(MethodsRepository.SPECS.insert(d, Specification.checked(null, all, who, store.analyteName(d, all.get("analyte_id")), units), "id"));
                }
            }
            return out;
        });
    }

    /** The owner as the rules need it: whether its quote is still open, its status, the analytes of its version. */
    private Specification.Owner specOwner(Db d, Map<String, Object> o) {
        Object version = o.get("version_id");
        Set<String> analytes = version == null ? null : d.rows("SELECT analyte_id FROM test_version_analyte WHERE test_version_id = ?::uuid AND status = 'Active'", version)
            .stream().map(a -> a.get("analyte_id").toString()).collect(java.util.stream.Collectors.toSet());
        return new Specification.Owner((String) o.get("kind"), Boolean.TRUE.equals(o.get("open")), (String) o.get("status"), analytes);
    }
}
