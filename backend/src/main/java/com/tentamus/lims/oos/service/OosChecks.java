package com.tentamus.lims.oos.service;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RuleException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * The automatic data checks of an OOS investigation (the Node backend's oos.js checks()): what can be checked without a
 * person when an investigation is opened (and again on request until it is concluded). They inform; they decide nothing.
 * The texts are stored on the investigation, so they are written exactly as the Node backend writes them.
 */
@Component
public class OosChecks {
    private static final DateTimeFormatter SHORT_DATE = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US).withZone(ZoneId.of("America/Los_Angeles"));
    private final Db db;

    public OosChecks(Db db) { this.db = db; }

    private static Map<String, Object> chk(String code, String title, String level, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", code);
        m.put("title", title);
        m.put("level", level);
        m.put("detail", detail);
        return m;
    }

    /** A query whose failure the Node backend ignores (.catch(() => [])). */
    private static List<Map<String, Object>> orEmpty(Supplier<List<Map<String, Object>>> q) {
        try { return q.get(); } catch (RuntimeException e) { return List.of(); }
    }

    private static String s(Object v) { return String.valueOf(v); }   // a template literal: null is "null"

    private static boolean truthy(Object v) { return v != null && !"".equals(v) && !Boolean.FALSE.equals(v); }

    public List<Map<String, Object>> run(String oosId) {
        Map<String, Object> o = db.one("""
            SELECT x.*, s.sample_code, s.logged_at, s.condition, s.retained_quantity, s.retained_unit, s.lab_order_id, a.analyte_name
              FROM oos_investigation x JOIN sample s ON s.id = x.sample_id JOIN analyte a ON a.id = x.analyte_id WHERE x.id = ?::uuid""", oosId);
        if (o == null) throw new RuleException("OOS investigation not found");
        List<Map<String, Object>> out = new ArrayList<>();
        if (o.get("batch_id") == null) return List.of(chk("batch", "Batch", "Info", "No batch is linked to the result"));
        Map<String, Object> b = db.one("SELECT id, batch_code, status::text AS status, test_version_id FROM test_batch WHERE id = ?::uuid", o.get("batch_id"));
        Object bid = b.get("id"), code = b.get("batch_code");

        // 1. materials in date at the time they were used
        List<Map<String, Object>> lots = db.rows("""
            SELECT DISTINCT l.lot_code, COALESCE(l.item_name, l.item_description) AS name, l.expiration_date, l.retest_date, m.created_at::date AS used_on
              FROM entry_material m JOIN step_run r ON r.id = m.step_run_id JOIN inventory_lot l ON l.id = m.lot_id
             WHERE r.batch_id = ?::uuid AND m.status = 'Active'""", bid);
        List<Map<String, Object>> badLots = lots.stream().filter(l -> before(l.get("expiration_date"), l.get("used_on")) || before(l.get("retest_date"), l.get("used_on"))).toList();
        String lotsTitle = "Standards, reagents and media in date when used";
        out.add(!badLots.isEmpty()
            ? chk("lots", lotsTitle, "Fail", badLots.stream().map(l -> l.get("lot_code") + " " + s(l.get("name")) + ": expiry " + fmtDate(l.get("expiration_date")) + ", used " + fmtDate(l.get("used_on"))).collect(Collectors.joining("; ")))
            : chk("lots", lotsTitle, lots.isEmpty() ? "Info" : "Pass", lots.isEmpty() ? "No lots recorded in " + code
                : lots.size() + " lot" + (lots.size() > 1 ? "s" : "") + " used in " + code + ", all in date"));

        // 2. instruments calibrated and in service at the time of use
        List<Map<String, Object>> eq = db.rows("""
            SELECT DISTINCT e.id, e.equipment_code, e.equipment_name, e.calibration_required, ee.created_at AS used_at
              FROM entry_equipment ee JOIN step_run r ON r.id = ee.step_run_id JOIN equipment e ON e.id = ee.equipment_id WHERE r.batch_id = ?::uuid AND ee.status = 'Active'""", bid);
        List<String> eqBad = new ArrayList<>();
        for (Map<String, Object> e : eq) {
            Map<String, Object> tag = db.one("""
                SELECT tag_code, reason::text AS reason FROM equipment_tag WHERE equipment_id = ?::uuid AND tagged_out_at <= ?::timestamptz
                   AND (tagged_in_at IS NULL OR tagged_in_at >= ?::timestamptz) LIMIT 1""", e.get("id"), e.get("used_at"), e.get("used_at"));
            if (tag != null) eqBad.add(e.get("equipment_code") + " was tagged out (" + tag.get("tag_code") + ", " + tag.get("reason") + ")");
            if (truthy(e.get("calibration_required"))) {
                Map<String, Object> cal = db.one("""
                    SELECT calibration_code FROM calibration WHERE equipment_id = ?::uuid AND performed_date <= ?::timestamptz::date AND expiration_date >= ?::timestamptz::date
                       AND COALESCE(status::text, 'Active') <> 'Inactive' LIMIT 1""", e.get("id"), e.get("used_at"), e.get("used_at"));
                if (cal == null) eqBad.add(e.get("equipment_code") + " had no calibration valid on " + fmtDate(e.get("used_at")));
            }
        }
        String eqTitle = "Instruments calibrated and in service when used";
        out.add(!eqBad.isEmpty() ? chk("equipment", eqTitle, "Fail", String.join("; ", eqBad))
            : chk("equipment", eqTitle, eq.isEmpty() ? "Info" : "Pass", eq.isEmpty() ? "No instrument recorded"
                : eq.stream().map(e -> s(e.get("equipment_code"))).collect(Collectors.joining(", ")) + ": in service, calibration valid"));

        // 3. batch QC
        List<Map<String, Object>> qc = db.rows("SELECT label, analyte_name, limit_type, verdict FROM batch_qc_verdicts(?::uuid)", bid);
        List<Map<String, Object>> acc = orEmpty(() -> db.rows("SELECT entry_id, analyte_id FROM qc_acceptance WHERE batch_id = ?::uuid AND status = 'Active'", bid));
        List<Map<String, Object>> failing = qc.stream().filter(q -> {
            String v = q.get("verdict") == null ? "" : q.get("verdict").toString();
            return !v.startsWith("Pass") && !v.contains("Not judged");
        }).toList();
        if (qc.isEmpty()) out.add(chk("qc", "Batch QC", "Info", "The batch has no QC"));
        else if (!failing.isEmpty()) out.add(chk("qc", "Batch QC", acc.size() >= failing.size() ? "Info" : "Fail",
            failing.size() + " QC verdict" + (failing.size() > 1 ? "s" : "") + " not passing"
                + (acc.isEmpty() ? "" : " (" + acc.size() + " accepted with a justification in QC Review)") + ": "
                + failing.stream().limit(4).map(q -> s(q.get("label")) + " " + (truthy(q.get("analyte_name")) ? q.get("analyte_name") : "") + " " + s(q.get("limit_type")) + ": " + s(q.get("verdict")))
                    .collect(Collectors.joining("; "))));
        else out.add(chk("qc", "Batch QC", "Pass", qc.size() + " QC verdicts in " + code + ", all passing"));

        // 4. the result worked out again from the readings
        List<Map<String, Object>> live = orEmpty(() -> db.rows("""
            SELECT r.value::text AS value, r.run_no, r.is_final, r.entry_id FROM batch_results(?::uuid) r JOIN batch_entry e ON e.id = r.entry_id
             WHERE e.requested_test_id = ?::uuid AND r.analyte_id = ?::uuid AND r.is_final""", bid, o.get("requested_test_id"), o.get("analyte_id")));
        Map<String, Object> tr = o.get("test_result_id") != null
            ? db.one("SELECT value_num::text AS v, reported, entry_id, run_no FROM test_result WHERE id = ?::uuid", o.get("test_result_id")) : null;
        Map<String, Object> target = tr != null
            ? live.stream().filter(l -> Objects.equals(l.get("entry_id"), tr.get("entry_id")) && Js.toNumber(l.get("run_no")) == Js.toNumber(tr.get("run_no"))).findFirst().orElse(null)
            : live.isEmpty() ? null : live.get(0);
        Object storedRaw = tr != null ? tr.get("v") : o.get("value_num");
        if (target != null && target.get("value") != null && storedRaw != null) {
            double from = Js.toNumber(target.get("value")), stored = Js.toNumber(Js.string(storedRaw));
            boolean same = Math.abs(from - stored) <= Math.abs(stored) * 1e-9 + 1e-12;
            out.add(chk("calc", "Result worked out again from the readings", same ? "Pass" : "Fail",
                "From the readings: " + toPrecision(from, 9) + "; investigated: " + toPrecision(stored, 9) + (tr != null ? " (reported " + s(tr.get("reported")) + ")" : "")));
        } else out.add(chk("calc", "Result worked out again from the readings", "Info", "The calculation could not be repeated here (a qualitative result, or a reading missing)"));

        // 5. the people: in the step's department group (training records are not in LIMS3 yet)
        List<Map<String, Object>> ppl = orEmpty(() -> db.rows("""
            SELECT DISTINCT u.full_name, ws.step_name, user_in_department(r.performed_by, COALESCE(ws.department_id, t.department_id)) AS ok
              FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id JOIN test_batch tb ON tb.id = r.batch_id JOIN test t ON t.id = tb.test_id JOIN app_user u ON u.id = r.performed_by
             WHERE r.batch_id = ?::uuid AND r.performed_by IS NOT NULL AND ws.step_type::text NOT IN ('QC Review')""", bid));
        List<Map<String, Object>> notIn = ppl.stream().filter(p -> Boolean.FALSE.equals(p.get("ok"))).toList();
        String pplTitle = "Analysts in the step's department (training)";
        if (!notIn.isEmpty()) out.add(chk("people", pplTitle, "Fail", notIn.stream().map(p -> s(p.get("full_name")) + ": " + s(p.get("step_name"))).collect(Collectors.joining("; "))));
        else {
            String names = ppl.stream().map(p -> s(p.get("full_name"))).collect(Collectors.toCollection(LinkedHashSet::new)).stream().collect(Collectors.joining(", "));
            out.add(chk("people", pplTitle, "Pass", (names.isEmpty() ? "Nobody recorded" : names) + ": in the department group (training records are not in LIMS3 yet)"));
        }

        // 6. raw data attached to every reading step
        List<Map<String, Object>> reads = db.rows("""
            SELECT ws.step_name, (SELECT count(*) FROM step_attachment sa WHERE sa.step_run_id = r.id AND sa.status = 'Active')::int AS files
              FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = ?::uuid AND ws.step_type::text = 'Data Entry'""", bid);
        List<Map<String, Object>> noFile = reads.stream().filter(x -> Js.toNumber(x.get("files")) == 0).toList();
        out.add(chk("rawdata", "Raw data attached to the reading steps", noFile.isEmpty() ? "Pass" : "Info", !noFile.isEmpty()
            ? "No file on: " + noFile.stream().map(x -> s(x.get("step_name"))).collect(Collectors.joining(", "))
            : reads.size() + " reading step" + (reads.size() == 1 ? "" : "s") + " with raw data"));

        // 7. the specification as now on the test
        Map<String, Object> sp = db.one("""
            SELECT min_value::text AS min, max_value::text AS max, text_value, unit, source::text AS source FROM specification
             WHERE requested_test_id = ?::uuid AND analyte_id = ?::uuid AND status = 'Active' LIMIT 1""", o.get("requested_test_id"), o.get("analyte_id"));
        if (sp == null) out.add(chk("spec", "Specification on the test", "Fail", "The test has no specification now"));
        else {
            String limits = truthy(sp.get("text_value")) ? sp.get("text_value").toString() : java.util.stream.Stream.of(
                    sp.get("min") != null ? "≥ " + Js.number(Js.toNumber(sp.get("min"))) : "", sp.get("max") != null ? "≤ " + Js.number(Js.toNumber(sp.get("max"))) : "")
                .filter(x -> !x.isEmpty()).collect(Collectors.joining(" and "));
            out.add(chk("spec", "Specification on the test", "Info", limits + (truthy(sp.get("unit")) ? " " + sp.get("unit") : "") + " (" + s(sp.get("source"))
                + "); check it is the client's intended limit and unit"));
        }

        // 8. the sample: condition on receipt and retained material for a retest
        Object cond = o.get("condition");
        out.add(chk("sample", "Sample on receipt and retained material", truthy(cond) && !"Acceptable".equals(cond) ? "Fail" : "Info",
            "Condition on receipt: " + (truthy(cond) ? cond : "not recorded") + "; retained: " + (o.get("retained_quantity") == null ? "not recorded"
                : Js.number(Js.toNumber(Js.string(o.get("retained_quantity")))) + " " + (truthy(o.get("retained_unit")) ? o.get("retained_unit") : ""))));

        // 9. this client's earlier results for the analyte
        List<Map<String, Object>> hist = db.rows("""
            SELECT tr.value_num::float8 AS v FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN sample s2 ON s2.id = rt.sample_id
              JOIN lab_order o2 ON o2.id = s2.lab_order_id WHERE o2.client_id = (SELECT client_id FROM lab_order WHERE id = ?::uuid) AND tr.analyte_id = ?::uuid AND tr.status = 'Active'
               AND tr.stage = 'Final' AND tr.result_key IS NULL AND rt.id <> ?::uuid AND tr.value_num IS NOT NULL ORDER BY tr.approved_at DESC LIMIT 30""",
            o.get("lab_order_id"), o.get("analyte_id"), o.get("requested_test_id"));
        String histTitle = "This client's earlier results";
        if (hist.size() >= 3) {
            List<Double> v = hist.stream().map(h -> Double.parseDouble(toPrecision(Js.toNumber(h.get("v")), 4))).sorted().toList();
            out.add(chk("history", histTitle, "Info", hist.size() + " earlier results for " + s(o.get("analyte_name")) + ": " + Js.number(v.get(0)) + " to "
                + Js.number(v.get(v.size() - 1)) + " (median " + Js.number(v.get(v.size() / 2)) + ")"));
        } else out.add(chk("history", histTitle, "Info", hist.size() + " earlier result" + (hist.size() == 1 ? "" : "s") + " for " + s(o.get("analyte_name")) + ": too few to compare"));
        return out;
    }

    /** new Date(a) < new Date(b) for two dates read back from the database; false when either is missing. */
    private static boolean before(Object a, Object b) {
        if (!truthy(a)) return false;
        Instant x = instant(a), y = instant(b);
        return x != null && y != null && x.isBefore(y);
    }

    /** new Date(v): a date alone is UTC midnight, a time is the instant it names. */
    private static Instant instant(Object v) {
        if (v == null) return null;
        String t = v.toString();
        try { return LocalDate.parse(t).atStartOfDay(ZoneOffset.UTC).toInstant(); } catch (RuntimeException ignored) { }
        try { return OffsetDateTime.parse(t).toInstant(); } catch (RuntimeException ignored) { }
        try { return Instant.parse(t); } catch (RuntimeException ignored) { return null; }
    }

    /** coa.js fmtDate without a time zone: "Oct 5, 2026" in Los Angeles. */
    static String fmtDate(Object v) {
        Instant i = truthy(v) ? instant(v) : null;
        return i == null ? "" : SHORT_DATE.format(i);
    }

    /** Number.prototype.toPrecision(p) in JavaScript. */
    static String toPrecision(double x, int p) { return Js.toPrecision(x, p); }
}
