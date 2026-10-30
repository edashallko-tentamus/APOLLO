package com.tentamus.lims.verification.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.verification.domain.Analyte;
import com.tentamus.lims.verification.domain.Calculation;
import com.tentamus.lims.verification.domain.Design;
import com.tentamus.lims.verification.domain.JsValues;
import com.tentamus.lims.verification.domain.Step;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Repository;

/** Reads a test version's design for its verification (verification.js loadDesign). */
@Repository
public class DesignRepository {
    private static String s(Object v) { return v == null ? null : v.toString(); }

    private static int i(Object v) { return v == null ? 0 : ((Number) v).intValue(); }

    public Design load(Db db, String versionId) {
        Map<String, Object> v = db.one("""
            SELECT v.id, v.version_no, v.status::text AS status, v.rounding_mode::text AS rounding_mode, v.rounding_digits, v.nd_below_lod,
                t.id AS test_id, t.test_name, t.test_code, t.site_id, s.site_code, s.site_name, m.method_name, test_version_config_hash(v.id) AS hash
              FROM test_version v JOIN test t ON t.id = v.test_id JOIN lab_site s ON s.id = t.site_id LEFT JOIN method m ON m.id = v.method_id WHERE v.id = ?::uuid""", versionId);
        if (v == null) throw new RuleException("Test version not found");
        Design.Version version = new Design.Version(s(v.get("id")), v.get("version_no"), s(v.get("status")), s(v.get("rounding_mode")), i(v.get("rounding_digits")),
            Boolean.TRUE.equals(v.get("nd_below_lod")), s(v.get("test_id")), s(v.get("test_name")), s(v.get("test_code")), s(v.get("site_id")), s(v.get("site_code")),
            s(v.get("site_name")), s(v.get("method_name")), s(v.get("hash")));
        List<Analyte> analytes = new ArrayList<>();
        for (Map<String, Object> a : db.rows("""
            SELECT a.analyte_id, an.analyte_name, a.result_type::text AS result_type, a.reporting_unit, a.loq::text AS loq, a.lod::text AS lod,
                a.rounding_mode::text AS rounding_mode, a.rounding_digits, a.default_spec_min::text AS default_spec_min, a.default_spec_max::text AS default_spec_max,
                a.default_spec_text, a.result_values, a.found_values, a.invalid_values
              FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id WHERE a.test_version_id = ?::uuid AND a.status = 'Active' ORDER BY a.sort_order, an.analyte_name""", versionId)) {
            analytes.add(new Analyte(s(a.get("analyte_id")), s(a.get("analyte_name")), s(a.get("result_type")), s(a.get("reporting_unit")), s(a.get("loq")), s(a.get("lod")),
                s(a.get("rounding_mode")), a.get("rounding_digits") == null ? null : i(a.get("rounding_digits")), s(a.get("default_spec_min")), s(a.get("default_spec_max")),
                s(a.get("default_spec_text")), JsValues.pgList(a.get("result_values")), JsValues.pgList(a.get("found_values")), JsValues.pgList(a.get("invalid_values"))));
        }
        List<Step> steps = new ArrayList<>();
        for (Map<String, Object> r : db.rows("""
            SELECT ws.id, ws.step_key, ws.step_name, ws.step_type::text AS step_type, ws.sort_order, ws.config,
                d.department_name, (SELECT count(*) FROM step_ancestors(ws.id))::int AS n_anc, step_base_token_fields(ws.id) AS base_fields
              FROM workflow_step ws LEFT JOIN department d ON d.id = step_department(ws.id) WHERE ws.test_version_id = ?::uuid AND ws.status = 'Active' ORDER BY ws.sort_order, ws.step_key""", versionId)) {
            steps.add(new Step(s(r.get("id")), s(r.get("step_key")), s(r.get("step_name")), s(r.get("step_type")), i(r.get("sort_order")), JsValues.map(r.get("config")),
                s(r.get("department_name")), i(r.get("n_anc")), JsValues.pgList(r.get("base_fields"))));
        }
        Map<String, Step> byKey = new LinkedHashMap<>();
        for (Step st : steps) byKey.put(st.key, st);
        for (Map<String, Object> d : db.rows("""
            SELECT s.step_key, p.step_key AS dep FROM workflow_step_dependency d JOIN workflow_step s ON s.id = d.step_id JOIN workflow_step p ON p.id = d.depends_on_step_id
             WHERE s.test_version_id = ?::uuid AND d.status = 'Active' AND s.status = 'Active'""", versionId)) {
            Step st = byKey.get(s(d.get("step_key")));
            if (st != null) st.deps.add(s(d.get("dep")));
        }
        for (Map<String, Object> e : db.rows("""
            SELECT s.step_key, et.id AS equipment_type_id, et.type_name, e.is_main FROM workflow_step_equipment e JOIN workflow_step s ON s.id = e.step_id
              JOIN equipment_type et ON et.id = e.equipment_type_id WHERE s.test_version_id = ?::uuid AND e.status = 'Active' AND s.status = 'Active' ORDER BY e.is_main DESC, et.type_name""", versionId)) {
            Step st = byKey.get(s(e.get("step_key")));
            if (st != null) st.equipment.add(e);
        }
        List<Map<String, Object>> qc = db.rows("""
            SELECT qc_type, qc_class, limit_type, shape, analyte_id, analyte_name, applies, min_value::text AS min_value, max_value::text AS max_value, limit_ref
              FROM qc_criteria(?::uuid)""", versionId);
        Map<String, String> testNames = new LinkedHashMap<>();
        for (Map<String, Object> t : db.rows("SELECT id, test_name FROM test")) testNames.put(s(t.get("id")), s(t.get("test_name")));

        // L-2 (migration 035): a formula token that is not one of its step's own fields is a value published by the logbook entry of
        // the lot scanned at that step; the protocol picks, per analyte, a usable lot at the lab whose approved entry publishes it
        Set<String> want = new LinkedHashSet<>();
        for (Step cs : steps) {
            if (!cs.is("Calculation")) continue;
            List<Object> formulas = new ArrayList<>();
            formulas.add(cs.cfg("formula"));
            for (Object o : cs.cfgList("overrides")) formulas.add(JsValues.map(o).get("formula"));
            for (Object f : formulas) for (String tok : Calculation.formulaTokens(f)) {
                String[] p = tok.split("\\.", 2);
                Step ref = byKey.get(p[0]);
                if (ref != null && p.length > 1 && !p[1].isEmpty() && !ref.baseFields.contains(p[1])) want.add(p[0] + "." + p[1]);
            }
        }
        Map<String, Object> material = new LinkedHashMap<>();
        for (String tok : want) {
            String k = tok.split("\\.")[0], fld = tok.split("\\.")[1];
            List<Map<String, Object>> cand = db.rows("""
                SELECT l.id AS lot_id, l.lot_code, COALESCE(l.item_name, '') AS item_name, e.id AS entry_id, e.entry_code, (e.entry_values->>?) AS value,
                      to_char(e.valid_until, 'YYYY-MM-DD HH24:MI') AS valid_until, lb.logbook_code,
                      COALESCE((SELECT array_agg(la.analyte_id::text) FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active'), '{}') AS analytes
                    FROM inventory_lot l JOIN logbook_entry e ON e.lot_id = l.id AND e.status <> 'Voided' JOIN logbook lb ON lb.id = e.logbook_id
                   WHERE l.site_id = ?::uuid AND l.status::text = 'Available' AND l.receipt_status::text = 'Received'
                     AND (l.expiration_date IS NULL OR l.expiration_date >= site_today(l.site_id))
                     AND (e.status = 'Approved' OR lb.review_route = 'Batch') AND (e.valid_until IS NULL OR e.valid_until > clock_timestamp() + interval '30 minutes')
                     AND jsonb_typeof(e.entry_values->?) = 'number'
                   ORDER BY e.entry_at DESC""", fld, version.siteId(), fld);
            Map<String, Map<String, Object>> per = new LinkedHashMap<>();
            for (Analyte a : analytes) {
                for (Map<String, Object> c : cand) if (JsValues.pgList(c.get("analytes")).contains(a.id)) { per.put(a.id, c); break; }
            }
            // a lot that names no organism serves every analyte: used only when no analyte has a lot of its own (two lots would clash)
            Map<String, Object> generic = cand.stream().filter(c -> JsValues.pgList(c.get("analytes")).isEmpty()).findFirst().orElse(null);
            if (per.isEmpty() && generic != null) for (Analyte a : analytes) per.put(a.id, generic);
            @SuppressWarnings("unchecked")
            Map<String, Object> mk = (Map<String, Object>) material.computeIfAbsent(k, z -> new LinkedHashMap<String, Object>());
            for (Map.Entry<String, Map<String, Object>> e : per.entrySet()) {
                Map<String, Object> c = e.getValue();
                @SuppressWarnings("unchecked")
                Map<String, Object> ma = (Map<String, Object>) mk.computeIfAbsent(e.getKey(), z -> new LinkedHashMap<String, Object>());
                Map<String, Object> lot = new LinkedHashMap<>();
                lot.put("lot_id", c.get("lot_id")); lot.put("lot_code", c.get("lot_code")); lot.put("item_name", c.get("item_name"));
                lot.put("entry_id", c.get("entry_id")); lot.put("entry_code", c.get("entry_code")); lot.put("logbook_code", c.get("logbook_code"));
                lot.put("value", JsValues.str(c.get("value"))); lot.put("valid_until", c.get("valid_until"));
                ma.put(fld, lot);
            }
        }
        return new Design(version, analytes, steps, qc, testNames, material, new ArrayList<>(want));
    }
}
