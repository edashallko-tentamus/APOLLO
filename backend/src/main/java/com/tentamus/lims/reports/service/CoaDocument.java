package com.tentamus.lims.reports.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.documents.QrCode;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.reports.domain.CoaContent;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * The Certificate of Analysis as a document (the Node backend's coa.js content() and html()): the version's content built
 * from the record (lab, client, sample, the tests finalized now and before with their final results, specification and
 * conformance, the tests still in the lab, notes, report parts per template, photos, the version line and verification
 * code), and the page that becomes the PDF, whose data-check cells are read back before it is printed.
 */
public final class CoaDocument {
    private CoaDocument() {}

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Pattern PLAIN = Pattern.compile("^-?\\d*\\.?\\d+$");

    private static String esc(Object s) { return Html.esc(s); }

    private static boolean truthy(Object v) {
        if (v instanceof JsonNode n) return !n.isNull() && !n.isMissingNode() && (n.isBoolean() ? n.booleanValue() : n.isNumber() ? n.doubleValue() != 0 : !n.isTextual() || !n.asText().isEmpty());
        return Js.truthy(v);
    }

    private static String numText(Object v) { return v == null ? null : Js.number(Js.toNumber(Html.text(v))); }

    private static String specText(Map<String, Object> r) {
        if (truthy(r.get("spec_text"))) return Html.text(r.get("spec_text"));
        List<String> parts = new ArrayList<>();
        if (r.get("spec_min") != null) parts.add("≥ " + numText(r.get("spec_min")));
        if (r.get("spec_max") != null) parts.add("≤ " + numText(r.get("spec_max")));
        return parts.isEmpty() ? "" : String.join(" and ", parts) + (truthy(r.get("spec_unit")) ? " " + r.get("spec_unit") : "");
    }

    /** 12 characters in three groups, no easily confused letters. */
    public static String newVerifyCode() {
        String a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        byte[] b = new byte[12];
        RANDOM.nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < 12; i++) s.append(a.charAt((b[i] & 0xFF) % a.length()));
        return s.substring(0, 4) + "-" + s.substring(4, 8) + "-" + s.substring(8);
    }

    private static Object or(Object v, Object d) { return truthy(v) ? v : d; }

    // ------------------------------------------------------------------ content
    public static CoaContent content(Db db, String sampleId, List<Object> testIds, String userId, String verifyBase, String verifyCode) {
        Map<String, Object> s = db.one("""
            SELECT s.*, o.order_code, o.po_number, o.notes AS order_notes, o.site_id, o.client_id, o.ordering_contact_id, o.submission_channel::text AS channel,
                COALESCE(c.display_name, c.legal_name) AS client_name, c.client_code, c.site_address, c.billing_address, c.account_status::text AS account_status, c.allow_partial_reports,
                c.is_gmp_client, si.site_name, si.site_code, si.address AS site_address_lab, si.time_zone, ct.first_name || ' ' || ct.last_name AS contact_name, ct.email AS contact_email,
                sample_is_gmp(s.id) AS is_gmp
              FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id JOIN lab_site si ON si.id = o.site_id
              LEFT JOIN contact ct ON ct.id = o.ordering_contact_id WHERE s.id = ?::uuid""", sampleId);
        if (s == null) throw new RuleException("Sample not found");
        Map<String, Object> coa = db.one("SELECT * FROM coa WHERE sample_id = ?::uuid", sampleId);
        Map<String, Object> prev = coa == null ? null
            : db.one("SELECT version_no, issued_at, sha256, verify_code FROM coa_version WHERE coa_id = ?::uuid ORDER BY version_no DESC LIMIT 1", coa.get("id"));
        // the signer's handwritten signature and title (migration 028): printed on the COA under the signature line
        Map<String, Object> me = db.one("""
            SELECT u.full_name, u.title, u.is_automated, f.mime_type AS sig_type, encode(f.content, 'base64') AS sig_b64
              FROM app_user u LEFT JOIN document_file f ON f.id = u.signature_document_id WHERE u.id = ?::uuid""", userId);
        Object now = db.one("SELECT clock_timestamp() AS t").get("t");
        List<Map<String, Object>> tests = db.rows("""
            SELECT rt.id, rt.test_id, t.test_code, t.test_name, tv.version_no, tv.report_per_serving, t.serving_role, serving_problem(rt.id) AS serving_problem, test_report_template(rt.id) AS template_id, m.method_name, m.sop_code, rt.status::text AS status,
                test_is_finalized(rt.id) AS finalized, test_awaits_finalization(rt.id) AS awaits
              FROM requested_test rt JOIN test t ON t.id = rt.test_id JOIN test_version tv ON tv.id = rt.test_version_id LEFT JOIN method m ON m.id = tv.method_id
             WHERE rt.sample_id = ?::uuid AND rt.status <> 'Cancelled' AND NOT test_is_replaced(rt.id) ORDER BY t.test_name""", sampleId);
        Set<String> chosen = testIds.stream().map(String::valueOf).collect(Collectors.toSet());
        for (Map<String, Object> t : tests)
            if (chosen.contains(String.valueOf(t.get("id"))) && !Boolean.TRUE.equals(t.get("awaits"))) throw new RuleException(t.get("test_name") + " on " + s.get("sample_code") + " does not wait for finalization");
        List<Map<String, Object>> notes = db.rows("""
            SELECT n.id, n.kind, n.note_text, n.requested_test_id, n.analyte_id FROM coa_note n WHERE n.sample_id = ?::uuid AND n.status = 'Active' ORDER BY n.created_at""", sampleId);
        List<String> resultIds = new ArrayList<>();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("coa_code", coa != null ? coa.get("coa_code") : "COA-" + s.get("sample_code"));
        int versionNo = prev != null ? ((Number) prev.get("version_no")).intValue() + 1 : 1;
        out.put("version_no", versionNo);
        out.put("verify_code", verifyCode != null && !verifyCode.isEmpty() ? verifyCode : newVerifyCode());
        // the report ID the client sees: the sample ID followed by R and the version (Alex, 2026-10-14)
        out.put("report_id", s.get("sample_code") + "-R" + versionNo);
        out.put("verify_url", (verifyBase == null ? "" : verifyBase) + "/verify.html?c=" + out.get("verify_code"));
        out.put("supersedes", prev == null ? null : map("version_no", prev.get("version_no"), "issued_at", prev.get("issued_at"), "sha256", prev.get("sha256")));
        // the lab's accreditation statement and images (migration 030): the images go to the PDF but not into the stored content
        Map<String, Object> lab = db.one("SELECT accreditation_body, accreditation_certificate, accreditation_statement FROM lab_site WHERE id = ?::uuid", s.get("site_id"));
        List<Map<String, Object>> media = db.rows("""
            SELECT m.kind, m.document_id, f.mime_type, encode(f.content, 'base64') AS b64 FROM site_media m JOIN document_file f ON f.id = m.document_id
             WHERE m.site_id = ?::uuid AND m.status = 'Active' AND m.kind IN ('Logo','Accreditation mark')""", s.get("site_id"));
        Map<String, Object> logo = media.stream().filter(m -> "Logo".equals(m.get("kind"))).findFirst().orElse(null);
        Map<String, Object> markImg = media.stream().filter(m -> "Accreditation mark".equals(m.get("kind"))).findFirst().orElse(null);
        out.put("lab", map("name", s.get("site_name"), "code", s.get("site_code"), "address", or(s.get("site_address_lab"), ""),
            "accreditation", lab != null && truthy(lab.get("accreditation_statement")) ? lab.get("accreditation_statement") : "",
            "logo_id", logo != null ? logo.get("document_id") : null, "mark_id", markImg != null ? markImg.get("document_id") : null));
        String logoData = logo != null ? "data:" + logo.get("mime_type") + ";base64," + b64(logo.get("b64")) : null;
        String markData = markImg != null ? "data:" + markImg.get("mime_type") + ";base64," + b64(markImg.get("b64")) : null;
        out.put("client", map("name", s.get("client_name"), "code", s.get("client_code"), "address", or(s.get("site_address"), or(s.get("billing_address"), "")), "contact", or(s.get("contact_name"), "")));
        // the client's license the order names (0.32.0, migration 055)
        Map<String, Object> lic = db.one("""
            SELECT l.license_type, l.license_number, l.issuing_authority, l.expires_on FROM lab_order o JOIN client_license l ON l.id = o.client_license_id WHERE o.order_code = ?""", s.get("order_code"));
        out.put("order", map("order_code", s.get("order_code"), "po_number", or(s.get("po_number"), ""),
            "license", lic != null ? lic.get("license_type") + " " + lic.get("license_number") + (truthy(lic.get("issuing_authority")) ? " (" + lic.get("issuing_authority") + ")" : "") : ""));
        Object servingSize = s.get("serving_size");
        String serving = "";
        if (servingSize != null) {
            // e.g. "2 capsules (1.2 g)"; the weight is what per-serving amounts use (migration 031)
            String measured = s.get("unit_weight_result_id") != null ? ", measured" : "";
            String base = truthy(s.get("serving_count"))
                ? numText(s.get("serving_count")) + " " + or(s.get("serving_count_unit"), "") + " (" + numText(servingSize) + " " + or(s.get("serving_unit"), "") + measured + ")"
                : numText(servingSize) + " " + or(s.get("serving_unit"), "") + (s.get("unit_weight_result_id") != null ? " (measured)" : "");
            serving = base.trim() + (s.get("density_result_id") != null ? "; density " + numText(s.get("density")) + " " + or(s.get("density_unit"), "") + " (measured)" : "");
        }
        out.put("sample", map("id", s.get("id"), "sample_code", s.get("sample_code"), "client_sample_id", or(s.get("client_sample_id"), ""), "description", or(s.get("description"), ""),
            "matrix", or(s.get("matrix"), ""), "product", or(s.get("product"), ""), "lot", or(s.get("lot"), ""), "batch", or(s.get("batch"), ""),
            "compliance_category", or(s.get("compliance_category"), ""), "condition", or(s.get("condition"), ""), "metrc_id", or(s.get("metrc_id"), ""),
            "received", or(s.get("received_at"), s.get("logged_at")), "logged", s.get("logged_at"), "temperature", Html.jsNumber(s.get("receipt_temperature")),
            "serving", serving, "servings_per_package", s.get("servings_per_package") != null ? numText(s.get("servings_per_package")) : ""));
        List<Map<String, Object>> outTests = new ArrayList<>(), pending = new ArrayList<>();
        Map<String, String> servingProblems = new HashMap<>();
        Map<Map<String, Object>, List<Object>> testNoteIds = new java.util.IdentityHashMap<>();
        Map<Map<String, Object>, List<Object>> resultNoteIds = new java.util.IdentityHashMap<>();
        for (Map<String, Object> t : tests) {
            String tid = String.valueOf(t.get("id"));
            if (!(chosen.contains(tid) || Boolean.TRUE.equals(t.get("finalized")))) {
                pending.add(map("requested_test_id", t.get("id"), "test_name", t.get("test_name"), "test_code", t.get("test_code"), "template_id", t.get("template_id")));
                continue;
            }
            List<Map<String, Object>> rows = db.rows("""
                SELECT tr.id, tr.analyte_id, COALESCE(a.report_name, a.analyte_name) AS analyte, tr.result_key, tr.reported, tr.value_num::text AS value_num, tr.value_text,
                    tr.unit, tr.spec_min::text AS spec_min, tr.spec_max::text AS spec_max, tr.spec_text, tr.spec_unit, tr.conformance, tr.approved_at,
                    tva.loq::text AS loq, tva.lod::text AS lod, tva.hide_loq, tva.hide_lod, tva.hide_on_report, tva.sort_order, tva.rounding_mode, tva.rounding_digits,
                    tva.uncertainty::text AS uncertainty, tva.uncertainty_kind, tva.report_uncertainty,
                    (SELECT ws.step_name FROM workflow_step ws WHERE ws.test_version_id = b.test_version_id AND ws.step_key = tr.result_key AND ws.status = 'Active' LIMIT 1) AS result_name,
                    (SELECT sp.source::text FROM specification sp WHERE sp.requested_test_id = tr.requested_test_id AND sp.analyte_id = tr.analyte_id AND sp.status = 'Active' LIMIT 1) AS spec_source,
                    (SELECT sp.basis FROM specification sp WHERE sp.requested_test_id = tr.requested_test_id AND sp.analyte_id = tr.analyte_id AND sp.status = 'Active' LIMIT 1) AS spec_basis
                  FROM test_result tr JOIN analyte a ON a.id = tr.analyte_id JOIN test_batch b ON b.id = tr.batch_id
                  LEFT JOIN test_version_analyte tva ON tva.test_version_id = b.test_version_id AND tva.analyte_id = tr.analyte_id AND tva.status = 'Active'
                 WHERE tr.requested_test_id = ?::uuid AND tr.status = 'Active' AND tr.stage = 'Final'
                 ORDER BY tva.sort_order NULLS LAST, (tr.result_key IS NULL), tr.result_key""", t.get("id"));
            Map<String, Object> dates = db.one("""
                SELECT min(r.completed_at) AS first, max(r.completed_at) AS last FROM batch_entry e JOIN step_run r ON r.batch_id = e.batch_id
                  JOIN test_batch b ON b.id = e.batch_id WHERE e.requested_test_id = ?::uuid AND b.status <> 'Cancelled' AND r.completed_at IS NOT NULL""", t.get("id"));
            boolean staged = rows.stream().anyMatch(r -> truthy(r.get("result_key")));
            // per serving when the test reports so or the sample asks for it (033); a serving test's own result is not per serving
            boolean perServing = (truthy(t.get("report_per_serving")) || truthy(s.get("report_per_serving"))) && !truthy(t.get("serving_role")) && servingSize != null;
            List<Map<String, Object>> results = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                if (truthy(r.get("hide_on_report"))) continue;
                resultIds.add(String.valueOf(r.get("id")));
                Object reportedV = r.get("reported") != null ? r.get("reported") : r.get("value_text") != null ? r.get("value_text") : "";
                String reported = Html.text(reportedV);
                boolean plain = PLAIN.matcher(reported.trim()).matches();
                // measurement uncertainty (migration 028): ± in the result's unit, or a % of it, to the reported decimals
                String unc = "";
                if (truthy(r.get("report_uncertainty")) && r.get("uncertainty") != null && plain) {
                    double u = "%".equals(r.get("uncertainty_kind"))
                        ? Math.abs(Js.toNumber(r.get("value_num") != null ? r.get("value_num") : reported)) * Js.toNumber(r.get("uncertainty")) / 100 : Js.toNumber(r.get("uncertainty"));
                    String[] split = reported.split("\\.", -1);
                    int dec = split.length > 1 ? split[1].length() : 0;
                    unc = "± " + (dec > 0 ? Js.toFixed(u, dec) : Js.number(Double.parseDouble(Js.toPrecision(u, 2))));
                }
                // the amount per serving (028), also for a limit per serving or per package (031): the amount it is compared with
                String perServ = "", pkg = "";
                String basisText = null, basisUnit = null;
                String basis = truthy(r.get("spec_basis")) && !"As reported".equals(r.get("spec_basis")) ? Html.text(r.get("spec_basis")) : null;
                if ((perServing || basis != null) && !truthy(r.get("result_key")) && servingSize != null) {
                    boolean lt = reported.matches("^<\\s*[\\s\\S]*");
                    String base = lt ? reported.replaceFirst("^<\\s*", "") : plain ? (basis != null ? reported : r.get("value_num") != null ? Html.text(r.get("value_num")) : reported) : null;
                    if (base != null && PLAIN.matcher(base.trim()).matches()) {
                        // through the measured density when the serving is a volume and the result per weight (033)
                        Map<String, Object> p = db.one("SELECT value::text AS value, unit FROM sample_per_serving(?::numeric, ?, ?::uuid)", base, r.get("unit"), s.get("id"));
                        if (p != null && p.get("value") != null) {
                            String u = Html.text(p.get("unit")).replaceFirst(" per serving$", "");
                            double v = Double.parseDouble(Js.toPrecision(Js.toNumber(p.get("value")), 3));
                            String pre = lt ? "< " : "";
                            perServ = pre + Js.number(v) + " " + u;
                            Double pv = truthy(s.get("servings_per_package")) ? Double.parseDouble(Js.toPrecision(Js.toNumber(p.get("value")) * Js.toNumber(s.get("servings_per_package")), 3)) : null;
                            if (pv != null) pkg = pre + Js.number(pv) + " " + u;
                            Double bv = "Per package".equals(basis) ? pv : basis != null ? (Double) v : null;   // what the limit is compared with
                            if (bv != null) { basisText = pre + Js.number(bv); basisUnit = u; }
                        }
                    }
                }
                Map<String, Object> res = map("id", r.get("id"), "analyte_id", r.get("analyte_id"), "analyte", r.get("analyte"), "label", or(r.get("result_name"), ""),
                    "final_label", !truthy(r.get("result_key")) && staged ? "Final result" : "", "reported", reportedV, "value_num", r.get("value_num"), "value_text", r.get("value_text"),
                    "unit", or(r.get("unit"), ""), "spec", specText(r), "spec_min", r.get("spec_min"), "spec_max", r.get("spec_max"), "spec_text", r.get("spec_text"), "spec_unit", r.get("spec_unit"),
                    "spec_source", or(r.get("spec_source"), ""), "conformance", r.get("conformance"),
                    "loq", truthy(r.get("hide_loq")) || truthy(r.get("result_key")) ? null : r.get("loq"), "approved_at", r.get("approved_at"),
                    "rounding_mode", r.get("rounding_mode"), "rounding_digits", r.get("rounding_digits"), "lod", r.get("lod"),
                    "uncertainty", unc, "per_serving", perServ, "per_package", "Per package".equals(basis) ? pkg : "", "spec_basis", basis == null ? "" : basis,
                    "basis_value", basisText, "basis_unit", basisUnit);
                List<Object> nids = new ArrayList<>();
                for (Map<String, Object> n : notes)
                    if ("COA".equals(n.get("kind")) && Objects.equals(n.get("requested_test_id"), t.get("id")) && Objects.equals(n.get("analyte_id"), r.get("analyte_id"))) nids.add(n.get("id"));
                resultNoteIds.put(res, nids);
                results.add(res);
            }
            // results hidden on the report are still covered by the finalization
            for (Map<String, Object> r : rows) if (truthy(r.get("hide_on_report"))) resultIds.add(String.valueOf(r.get("id")));
            String method = truthy(t.get("method_name")) ? t.get("method_name") + (truthy(t.get("sop_code")) ? " (" + t.get("sop_code") + ")" : "") : "";
            Map<String, Object> test = map("requested_test_id", t.get("id"), "template_id", t.get("template_id"), "test_name", t.get("test_name"), "test_code", t.get("test_code"),
                "version_no", t.get("version_no"), "method", method, "finalized_now", chosen.contains(tid), "tested_from", dates == null ? null : dates.get("first"),
                "tested_to", dates == null ? null : dates.get("last"), "results", results,
                "per_serving", perServing || results.stream().anyMatch(x -> truthy(x.get("per_serving")) && truthy(x.get("spec_basis"))),
                "per_package", results.stream().anyMatch(x -> truthy(x.get("per_package"))));
            List<Object> tn = new ArrayList<>();
            for (Map<String, Object> n : notes)
                if ("COA".equals(n.get("kind")) && Objects.equals(n.get("requested_test_id"), t.get("id")) && n.get("analyte_id") == null) tn.add(n.get("id"));
            testNoteIds.put(test, tn);
            // what still holds its per-serving results (for the release check only: not part of the stored content)
            if (t.get("serving_problem") != null) servingProblems.put(tid, Html.text(t.get("serving_problem")));
            outTests.add(test);
        }
        out.put("tests", outTests);
        out.put("pending", pending);
        // one part per report template, each test in its own template's part (Alex, 2026-10-14)
        Set<Object> tidSet = new LinkedHashSet<>();
        for (Map<String, Object> t : outTests) if (truthy(t.get("template_id"))) tidSet.add(t.get("template_id"));
        for (Map<String, Object> p : pending) if (truthy(p.get("template_id"))) tidSet.add(p.get("template_id"));
        List<Object> tids = new ArrayList<>(tidSet);
        List<Map<String, Object>> tpls = tids.isEmpty() ? List.of()
            : db.rows("SELECT id, template_code, template_name, layout, options FROM report_template WHERE id = ANY(?::uuid[])", tids);
        Object dflt = db.one("SELECT default_report_template(?::uuid) AS id", s.get("site_id")).get("id");
        List<Object> order = new ArrayList<>(tids);
        order.sort((a, b) -> Objects.equals(a, dflt) ? -1 : Objects.equals(b, dflt) ? 1 : 0);
        List<Map<String, Object>> sections = new ArrayList<>();
        for (Object id : order) {
            Map<String, Object> x = tpls.stream().filter(y -> Objects.equals(y.get("id"), id)).findFirst().orElse(Map.of());
            List<Object> st = new ArrayList<>(), sp = new ArrayList<>();
            for (Map<String, Object> t : outTests) if (Objects.equals(t.get("template_id"), id)) st.add(t.get("requested_test_id"));
            for (Map<String, Object> p : pending) if (Objects.equals(p.get("template_id"), id)) sp.add(p.get("requested_test_id"));
            sections.add(map("template", map("id", id, "code", x.get("template_code"), "name", x.get("template_name"), "layout", x.get("layout"),
                "options", x.get("options") != null ? x.get("options") : new LinkedHashMap<>()), "tests", st, "pending", sp));
        }
        out.put("sections", sections);
        // the sample's report photos (0.29.0, migration 051): only when a part's layout prints them; the images are not stored
        int needPhotos = photosNeeded(sections);
        List<Map<String, Object>> photos = new ArrayList<>();
        Map<Integer, String> photoData = new HashMap<>();
        if (needPhotos > 0) {
            for (Map<String, Object> p : db.rows("""
                SELECT p.id, p.report_slot, p.document_id, p.caption, p.taken_at, p.width_px, p.height_px, f.sha256, f.mime_type, encode(f.content, 'base64') AS b64
                  FROM sample_photo p JOIN document_file f ON f.id = p.document_id WHERE p.sample_id = ?::uuid AND p.status = 'Active' AND p.report_slot IS NOT NULL AND p.report_slot <= ?
                 ORDER BY p.report_slot""", s.get("id"), needPhotos)) {
                photos.add(map("slot", p.get("report_slot"), "photo_id", p.get("id"), "document_id", p.get("document_id"), "sha256", p.get("sha256"),
                    "caption", or(p.get("caption"), ""), "taken_at", p.get("taken_at")));
                photoData.put(((Number) p.get("report_slot")).intValue(), "data:" + p.get("mime_type") + ";base64," + b64(p.get("b64")));
            }
        }
        out.put("photos", photos);
        java.util.Collections.sort(resultIds);
        out.put("result_ids", resultIds);
        out.put("pending_count", pending.size());
        out.put("is_final", pending.isEmpty());
        // every COA note is in the Notes section, numbered; a note on a test or a result is marked there with its number
        Map<Object, String> shown = new HashMap<>();
        for (Map<String, Object> t : outTests) {
            for (Object id : testNoteIds.get(t)) shown.put(id, Html.text(t.get("test_name")));
            for (Map<String, Object> r : CoaContent.results(t))
                for (Object id : resultNoteIds.get(r)) shown.put(id, r.get("analyte") + (truthy(r.get("label")) ? " (" + r.get("label") + ")" : "") + ", " + t.get("test_name"));
        }
        List<Map<String, Object>> noteRows = new ArrayList<>();
        Map<Object, Integer> numOf = new HashMap<>();
        for (Map<String, Object> n : notes) {
            if (!"COA".equals(n.get("kind"))) continue;
            int k = noteRows.size() + 1;
            String on = shown.containsKey(n.get("id")) ? shown.get(n.get("id")) : truthy(n.get("requested_test_id")) ? testName(tests, n.get("requested_test_id")) : "";
            noteRows.add(map("n", k, "id", n.get("id"), "text", n.get("note_text"), "on", on));
            numOf.put(n.get("id"), k);
        }
        out.put("notes", noteRows);
        for (Map<String, Object> t : outTests) {
            t.put("notes", testNoteIds.get(t).stream().map(numOf::get).toList());
            for (Map<String, Object> r : CoaContent.results(t)) r.put("notes", resultNoteIds.get(r).stream().map(numOf::get).toList());
        }
        out.put("internal_notes", notes.stream().filter(n -> "Internal".equals(n.get("kind"))).map(n -> n.get("note_text")).toList());
        out.put("decision_rule", outTests.stream().anyMatch(t -> CoaContent.results(t).stream().anyMatch(r -> truthy(r.get("spec")))) ? CoaContent.DECISION_RULE : "");
        boolean hasSig = me != null && truthy(me.get("sig_b64"));
        out.put("authorized", map("by", me == null ? null : me.get("full_name"), "title", me == null ? "" : or(me.get("title"), ""), "at", now,
            "signature", hasSig ? "data:" + me.get("sig_type") + ";base64," + b64(me.get("sig_b64")) : null, "has_signature", hasSig && truthy(me.get("title"))));
        out.put("time_zone", s.get("time_zone"));
        out.put("client_on_hold", "On Hold".equals(s.get("account_status")));
        out.put("allow_partial", s.get("allow_partial_reports"));
        out.put("is_gmp", s.get("is_gmp"));
        return new CoaContent(out, logoData, markData, photoData, servingProblems);
    }

    /** The base64 text as the database encodes it, line breaks kept as Node kept them (the browser reads both). */
    private static String b64(Object v) { return Html.text(v); }

    private static String testName(List<Map<String, Object>> tests, Object rt) {
        for (Map<String, Object> x : tests) if (Objects.equals(x.get("id"), rt)) return truthy(x.get("test_name")) ? Html.text(x.get("test_name")) : "";
        return "";
    }

    /** How many report photos the parts' layouts print (0, 1 or 2). */
    @SuppressWarnings("unchecked")
    public static int photosNeeded(List<Map<String, Object>> sections) {
        int n = 0;
        for (Map<String, Object> x : sections) n = Math.max(n, photoCount(layoutOf(x)));
        return n;
    }

    static int photoCount(Object layout) { return "COA with 2 photos".equals(layout) ? 2 : "COA with 1 photo".equals(layout) ? 1 : 0; }

    @SuppressWarnings("unchecked")
    static Object layoutOf(Map<String, Object> section) {
        Object t = section.get("template");
        if (t instanceof Map<?, ?> m) return m.get("layout");
        if (t instanceof JsonNode j && j.hasNonNull("layout")) return j.get("layout").asText();
        return null;
    }

    static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    // ------------------------------------------------------------------ the page that becomes the PDF
    /** A report template's options with the defaults (method, version, tested dates and LOQ shown). */
    private static Map<String, Object> options(Map<String, Object> template) {
        Map<String, Object> o = map("show_method", true, "show_test_version", true, "show_tested_dates", true, "show_loq", true);
        Object raw = template.get("options");
        if (raw instanceof Map<?, ?> m) for (Map.Entry<?, ?> e : m.entrySet()) o.put(String.valueOf(e.getKey()), e.getValue());
        if (raw instanceof JsonNode j && j.isObject()) j.fields().forEachRemaining(e -> o.put(e.getKey(), e.getValue()));
        return o;
    }

    private record Part(Map<String, Object> opt, Map<String, Object> template, List<Map<String, Object>> tests, List<Map<String, Object>> pending) {}

    @SuppressWarnings("unchecked")
    public static String html(CoaContent c) {
        String tz = (String) c.get("time_zone");
        List<Part> parts = new ArrayList<>();
        for (Map<String, Object> sec : c.sections()) {
            Map<String, Object> template = sec.get("template") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
            List<?> st = sec.get("tests") instanceof List<?> l ? l : List.of(), sp = sec.get("pending") instanceof List<?> l ? l : List.of();
            parts.add(new Part(options(template), template, c.list("tests").stream().filter(t -> st.contains(t.get("requested_test_id"))).toList(),
                c.list("pending").stream().filter(x -> sp.contains(x.get("requested_test_id"))).toList()));
        }
        Map<String, Object> lab = c.part("lab"), client = c.part("client"), order = c.part("order"), sample = c.part("sample"), auth = c.part("authorized");
        String reportId = c.reportId();
        // the QR code of the verification link, beside it (0.29.0)
        String qr;
        try { qr = QrCode.svg(Html.text(c.get("verify_url")), 2, "QR code: verify this certificate"); } catch (RuntimeException e) { qr = ""; }
        StringBuilder b = new StringBuilder();
        b.append("<!doctype html><html><head><meta charset=\"utf-8\"><title>").append(esc(reportId)).append(" (version ").append(Html.text(c.get("version_no"))).append(")</title><style>\n").append(STYLE).append("  </style></head><body>\n  ");
        for (int pi = 0; pi < parts.size(); pi++) {
            Part part = parts.get(pi);
            final int p = pi;
            java.util.function.Function<String, String> dc = k -> p == 0 ? " data-check=\"" + k + "\"" : "";
            b.append("<div class=\"part").append(pi > 0 ? " next" : "").append("\">\n  <div class=\"top\"><div class=\"labblock\">");
            if (c.logo() != null) b.append("<img class=\"logo\" src=\"").append(c.logo()).append("\" alt=\"").append(esc(lab.get("name"))).append("\">");
            b.append("<div><div class=\"lab\">").append(esc(lab.get("name"))).append("</div><div class=\"labaddr\">").append(esc(lab.get("address"))).append("</div>\n      ");
            if (truthy(lab.get("accreditation"))) {
                b.append("<div class=\"accr\">");
                if (c.mark() != null) b.append("<img class=\"mark\" src=\"").append(c.mark()).append("\" alt=\"Accreditation mark\">");
                b.append(esc(lab.get("accreditation"))).append("</div>");
            }
            b.append("</div></div>\n    <div class=\"title\"><div class=\"t\">").append(esc(truthy(part.opt().get("title")) ? Html.text(part.opt().get("title")) : "CERTIFICATE OF ANALYSIS"))
                .append("</div><div class=\"v\">Report <span").append(dc.apply("h:report_id")).append(">").append(esc(reportId)).append("</span> · Version <span")
                .append(dc.apply("h:version_no")).append(">").append(Html.text(c.get("version_no"))).append("</span>");
            Map<String, Object> sup = c.part("supersedes");
            if (sup != null) b.append(", supersedes version ").append(Html.text(sup.get("version_no"))).append(" issued ").append(esc(Html.fmtDate(sup.get("issued_at"), tz)));
            b.append("</div>\n    <div class=\"v\">Issued ").append(esc(Html.fmtDate(auth.get("at"), tz))).append("</div>");
            if (parts.size() > 1) b.append("<div class=\"v\">Part ").append(pi + 1).append(" of ").append(parts.size())
                .append(truthy(part.template().get("name")) ? ": " + esc(part.template().get("name")) : "").append("</div>");
            b.append("</div></div>\n  <div class=\"grid\">\n    <div><h4>Client</h4><table class=\"kv\">")
                .append(kv(pi, new Object[][] {{"Client", client.get("name")}, {"Address", client.get("address")}, {"Contact", client.get("contact")},
                    {"Order", order.get("order_code"), "h:order_code"}, {"PO", order.get("po_number")}, {"License", or(order.get("license"), "")}}))
                .append("</table></div>\n    <div><h4>Sample</h4><table class=\"kv\">")
                .append(kv(pi, new Object[][] {{"Sample ID", sample.get("sample_code"), "h:sample_code"}, {"Client sample ID", sample.get("client_sample_id"), "h:client_sample_id"},
                    {"Description", sample.get("description")}, {"Matrix", sample.get("matrix")}, {"Product", sample.get("product")}, {"Lot", sample.get("lot"), "h:lot"},
                    {"Batch", sample.get("batch")}, {"METRC ID", or(sample.get("metrc_id"), "")}, {"Category", sample.get("compliance_category")},
                    {"Serving size", or(sample.get("serving"), "")}, {"Received", Html.fmtDate(sample.get("received"), tz)}, {"Condition", sample.get("condition")}}))
                .append("</table></div>\n  </div>\n  ").append(photoBlock(c, part)).append("\n  ");
            for (Map<String, Object> t : part.tests()) b.append(testBlock(c, t, part, tz));
            b.append("\n  ");
            if (!part.pending().isEmpty()) {
                b.append("<section class=\"pending\"><h3>Tests in progress</h3><table class=\"res\"><tbody>");
                for (Map<String, Object> x : part.pending()) b.append("<tr><td>").append(esc(x.get("test_name"))).append("</td><td class=\"r\">In progress</td></tr>");
                b.append("</tbody></table></section>");
            }
            b.append("\n  </div>");
        }
        b.append("\n  ");
        List<Map<String, Object>> noteRows = c.list("notes");
        if (!noteRows.isEmpty()) {
            b.append("<div class=\"notes\"><b>Notes</b><table>");
            for (Map<String, Object> n : noteRows) b.append("<tr><td class=\"n\">[").append(Html.text(n.get("n"))).append("]</td><td>")
                .append(truthy(n.get("on")) ? "<span class=\"on\">" + esc(n.get("on")) + ":</span> " : "").append(esc(n.get("text"))).append("</td></tr>");
            b.append("</table></div>");
        }
        b.append("\n  <div class=\"rule\">").append(truthy(c.get("decision_rule")) ? esc(c.get("decision_rule")) + " " : "")
            .append("The results relate only to the sample tested, as received. This certificate may not be reproduced except in full without the laboratory's written approval.</div>\n")
            .append("  <div class=\"sign sigblock\"><div>Authorized by\n      ")
            .append(truthy(auth.get("signature")) ? "<img class=\"sigimg\" src=\"" + auth.get("signature") + "\" alt=\"Signature of " + esc(auth.get("by")) + "\">" : "<div style=\"height:46px\"></div>")
            .append("\n      <div class=\"sigline\"><span class=\"nm\" data-check=\"h:authorized_by\">").append(esc(auth.get("by"))).append("</span>")
            .append(truthy(auth.get("title")) ? "<br>" + esc(auth.get("title")) : "").append("<br>Signed ").append(esc(Html.fmtDateTime(auth.get("at"), tz))).append(" (electronic signature)</div></div>\n")
            .append("    <div class=\"verifybox\"><div class=\"verify\">Verify this certificate at ").append(esc(c.get("verify_url")))
            .append("<br>Verification code <span class=\"code\" data-check=\"h:verify_code\">").append(esc(c.get("verify_code"))).append("</span><br>or scan the QR code</div>")
            .append(qr).append("</div></div>\n  \n  </body></html>");
        return b.toString();
    }

    private static String kv(int pi, Object[][] pairs) {
        StringBuilder b = new StringBuilder();
        for (Object[] p : pairs) {
            Object v = p[1];
            if ("".equals(v) || v == null) continue;
            String key = pi == 0 && p.length > 2 ? (String) p[2] : null;
            b.append("<tr><th>").append(esc(p[0])).append("</th><td").append(key != null ? " data-check=\"" + key + "\"" : "").append(">").append(esc(v)).append("</td></tr>");
        }
        return b.toString();
    }

    private static String marks(Object ns) {
        if (!(ns instanceof List<?> l) || l.isEmpty()) return "";
        return " <sup class=\"mk\">" + l.stream().map(n -> "[" + Html.text(n) + "]").collect(Collectors.joining()) + "</sup>";
    }

    private static String testBlock(CoaContent c, Map<String, Object> t, Part part, String tz) {
        Map<String, Object> o = part.opt();
        boolean hasLoq = truthy(o.get("show_loq")) && part.tests().stream().anyMatch(x -> CoaContent.results(x).stream().anyMatch(r -> truthy(r.get("loq"))));
        boolean hasSpec = part.tests().stream().anyMatch(x -> CoaContent.results(x).stream().anyMatch(r -> truthy(r.get("spec"))));
        List<Map<String, Object>> results = CoaContent.results(t);
        boolean hasUnc = results.stream().anyMatch(r -> truthy(r.get("uncertainty")));
        boolean hasServ = truthy(t.get("per_serving")), hasPkg = truthy(t.get("per_package"));
        List<String> meta = new ArrayList<>();
        if (truthy(o.get("show_method")) && truthy(t.get("method"))) meta.add("Method: " + t.get("method"));
        if (truthy(o.get("show_test_version"))) meta.add("Test version " + Html.text(t.get("version_no")));
        if (truthy(o.get("show_tested_dates")) && truthy(t.get("tested_from"))) {
            String from = Html.fmtDate(t.get("tested_from"), tz), to = Html.fmtDate(t.get("tested_to"), tz);
            meta.add("Tested " + from + (truthy(t.get("tested_to")) && !to.equals(from) ? " to " + to : ""));
        }
        StringBuilder b = new StringBuilder("<section class=\"test\">\n      <h3>").append(esc(t.get("test_name"))).append(marks(t.get("notes"))).append("</h3>\n      <div class=\"meta\">")
            .append(esc(String.join(" · ", meta))).append("</div>\n      <table class=\"res\"><thead><tr><th>Analyte</th><th class=\"r\">Result</th>")
            .append(hasUnc ? "<th>Uncertainty</th>" : "").append("<th>Unit</th>")
            .append(hasServ ? "<th class=\"r\">Per serving (" + esc(c.part("sample").get("serving")) + ")</th>" : "").append(hasPkg ? "<th class=\"r\">Per package</th>" : "")
            .append(hasLoq ? "<th class=\"r\">LOQ</th>" : "").append(hasSpec ? "<th>Specification</th><th>Conformance</th>" : "").append("</tr></thead><tbody>\n      ");
        for (Map<String, Object> r : results) {
            String id = Html.text(r.get("id"));
            Object lbl = truthy(r.get("label")) ? r.get("label") : r.get("final_label");
            b.append("<tr><td>").append(esc(r.get("analyte"))).append(marks(r.get("notes"))).append(truthy(lbl) ? "<div class=\"sub\">" + esc(lbl) + "</div>" : "").append("</td>\n        ")
                .append("<td class=\"r b\" data-check=\"r:").append(id).append(":reported\">").append(esc(r.get("reported"))).append("</td>")
                .append(hasUnc ? "<td>" + esc(or(r.get("uncertainty"), "")) + "</td>" : "").append("<td data-check=\"r:").append(id).append(":unit\">").append(esc(r.get("unit"))).append("</td>\n        ")
                .append(hasServ ? "<td class=\"r\">" + esc(or(r.get("per_serving"), "")) + "</td>" : "").append(hasPkg ? "<td class=\"r\">" + esc(or(r.get("per_package"), "")) + "</td>" : "").append("\n        ")
                .append(hasLoq ? "<td class=\"r\">" + esc(r.get("loq") == null ? "" : r.get("loq")) + "</td>" : "").append("\n        ");
            if (hasSpec) {
                b.append("<td><span data-check=\"r:").append(id).append(":spec\">").append(esc(r.get("spec"))).append("</span>")
                    .append(truthy(r.get("spec")) && Html.text(r.get("spec_source")).startsWith("Client") ? "<div class=\"sub\">Client provided specification</div>" : "")
                    .append("</td><td data-check=\"r:").append(id).append(":conf\">").append(esc(truthy(r.get("spec")) ? r.get("conformance") : "")).append("</td>");
            }
            b.append("</tr>");
        }
        return b.append("\n      </tbody></table>\n    </section>").toString();
    }

    // photo layouts (0.29.0): one photo, or two side by side, 4:3, under the client and sample details
    private static String photoBlock(CoaContent c, Part part) {
        int n = photoCount(part.template().get("layout"));
        if (n == 0) return "";
        StringBuilder b = new StringBuilder("<div class=\"photos photos").append(n).append("\">");
        for (int k = 1; k <= n; k++) {
            final int slot = k;
            Map<String, Object> p = c.list("photos").stream().filter(x -> x.get("slot") instanceof Number num && num.intValue() == slot).findFirst().orElse(null);
            String src = c.photo(k);
            b.append("<figure class=\"ph ph").append(n).append("\">").append(src != null ? "<img src=\"" + src + "\" alt=\"Sample photo " + k + "\">" : "<div class=\"noph\">Photo " + k + " not on file</div>")
                .append("<figcaption>").append(esc(p != null && truthy(p.get("caption")) ? p.get("caption") : "Sample as received" + (n > 1 ? " (" + k + " of " + n + ")" : ""))).append("</figcaption></figure>");
        }
        return b.append("</div>").toString();
    }

    /** The footer line of every page (the report, version and verification code; a preview says so). */
    public static String footer(CoaContent c, boolean preview) {
        return "Report " + esc(c.reportId()) + " · Version " + Html.text(c.get("version_no")) + " · Verification code " + esc(c.get("verify_code")) + (preview ? " · PREVIEW, NOT ISSUED" : "");
    }

    private static final String STYLE = """
            @page { size: Letter; margin: 0.6in 0.6in 0.75in; }
            body { font: 10pt/1.35 "Helvetica Neue", Arial, sans-serif; color: #1d2329; margin: 0; }
            .top { display: flex; justify-content: space-between; border-bottom: 2.5px solid #1f3a2c; padding-bottom: 10px; }
            .lab { font-size: 15pt; font-weight: 700; color: #1f3a2c; } .labaddr { color: #5c6773; font-size: 9pt; white-space: pre-line; }
            .title { text-align: right; } .title .t { font-size: 14pt; font-weight: 700; letter-spacing: .3px; } .title .v { font-size: 9pt; color: #5c6773; margin-top: 3px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 12px 0 6px; }
            .grid h4 { margin: 0 0 4px; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .5px; color: #5c6773; }
            table.kv { border-collapse: collapse; width: 100%; } table.kv th { text-align: left; font-weight: 600; color: #5c6773; width: 38%; padding: 1.5px 6px 1.5px 0; vertical-align: top; font-size: 9pt; }
            table.kv td { padding: 1.5px 0; font-size: 9pt; }
            h3 { font-size: 11pt; margin: 14px 0 2px; color: #1f3a2c; } .meta { font-size: 8.5pt; color: #5c6773; margin-bottom: 5px; }
            table.res { width: 100%; border-collapse: collapse; } table.res th { background: #eef2f0; text-align: left; font-size: 8.5pt; padding: 5px 6px; border-bottom: 1px solid #c9d3cf; }
            table.res td { padding: 5px 6px; border-bottom: 1px solid #e3e8e6; vertical-align: top; } .r { text-align: right; } .b { font-weight: 700; }
            .sub { font-size: 8pt; color: #5c6773; } .note { font-size: 8.5pt; font-style: italic; color: #333; margin-top: 3px; }
            .pending { margin-top: 12px; } .pending td { color: #5c6773; }
            .notes, .rule { margin-top: 12px; font-size: 9pt; } .rule { color: #333; }
            .sign { margin-top: 18px; border-top: 1px solid #c9d3cf; padding-top: 8px; display: flex; justify-content: space-between; font-size: 9pt; }
            .verify { font-size: 8.5pt; color: #5c6773; text-align: right; } .code { font: 600 10pt ui-monospace, Menlo, Consolas, monospace; color: #1d2329; letter-spacing: .5px; }
            section.test { break-inside: avoid; }
            sup.mk { font-size: 7pt; color: #1f3a2c; font-weight: 700; }
            .notes table { border-collapse: collapse; width: 100%; margin-top: 3px; } .notes td { padding: 2px 6px 2px 0; vertical-align: top; font-size: 9pt; } .notes td.n { width: 26px; font-weight: 700; } .notes .on { color: #5c6773; }
            .sigblock { break-inside: avoid; } .sigimg { height: 46px; max-width: 220px; object-fit: contain; display: block; margin-bottom: 2px; }
            .labblock { display: flex; gap: 12px; align-items: flex-start; } img.logo { max-height: 54px; max-width: 160px; object-fit: contain; }
            .accr { font-size: 8.5pt; color: #1f3a2c; margin-top: 4px; display: flex; gap: 6px; align-items: center; } img.mark { height: 28px; object-fit: contain; }
            .part.next { break-before: page; }
            .sigline { border-top: 1px solid #1d2329; width: 240px; padding-top: 3px; } .sigline .nm { font-weight: 700; }
            .photos { display: flex; gap: 0.25in; margin: 4px 0 8px; break-inside: avoid; } figure.ph { margin: 0; } figure.ph1 { width: 3.4in; } figure.ph2 { width: 3.05in; }
            figure.ph img, .noph { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; border: 1px solid #c9d3cf; border-radius: 2px; }
            .noph { display: flex; align-items: center; justify-content: center; color: #9a2b2b; background: #f6f1f1; }
            figure.ph figcaption { font-size: 8pt; color: #5c6773; margin-top: 2px; }
            .verifybox { display: flex; gap: 8px; align-items: flex-start; } .verifybox svg { flex: none; }
        """;
}
