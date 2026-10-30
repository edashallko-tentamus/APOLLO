package com.tentamus.lims.reports.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.calc.ResultReporting;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.reports.domain.CoaContent;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * The COA's release check (coa.js checks()), run on the preview and again at signing: Block stops the release, Warning
 * needs a reason, Info is shown, Pass says what was checked. The reported value and the conformance are worked out a
 * second time with {@link ResultReporting}, independently of the database.
 */
public final class CoaChecks {
    private CoaChecks() {}

    /** What reading the rendered PDF back found: the cells read, and those that did not show the record. */
    public record ReadBack(int cells, List<String> mismatches) {}

    private static final ObjectMapper JSON = new ObjectMapper();

    static Map<String, Object> check(String code, String title, String level, String detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", code);
        m.put("title", title);
        m.put("level", level);
        m.put("detail", detail);
        return m;
    }

    private static boolean truthy(Object v) { return Js.truthy(v); }

    private static String t(Object v) { return Html.text(v); }

    private static Map<String, Object> link(String text, String href) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("text", text);
        m.put("href", href);
        return m;
    }

    private static Double numOrNull(Object v) { return v == null ? null : Js.toNumber(t(v)); }

    public static List<Map<String, Object>> checks(Db db, CoaContent c, String userId, ReadBack readBack) {
        List<Map<String, Object>> out = new ArrayList<>();
        List<Map<String, Object>> now = c.testsFinalizedNow();
        List<Object> ids = now.stream().map(x -> x.get("requested_test_id")).collect(Collectors.toList());
        Map<String, Object> sample = c.part("sample");
        // 1. the PDF shows the record
        if (readBack != null) {
            out.add(readBack.mismatches().isEmpty()
                ? check("values", "Values on the PDF match the record", "Pass", readBack.cells() + " values read back from the rendered COA")
                : check("values", "Values on the PDF match the record", "Block", String.join("; ", readBack.mismatches().subList(0, Math.min(5, readBack.mismatches().size())))));
        }
        // 2. specification integrity: as on the test now, same units, not changed after the result was approved
        List<String> specProblems = new ArrayList<>(), specChanged = new ArrayList<>(), unitWarn = new ArrayList<>();
        for (Map<String, Object> test : now) {
            for (Map<String, Object> r : CoaContent.results(test)) {
                Map<String, Object> sp = db.one("""
                    SELECT min_value::text AS min, max_value::text AS max, text_value, unit, modified_at FROM specification
                     WHERE requested_test_id = ?::uuid AND analyte_id = ?::uuid AND status = 'Active' LIMIT 1""", test.get("requested_test_id"), r.get("analyte_id"));
                boolean label = truthy(r.get("label"));
                if (!label) { // the final result carries the comparison
                    if (sp != null && !(Objects.equals(numOrNull(sp.get("min")), numOrNull(r.get("spec_min"))) && Objects.equals(numOrNull(sp.get("max")), numOrNull(r.get("spec_max")))
                        && Objects.equals(truthy(sp.get("text_value")) ? sp.get("text_value") : null, truthy(r.get("spec_text")) ? r.get("spec_text") : null)))
                        specProblems.add(test.get("test_name") + " " + t(r.get("analyte")));
                    if (sp == null && (r.get("spec_min") != null || r.get("spec_max") != null || truthy(r.get("spec_text"))))
                        specProblems.add(test.get("test_name") + " " + t(r.get("analyte")) + " (the specification was removed)");
                    if (sp != null && truthy(sp.get("unit")) && truthy(r.get("unit")) && !sp.get("unit").equals(r.get("unit")))
                        unitWarn.add(t(r.get("analyte")) + ": specification in " + sp.get("unit") + ", result in " + r.get("unit"));
                }
                Map<String, Object> ch = db.one("""
                    SELECT max(a.changed_at) AS at FROM audit_log a JOIN specification sp ON sp.id = a.record_id
                     WHERE a.table_name = 'specification' AND sp.requested_test_id = ?::uuid AND sp.analyte_id = ?::uuid AND a.changed_at > ?::timestamptz""",
                    test.get("requested_test_id"), r.get("analyte_id"), r.get("approved_at"));
                if (ch != null && ch.get("at") != null && !label) specChanged.add(test.get("test_name") + " " + t(r.get("analyte")));
            }
        }
        out.add(!specProblems.isEmpty() ? check("spec", "Specification as on the ordered test", "Block", "The stored result was compared with a different specification: " + String.join(", ", specProblems))
            : !specChanged.isEmpty() ? check("spec", "Specification as on the ordered test", "Block", "The specification was changed after the result was approved: " + String.join(", ", specChanged) + ". Return the batch to QC Review to compare again.")
            : check("spec", "Specification as on the ordered test", "Pass", "Each result was compared with the specification on its test, unchanged since"));
        if (!unitWarn.isEmpty()) out.add(check("units", "Specification and result units", "Warning", String.join("; ", unitWarn)));
        // 3. reported value and conformance worked out again, independently of the database
        List<String> confBad = new ArrayList<>(), roundBad = new ArrayList<>();
        for (Map<String, Object> test : now) {
            for (Map<String, Object> r : CoaContent.results(test)) {
                boolean label = truthy(r.get("label"));
                if (r.get("value_num") != null) {
                    Map<String, Object> ver = db.one("""
                        SELECT tv.rounding_mode, tv.rounding_digits, tv.nd_below_lod FROM requested_test rt JOIN test_version tv ON tv.id = rt.test_version_id WHERE rt.id = ?::uuid""",
                        test.get("requested_test_id"));
                    try {
                        String rep = ResultReporting.reportValue(t(r.get("value_num")), r.get("loq") == null ? null : t(r.get("loq")), r.get("lod") == null ? null : t(r.get("lod")),
                            r.get("rounding_mode") == null ? null : t(r.get("rounding_mode")), r.get("rounding_digits") == null ? null : ((Number) r.get("rounding_digits")).intValue(),
                            Boolean.TRUE.equals(ver.get("nd_below_lod")), ver.get("rounding_mode") == null ? null : t(ver.get("rounding_mode")),
                            ver.get("rounding_digits") == null ? null : ((Number) ver.get("rounding_digits")).intValue());
                        if (rep != null && !rep.equals(t(r.get("reported"))))
                            roundBad.add(t(r.get("analyte")) + (label ? " (" + t(r.get("label")) + ")" : "") + ": reported " + t(r.get("reported")) + ", worked out " + rep);
                    } catch (RuntimeException e) { /* not a number the oracle reads: compared below on conformance only */ }
                }
                if (label) continue;
                ResultReporting.Spec spec = r.get("spec_min") == null && r.get("spec_max") == null && !truthy(r.get("spec_text")) ? null
                    : new ResultReporting.Spec(r.get("spec_min") == null ? null : t(r.get("spec_min")), r.get("spec_max") == null ? null : t(r.get("spec_max")));
                // a limit per serving or per package (031): compared with the amount printed in that column, in the limit's unit
                String basisUnit = truthy(r.get("spec_basis")) && truthy(r.get("spec_unit")) ? t(r.get("spec_unit")).replaceFirst(" per (serving|package)$", "") : null;
                Object conf;
                if (truthy(r.get("spec_basis"))) {
                    conf = r.get("basis_value") != null && Objects.equals(basisUnit, r.get("basis_unit")) ? ResultReporting.conformance(spec, List.of(), t(r.get("basis_value")), null)
                        : r.get("basis_value") == null ? "Not compared" : r.get("conformance");
                } else if (spec != null && truthy(r.get("spec_unit")) && truthy(r.get("unit")) && !r.get("spec_unit").equals(r.get("unit"))) conf = r.get("conformance");
                else conf = ResultReporting.conformance(spec, List.of(), r.get("reported") == null ? null : t(r.get("reported")), r.get("value_text") == null ? null : t(r.get("value_text")));
                if (spec != null && spec.min() == null && spec.max() == null) continue; // a text limit: judged in QC Review
                if (!Objects.equals(conf, r.get("conformance")) && !("No specification".equals(conf) && "No specification".equals(r.get("conformance"))))
                    confBad.add(t(r.get("analyte")) + ": stored " + t(r.get("conformance")) + ", worked out " + t(conf));
            }
        }
        out.add(!confBad.isEmpty() ? check("conformance", "Conformance worked out again", "Block", String.join("; ", confBad))
            : check("conformance", "Conformance worked out again", "Pass", "Every result's conformance agrees with a second, independent comparison"));
        if (!roundBad.isEmpty()) out.add(check("rounding", "Reported value worked out again", "Block", String.join("; ", roundBad)));
        // 4. history: far from the same project's (or client's) earlier finalized results for the same test and analyte
        List<String> hist = new ArrayList<>();
        for (Map<String, Object> test : now) {
            for (Map<String, Object> r : CoaContent.results(test)) {
                if (truthy(r.get("label")) || r.get("value_num") == null || Js.toNumber(t(r.get("value_num"))) <= 0) continue;
                List<Map<String, Object>> prior = db.rows("""
                    WITH me AS (SELECT rt.test_id, q.project_version_id, pv.project_id, o.client_id FROM requested_test rt
                           LEFT JOIN quoted_test_configuration q ON q.id = rt.quoted_line_id LEFT JOIN project_version pv ON pv.id = q.project_version_id
                           JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = ?::uuid)
                      SELECT tr.value_num::float8 AS v, (pv2.project_id = me.project_id) AS same_project
                        FROM me, test_result tr JOIN requested_test rt2 ON rt2.id = tr.requested_test_id JOIN sample s2 ON s2.id = rt2.sample_id JOIN lab_order o2 ON o2.id = s2.lab_order_id
                        LEFT JOIN quoted_test_configuration q2 ON q2.id = rt2.quoted_line_id LEFT JOIN project_version pv2 ON pv2.id = q2.project_version_id
                       WHERE rt2.test_id = me.test_id AND o2.client_id = me.client_id AND rt2.id <> ?::uuid AND tr.analyte_id = ?::uuid AND tr.status = 'Active' AND tr.stage = 'Final'
                         AND tr.result_key IS NULL AND tr.value_num > 0 AND test_is_finalized(rt2.id)
                       ORDER BY tr.approved_at DESC LIMIT 50""", test.get("requested_test_id"), test.get("requested_test_id"), r.get("analyte_id"));
                List<Map<String, Object>> proj = prior.stream().filter(p -> Boolean.TRUE.equals(p.get("same_project"))).toList();
                boolean onProject = proj.size() >= 3;
                List<Map<String, Object>> set = onProject ? proj : prior;
                if (set.size() < 3) continue;
                List<Double> vals = set.stream().map(p -> ((Number) p.get("v")).doubleValue()).sorted().toList();
                double med = vals.get(vals.size() / 2);
                double ratio = Js.toNumber(t(r.get("value_num"))) / med;
                if (ratio >= 5 || ratio <= 0.2) {
                    hist.add(t(r.get("analyte")) + " " + t(r.get("reported")) + " " + t(r.get("unit")) + " is " + (ratio >= 1 ? Js.toFixed(ratio, 1) + " times" : Js.toFixed(1 / ratio, 1) + " times less than")
                        + " the median (" + Js.number(med) + " " + t(r.get("unit")) + ") of " + set.size() + " earlier results " + (onProject ? "on this project" : "for this client"));
                }
            }
        }
        out.add(!hist.isEmpty() ? check("history", "Results against this client's history", "Warning", String.join("; ", hist) + ". Check units and decimal places.")
            : check("history", "Results against this client's history", "Pass", "No result is far (5 times) from the project's or client's earlier results, where there are at least 3"));
        // 4b. the photos a photo layout prints (0.29.0)
        int needP = CoaDocument.photosNeeded(c.list("sections"));
        if (needP > 0) {
            List<Integer> have = c.list("photos").stream().map(p -> ((Number) p.get("slot")).intValue()).toList();
            List<Integer> miss = new ArrayList<>();
            for (int k = 1; k <= needP; k++) if (!have.contains(k)) miss.add(k);
            out.add(!miss.isEmpty() ? check("photos", "Photos the report layout prints", "Block", "The report layout needs " + (needP == 1 ? "a photo" : "two photos") + " of the sample: mark "
                    + miss.stream().map(k -> "\"Report photo " + k + "\"").collect(Collectors.joining(" and ")) + " on the sample's photos (sample page, Photos).")
                : check("photos", "Photos the report layout prints", "Pass", (needP == 1 ? "The sample's report photo is" : "Both report photos are") + " on file"));
        }
        // 5. identity: sample details changed after logging
        List<Map<String, Object>> idc = db.rows("""
            SELECT a.changed_at, a.changed_fields, u.full_name, a.reason FROM audit_log a JOIN app_user u ON u.id = a.changed_by
             WHERE a.table_name = 'sample' AND a.record_id = ?::uuid AND a.action = 'UPDATE' AND a.changed_at > (SELECT logged_at FROM sample WHERE id = ?::uuid) ORDER BY a.changed_at""",
            sample.get("id"), sample.get("id"));
        List<String> idFields = List.of("client_sample_id", "description", "matrix", "product", "lot", "batch", "compliance_category", "metrc_id");
        List<String> idChanges = new ArrayList<>();
        for (Map<String, Object> a : idc) {
            if (!(a.get("changed_fields") instanceof JsonNode cf) || !cf.isObject()) continue;
            for (Iterator<String> it = cf.fieldNames(); it.hasNext(); ) {
                String f = it.next();
                if (!idFields.contains(f)) continue;
                idChanges.add(f.replace("_", " ") + " \"" + side(cf.get(f), "old") + "\" to \"" + side(cf.get(f), "new") + "\" by " + t(a.get("full_name"))
                    + (truthy(a.get("reason")) ? " (" + a.get("reason") + ")" : ""));
            }
        }
        out.add(!idChanges.isEmpty() ? check("identity", "Sample details since logging", "Warning", String.join("; ", idChanges))
            : check("identity", "Sample details since logging", "Pass", "Sample ID, client ID, description, lot and category unchanged since the sample was logged"));
        if (!truthy(sample.get("compliance_category"))) out.add(check("category", "Compliance category", "Warning", "The sample has no compliance category (from the submission form)"));
        // 6. completeness
        List<Map<String, Object>> pending = c.list("pending");
        out.add(check("complete", "Tests on the sample", pending.isEmpty() ? "Pass" : "Info", pending.isEmpty() ? "Every test ordered on the sample is on this COA: it is the final version"
            : pending.size() + " test" + (pending.size() > 1 ? "s" : "") + " still in the lab (" + pending.stream().map(p -> t(p.get("test_name"))).collect(Collectors.joining(", ")) + "): "
                + (truthy(c.get("allow_partial")) ? "listed as in progress on this version" : "the client takes no partial reports, so the COA is issued when the last test is finalized")));
        // 7. holds: an open OOS holds the result; an out-of-specification result needs a concluded one (R-2)
        List<String> oosBlocks = new ArrayList<>(), oosConfirmed = new ArrayList<>();
        List<Map<String, Object>> oosLinks = new ArrayList<>();
        for (Map<String, Object> test : now) {
            Map<String, Object> p = db.one("SELECT oos_release_problem(?::uuid) AS p", test.get("requested_test_id"));
            if (p != null && truthy(p.get("p"))) {
                oosBlocks.add(test.get("test_name") + ": " + t(p.get("p")));
                // a link to the investigation (or to the sample page, where "Open OOS..." is, when none is open yet)
                Map<String, Object> x = db.one("SELECT id, oos_code FROM oos_investigation WHERE requested_test_id = ?::uuid AND status <> 'Cancelled' ORDER BY opened_at DESC LIMIT 1",
                    test.get("requested_test_id"));
                oosLinks.add(x != null ? link("Open " + x.get("oos_code"), "#/oos/" + x.get("id")) : link("Open the sample (to open the OOS)", "#/samples/" + sample.get("id")));
            }
            for (Map<String, Object> x : db.rows("""
                SELECT x.oos_code, a.analyte_name, x.reported, x.unit, x.client_notified_at FROM oos_investigation x JOIN analyte a ON a.id = x.analyte_id
                  JOIN test_result tr ON tr.id = x.test_result_id WHERE x.requested_test_id = ?::uuid AND x.status = 'Closed' AND x.conclusion = 'OOS confirmed' AND tr.status = 'Active'""",
                test.get("requested_test_id"))) {
                oosConfirmed.add(x.get("oos_code") + ": " + x.get("analyte_name") + " " + t(x.get("reported")) + (truthy(x.get("unit")) ? " " + x.get("unit") : "")
                    + (truthy(x.get("client_notified_at")) ? "" : " (the client is emailed the OOS and the Phase II re-testing options when this COA is issued)"));
            }
        }
        // logbook values behind the results (migration 035): every entry approved, no correction flag open
        List<String> lbBlocks = new ArrayList<>();
        for (Map<String, Object> test : now) {
            Map<String, Object> p = db.one("SELECT logbook_release_problem(?::uuid) AS p", test.get("requested_test_id"));
            if (p != null && truthy(p.get("p"))) lbBlocks.add(test.get("test_name") + ": " + t(p.get("p")));
        }
        if (!lbBlocks.isEmpty()) out.add(check("logbook", "Logbook entries behind the results", "Block", String.join("; ", lbBlocks)));
        boolean onHold = truthy(c.get("client_on_hold"));
        if (onHold) out.add(check("hold", "Client hold", "Block", "The client is On Hold: reports cannot be released"));
        if (!oosBlocks.isEmpty()) {
            Map<String, Object> k = check("oos", "Out of specification", "Block", String.join("; ", oosBlocks));
            k.put("links", oosLinks);
            out.add(k);
        } else if (!oosConfirmed.isEmpty()) {
            out.add(check("oos", "Out of specification (confirmed)", "Info", "Released as out of specification after the investigation: " + String.join("; ", oosConfirmed)));
        }
        // the OOS loop (migration 028): a COA carrying a confirmed OOS is not the final one until the client's Phase II decision
        Map<String, Object> p2 = db.one("SELECT oos_awaiting_phase2(?::uuid) AS w", sample.get("id"));
        if (p2 != null && truthy(p2.get("w"))) out.add(check("phase2", "Client's Phase II decision", "Info", "This COA carries a confirmed OOS: it is not the final COA until the client's Phase II decision is recorded on the sample (re-test ordered, or no re-test). The final COA follows."));
        // handwritten signature (migration 028) and serving size
        if (!truthy(c.part("authorized").get("has_signature"))) out.add(check("signature", "Your handwritten signature", "Block", "You have no handwritten signature and title on file: a lab administrator adds them (Admin > People and groups). The COA prints them under the signature line."));
        // Alex (2026-10-14): nothing per serving is released before the serving weight or density is measured, approved and used
        List<String> servingHeld = new ArrayList<>();
        for (Map<String, Object> test : now) if (c.servingProblem(test.get("requested_test_id")) != null) servingHeld.add(test.get("test_name") + ": " + c.servingProblem(test.get("requested_test_id")));
        if (!servingHeld.isEmpty()) {
            Map<String, Object> k = check("serving_measured", "Serving weight or density measured", "Block", "Results per serving cannot be released yet. " + String.join("; ", servingHeld) + ".");
            k.put("links", List.of(link("Open the sample (order or request the serving test)", "#/samples/" + sample.get("id"))));
            out.add(k);
        }
        // limits per serving or per package need the sample's serving weight (and the servings per package): 031
        List<String> basisMissing = new ArrayList<>();
        for (Map<String, Object> test : now) {
            if (c.servingProblem(test.get("requested_test_id")) != null) continue;
            for (Map<String, Object> r : CoaContent.results(test))
                if (truthy(r.get("spec_basis")) && r.get("basis_value") == null) basisMissing.add(t(r.get("analyte")) + " (" + t(r.get("spec_basis")).toLowerCase() + ")");
        }
        if (!basisMissing.isEmpty()) out.add(check("serving_limit", "Limits per serving or package", "Warning", "Not compared: " + String.join(", ", basisMissing) + ". The sample needs its serving weight"
            + (basisMissing.stream().anyMatch(x -> x.contains("package")) ? " and servings per package" : "") + " on the order page."));
        if (!onHold && oosBlocks.isEmpty() && oosConfirmed.isEmpty()) out.add(check("hold", "Holds", "Pass", "No client hold and no out-of-specification result"));
        // 8. independence
        List<Map<String, Object>> did = db.rows("""
            SELECT DISTINCT t.test_name FROM requested_test rt JOIN test t ON t.id = rt.test_id JOIN batch_entry e ON e.requested_test_id = rt.id
                JOIN test_batch b ON b.id = e.batch_id JOIN step_run r ON r.batch_id = b.id
             WHERE rt.id = ANY(?::uuid[]) AND b.status <> 'Cancelled' AND (r.performed_by = ?::uuid OR r.witness_id = ?::uuid OR b.reviewed_by = ?::uuid)""", ids, userId, userId, userId);
        out.add(!did.isEmpty() ? check("independence", "Someone else's work", "Block", "You performed, witnessed or reviewed " + did.stream().map(x -> t(x.get("test_name"))).collect(Collectors.joining(", ")))
            : check("independence", "Someone else's work", "Pass", "You did not perform, witness or review this work"));
        // 9. dates
        Map<String, Object> dt = db.one("""
            SELECT bool_or(r.completed_at < s.logged_at) AS before_login, bool_or(r.completed_at > clock_timestamp()) AS future
              FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN batch_entry e ON e.requested_test_id = rt.id JOIN step_run r ON r.batch_id = e.batch_id
             WHERE rt.id = ANY(?::uuid[]) AND r.completed_at IS NOT NULL""", ids);
        boolean beforeLogin = dt != null && Boolean.TRUE.equals(dt.get("before_login")), future = dt != null && Boolean.TRUE.equals(dt.get("future"));
        out.add(beforeLogin || future ? check("dates", "Dates", "Block", beforeLogin ? "Work recorded before the sample was logged" : "Work dated in the future")
            : check("dates", "Dates", "Pass", "The work is dated after the sample was logged and before now"));
        // 10. the difference from the last version the client received
        Map<String, Object> sup = c.part("supersedes");
        if (sup != null) {
            Map<String, Object> last = db.one("SELECT v.content FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = ?::uuid ORDER BY v.version_no DESC LIMIT 1", sample.get("id"));
            JsonNode lc = last == null ? null : (JsonNode) last.get("content");
            Map<String, JsonNode> old = new LinkedHashMap<>();
            if (lc != null && lc.path("tests").isArray()) for (JsonNode ot : lc.get("tests")) for (JsonNode or : ot.path("results"))
                old.put(key(ot.get("test_name")) + "|" + key(or.get("analyte")) + "|" + key(or.get("label")), or);
            List<String> changed = new ArrayList<>(), added = new ArrayList<>();
            for (Map<String, Object> test : c.list("tests")) for (Map<String, Object> r : CoaContent.results(test)) {
                String lbl = truthy(r.get("label")) ? " (" + t(r.get("label")) + ")" : "";
                JsonNode o = old.get(t(test.get("test_name")) + "|" + t(r.get("analyte")) + "|" + jsKey(r.get("label")));
                if (o == null) added.add(test.get("test_name") + " " + t(r.get("analyte")) + lbl);
                else if (!same(o.get("reported"), r.get("reported")) || !same(o.get("unit"), r.get("unit")) || !same(o.get("spec"), r.get("spec")) || !same(o.get("conformance"), r.get("conformance")))
                    changed.add(t(r.get("analyte")) + lbl + ": " + key(o.get("reported")) + " " + key(o.get("unit")) + " to " + t(r.get("reported")) + " " + t(r.get("unit")));
            }
            // JSON.stringify of the stored notes (as jsonb returns them) against the new ones, as Node compared them
            String oldNotes, newNotes;
            try {
                oldNotes = lc != null && lc.hasNonNull("notes") && truthyNode(lc.get("notes")) ? JSON.writeValueAsString(lc.get("notes")) : "[]";
                newNotes = JSON.writeValueAsString(c.list("notes"));
            } catch (Exception e) { throw new IllegalStateException(e); }
            String v = t(sup.get("version_no"));
            if (!changed.isEmpty()) out.add(check("changes", "Changes from version " + v, "Warning", "A result the client already received changes: " + String.join("; ", changed)));
            List<String> parts = new ArrayList<>();
            parts.add(added.isEmpty() ? "No new results" : "Added: " + String.join(", ", added));
            if (!oldNotes.equals(newNotes)) parts.add("the notes changed");
            out.add(check("added", "New since version " + v, "Info", String.join("; ", parts)));
        }
        if (truthy(c.get("is_gmp"))) out.add(check("gmp", "GMP work", "Info", "Finalized by the quality team (reports.finalize_gmp)"));
        return out;
    }

    private static boolean truthyNode(JsonNode n) { return !n.isNull() && !(n.isBoolean() && !n.booleanValue()) && !(n.isTextual() && n.asText().isEmpty()) && !(n.isNumber() && n.doubleValue() == 0); }

    /** A changed field's old or new value as `${x ?? ''}` writes it. */
    private static String side(JsonNode f, String k) {
        JsonNode v = f == null ? null : f.get(k);
        return v == null || v.isNull() ? "" : t(v);
    }

    /** `${x}` for a stored JSON value: a missing one is "undefined", null "null". */
    private static String key(JsonNode v) { return v == null || v.isMissingNode() ? "undefined" : v.isNull() ? "null" : t(v); }

    private static String jsKey(Object v) { return v == null ? "null" : t(v); }

    /** o.x !== r.x for a stored value and a new one (strings compared as strings, null with null). */
    private static boolean same(JsonNode o, Object n) {
        if (o == null || o.isMissingNode()) return false;
        if (o.isNull()) return n == null;
        if (n == null) return false;
        if (o.isTextual()) return n instanceof String && o.asText().equals(n);
        if (o.isNumber()) return n instanceof Number num && o.doubleValue() == num.doubleValue();
        return false;
    }
}
