package com.tentamus.lims.verification.domain;

import static com.tentamus.lims.verification.domain.JsValues.list;
import static com.tentamus.lims.verification.domain.JsValues.map;
import static com.tentamus.lims.verification.domain.JsValues.str;

import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.verification.domain.WordDocument.Para;
import com.tentamus.lims.verification.domain.WordDocument.Run;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.FormatStyle;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The workflow verification protocol and report as a Word document (verification_report.js): the same content as the
 * page (#/verification/<id>), with the evidence screenshots in an appendix. Built on request, nothing stored.
 */
public final class VerificationReport {
    private VerificationReport() {}

    private static final DateTimeFormatter DT = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(Locale.US).withZone(ZoneId.systemDefault());
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofLocalizedTime(FormatStyle.MEDIUM).withLocale(Locale.US).withZone(ZoneId.systemDefault());

    static String dt(Object v) { return Js.truthy(v) ? DT.format(Instant.parse(v.toString())) : ""; }

    static String txt(Object x) {
        if (x == null) return "";
        if (x instanceof Map<?, ?> m) return m.get("text") != null ? str(m.get("text")) : JsValues.json(x);
        return str(x);
    }

    private static Run res(Object r) {
        String s = r == null ? "" : str(r);
        String color = switch (s) { case "Pass" -> "1E7A4A"; case "Fail" -> "B42318"; case "Not tested" -> "9A6700"; default -> null; };
        return new Run(s, true, false, color, null, false);
    }

    private static List<Object> row(Object... cells) { return new ArrayList<>(List.of(cells)); }

    private static String e2(Object seq) { return "E-" + JsValues.pad2(seq); }

    private static String nz(Object v) { return v == null ? "" : str(v); }

    /**
     * @param d        the document answer (verification, requirements, checks, batches, samples, order, signatures)
     * @param evidence each screenshot {seq, title, page_ref, check_codes, sha256, width_px, height_px, captured_at, png}
     */
    @SuppressWarnings("unchecked")
    public static byte[] build(Map<String, Object> d, List<Map<String, Object>> evidence) {
        Map<String, Object> w = map(d.get("verification")), S = map(d.get("signatures"));
        Map<String, Object> plan = map(w.get("plan"));
        List<Object> samples = list(plan.get("samples"));
        List<Map<String, Object>> reqs = (List<Map<String, Object>>) (List<?>) list(d.get("requirements")).stream().map(JsValues::map).toList();
        List<Map<String, Object>> checks = (List<Map<String, Object>>) (List<?>) list(d.get("checks")).stream().map(JsValues::map).toList();
        List<Object> sampleRows = list(d.get("samples")), batchRows = list(d.get("batches"));
        Map<String, Object> definition = map(w.get("definition"));
        java.util.function.Function<Object, String> an = id -> {
            for (Object a : list(definition.get("analytes"))) if (java.util.Objects.equals(map(a).get("analyte_id"), id) && Js.truthy(map(a).get("analyte_name"))) return str(map(a).get("analyte_name"));
            return "Analyte";
        };
        java.util.function.Function<Object, String> checksOf = code -> String.join(", ", checks.stream().filter(c -> list(c.get("requirement_codes")).contains(code)).map(c -> str(c.get("check_code"))).toList());
        java.util.function.Function<Object, String> evOf = code -> String.join(", ", evidence.stream().filter(e -> list(e.get("check_codes")).contains(code)).map(e -> e2(e.get("seq"))).toList());
        java.util.function.Function<Object, String> codeOf = key -> {
            for (Object s : sampleRows) if (java.util.Objects.equals(map(s).get("client_sample_id"), key)) return Js.truthy(map(s).get("sample_code")) ? str(map(s).get("sample_code")) : "";
            return "";
        };
        WordDocument D = new WordDocument();

        D.title("Workflow verification " + nz(w.get("verification_code")), nz(w.get("test_code")) + " " + nz(w.get("test_name")) + ", version " + nz(w.get("version_no")) + " · " + nz(w.get("site_code")) + " "
            + (Js.truthy(w.get("site_name")) ? str(w.get("site_name")) : "") + " · Protocol and report");
        Map<String, Object> order = d.get("order") == null ? null : map(d.get("order"));
        List<String> batchTexts = batchRows.stream().map(b -> str(map(b).get("batch_code")) + " (" + str(map(b).get("status")) + ")").toList();
        D.table(List.of(
            row("Item", "Value"),
            row("Status", nz(w.get("status")) + (Js.truthy(w.get("outcome")) ? " · Outcome: " + str(w.get("outcome")) : "")),
            row("Test", nz(w.get("test_code")) + " " + nz(w.get("test_name")) + ", version " + nz(w.get("version_no")) + " (" + nz(w.get("version_status")) + ")"),
            row("Method", (Js.truthy(w.get("method_name")) ? str(w.get("method_name")) : "none") + (Js.truthy(w.get("sop_code")) ? " (" + str(w.get("sop_code")) + ")" : "")),
            row("Design fingerprint", List.of(Run.of(nz(w.get("config_hash"))).monospaced(), Run.of(Boolean.TRUE.equals(w.get("current")) ? "  (matches the version)" : "  (the version has changed since)"))),
            row("Protocol written by", nz(w.get("generator"))),
            row("Verification order", order != null ? str(order.get("order_code")) + " (" + str(order.get("status")) + "), internal; samples " + String.join(", ", sampleRows.stream().map(s -> nz(map(s).get("sample_code"))).toList()) : "Not executed yet"),
            row("Batches", batchTexts.isEmpty() ? "None yet" : String.join(", ", batchTexts)),
            row("Evidence", Js.truthy(w.get("evidence_captured_at")) ? evidence.size() + " screenshots captured " + dt(w.get("evidence_captured_at")) + (Js.truthy(w.get("evidence_note")) ? "; " + str(w.get("evidence_note")) : "") : "Not captured yet")
        ), new double[] {0.2, 0.8}, 9);
        D.table(List.of(
            row("Prepared by", "Protocol approved by (QA)", "Executed by", "Evidence captured by", "Report approved by (QA)"),
            row(or(sig(S.get("prepared")), Js.truthy(w.get("prepared_by_name")) ? str(w.get("prepared_by_name")) : ""), or(sig(S.get("approved")), "Waiting for QA"),
                or(sig(S.get("executed")), "Not executed"), or(sig(S.get("evidence")), "Not captured"), or(sig(S.get("report")), "Not signed"))
        ), null, 9);

        D.h1("1. Purpose and scope", false);
        D.p("This verification shows that version " + nz(w.get("version_no")) + " of " + nz(w.get("test_name")) + ", as designed in the Workflow Designer, runs as intended in LIMS3 before it is approved: automated samples go through every step of the workflow, the results the system calculates and stores are compared with a second, independent calculation, and the workflow's controls (missing data, signatures, review by someone else, QC, specifications) are challenged.");
        D.p("It verifies the configured workflow. It is not a validation of the analytical method (method validation is separate), and not the validation of LIMS3 itself (computer system validation is separate).");
        D.h1("2. Approach", false);
        D.p("The protocol (requirements, samples, every value the run enters, and the expected results) is written before the run, from the version's design, and approved by QA. The expected results come from an independent calculation in the server: its own formula reader, exact decimal arithmetic, rounding, LOQ and LOD reporting and specification comparison. Unrounded results agree when they match to 9 significant figures; reported results and conformance must match exactly.");
        D.p("The run is done by three automated accounts (Verification analyst, witness and reviewer). They have no password, cannot sign in, and get bench or review rights only at this lab and only while the run goes on; their signatures say \"Automated verification run\". They go through the same database rules as the bench and review screens. QC readings are set at run time so each QC meets its criteria. The samples are on an internal order and their batches are verification batches, kept out of the lab's lists, the backlog and inventory stock.");
        D.p("After the run, the server opens every page the checks point to in a headless browser, as the person who captured the evidence, and keeps a full-page screenshot of each, stamped with the verification, the evidence number, the page, the time and the person, stored unchanged with its SHA-256 (Appendix A).");
        D.p("A check is Pass when the system matches the protocol, Fail when it does not, and Not tested when the run could not reach it (with the reason). A requirement passes when all its checks pass. One failed check fails the verification; requirements not tested must each be justified by QA, and the outcome is then \"Pass with exceptions\".");

        for (String kind : new String[] {"URS", "FRS"}) {
            List<List<Object>> rows = new ArrayList<>();
            rows.add(kind.equals("FRS") ? row("Code", "Requirement", "Serves", "Source", "Checks", "Result") : row("Code", "Requirement", "Source", "Checks", "Result"));
            for (Map<String, Object> r : reqs) {
                if (!kind.equals(r.get("kind"))) continue;
                String checksText = checksOf.apply(r.get("req_code"));
                List<Object> x = row(Run.of(nz(r.get("req_code"))).bolded(), nz(r.get("statement")));
                if (kind.equals("FRS")) x.add(String.join(", ", list(r.get("traces")).stream().map(JsValues::str).toList()));
                x.add(Js.truthy(r.get("source")) ? str(r.get("source")) : "");
                x.add(checksText.isEmpty() ? "none" : checksText);
                x.add(res(r.get("result")));
                rows.add(x);
            }
            D.h1(kind.equals("URS") ? "3. User requirements (URS)" : "4. Functional requirements (FRS)", false);
            D.table(rows, kind.equals("URS") ? new double[] {0.06, 0.56, 0.18, 0.12, 0.08} : new double[] {0.06, 0.5, 0.08, 0.16, 0.12, 0.08}, 8);
        }

        D.h1("5. Samples and inputs (decided in the protocol)", false);
        List<List<Object>> sRows = new ArrayList<>();
        sRows.add(row("Sample", "Code", "Case", "Specification put on it"));
        for (Object o : samples) {
            Map<String, Object> s = map(o);
            List<String> sp = new ArrayList<>();
            for (Object q : list(s.get("specs"))) {
                Map<String, Object> x = map(q);
                String lim = Js.truthy(x.get("text")) ? str(x.get("text")) : (x.get("min") != null ? ">= " + str(x.get("min")) : "") + (x.get("min") != null && x.get("max") != null ? " and " : "") + (x.get("max") != null ? "<= " + str(x.get("max")) : "");
                sp.add(an.apply(x.get("analyte_id")) + ": " + lim + (Js.truthy(x.get("unit")) ? " " + str(x.get("unit")) : ""));
            }
            sRows.add(row(Run.of(nz(s.get("key"))).bolded(), codeOf.apply(s.get("key")), nz(s.get("case")), sp.isEmpty() ? "none" : String.join("; ", sp)));
        }
        D.table(sRows, new double[] {0.08, 0.14, 0.18, 0.6}, 8);
        List<List<Object>> inRows = new ArrayList<>();
        inRows.add(row("Step", "Values the run enters"));
        Map<String, Object> pbatch = map(plan.get("batch"));
        for (Object so : list(definition.get("steps"))) {
            Map<String, Object> s = map(so), c = map(s.get("config"));
            String k = str(s.get("step_key")), type = str(s.get("step_type")), name = nz(s.get("step_name"));
            switch (type) {
                case "Weighing" -> inRows.add(row(name, String.join("; ", samples.stream().map(x -> str(map(x).get("key")) + ": " + str(inp(x, "weigh").get(k)) + " " + (Js.truthy(c.get("unit")) ? str(c.get("unit")) : "g")).toList()) + " (prep QC as S1)"));
                case "Dilution" -> inRows.add(row(name, String.join("; ", samples.stream().map(x -> str(map(x).get("key")) + ": " + String.join(", ", list(inp(x, "dil").get(k)).stream().map(f -> str(map(f).get("aliquot")) + " + " + str(map(f).get("diluent"))).toList())).toList())));
                case "Preparation" -> {
                    List<String> l = new ArrayList<>();
                    for (Map.Entry<String, Object> e : map(map(pbatch.get("prep")).get(k)).entrySet()) l.add(e.getKey() + " = " + str(e.getValue()));
                    inRows.add(row(name, l.isEmpty() ? "no fields" : String.join(", ", l)));
                }
                case "Incubation" -> {
                    Map<String, Object> i = map(map(pbatch.get("inc")).get(k));
                    inRows.add(row(name, und(i, "duration") + " " + und(i, "unit") + " at " + (i.get("temperature") != null ? str(i.get("temperature")) : "the target") + " °C, one load for the batch"));
                }
                case "Plating/Inoculation" -> inRows.add(row(name, String.join("; ", samples.stream().map(x -> str(map(x).get("key")) + ": " + str(inp(x, "plates").get(k)) + " plate(s)").toList()) + "; a usable media lot"));
                case "Data Entry" -> inRows.add(row(name, String.join("; ", samples.stream().map(x -> str(map(x).get("key")) + ": " + String.join(", ",
                    map(inp(x, "read").get(k)).entrySet().stream().map(e -> an.apply(e.getKey()) + " " + str(e.getValue())).toList())).toList()) + "; QC readings set at run time to meet their criteria"));
                default -> { }
            }
        }
        if (inRows.size() > 1) D.table(inRows, new double[] {0.2, 0.8}, 8);

        D.h1("6. Checks", false);
        Set<String> cases = new LinkedHashSet<>(List.of("Process", "QC"));
        for (Object s : samples) cases.add(str(map(s).get("case")));
        for (String cl : cases) {
            List<Map<String, Object>> rows = checks.stream().filter(c -> cl.equals(c.get("case_label"))).toList();
            if (rows.isEmpty()) continue;
            D.h2(cl.equals("Process") ? "The workflow and its controls" : cl.equals("QC") ? "Quality control" : "Results: " + cl, false);
            List<List<Object>> t = new ArrayList<>();
            t.add(row("Check", "What is checked, and how", "Requirements", "Expected (protocol)", "Actual (system)", "Evidence", "Result"));
            for (Map<String, Object> c : rows) {
                List<Object> actual = new ArrayList<>(List.of(Run.of(txt(JsValues.plain(c.get("actual"))))));
                if (Js.truthy(c.get("note"))) actual.add(Run.of("\n" + str(c.get("note"))).italics());
                t.add(row(Run.of(nz(c.get("check_code"))).bolded(), List.of(Run.of(nz(c.get("title"))).bolded(), Run.of("\n" + (Js.truthy(c.get("procedure_text")) ? str(c.get("procedure_text")) : ""))),
                    String.join(", ", list(c.get("requirement_codes")).stream().map(JsValues::str).toList()), txt(JsValues.plain(c.get("expected"))), actual, evOf.apply(c.get("check_code")), res(c.get("result"))));
            }
            D.table(t, new double[] {0.05, 0.27, 0.08, 0.2, 0.26, 0.07, 0.07}, 7.5);
        }

        D.h1("7. Traceability", false);
        List<List<Object>> tr = new ArrayList<>();
        tr.add(row("Requirement", "Checks", "Evidence", "Result"));
        for (Map<String, Object> r : reqs) {
            List<Object> traces = list(r.get("traces"));
            Set<String> evs = new LinkedHashSet<>();
            for (Map<String, Object> c : checks) if (list(c.get("requirement_codes")).contains(r.get("req_code"))) for (String x : evOf.apply(c.get("check_code")).split(", ")) if (!x.isEmpty()) evs.add(x);
            String checksText = checksOf.apply(r.get("req_code"));
            tr.add(row(Run.of(nz(r.get("req_code")) + (!traces.isEmpty() ? " (" + String.join(", ", traces.stream().map(JsValues::str).toList()) + ")" : "")).bolded(), checksText.isEmpty() ? "none" : checksText,
                String.join(", ", evs), List.of(res(r.get("result")), Run.of(Js.truthy(r.get("result_note")) ? " (" + str(r.get("result_note")) + ")" : ""))));
        }
        D.table(tr, new double[] {0.14, 0.4, 0.3, 0.16}, 8);

        D.h1("8. Execution", false);
        if (Js.truthy(w.get("executed_at"))) {
            long pass = checks.stream().filter(c -> "Pass".equals(c.get("result"))).count(), fail = checks.stream().filter(c -> "Fail".equals(c.get("result"))).count(),
                nt = checks.stream().filter(c -> "Not tested".equals(c.get("result"))).count();
            D.p("Executed " + dt(w.get("executed_at")) + " by " + (S.get("executed") != null ? str(map(S.get("executed")).get("full_name")) : "") + "; finished " + dt(w.get("finished_at")) + ". "
                + pass + " of " + checks.size() + " checks passed, " + fail + " failed, " + nt + " not tested.");
            Map<String, String> who = Map.of("executor", "Executed by", "analyst", "Verification analyst", "reviewer", "Verification reviewer", "witness", "Verification witness");
            List<List<Object>> lr = new ArrayList<>();
            lr.add(row("When", "Who", "What"));
            for (Object o : list(w.get("run_log"))) {
                Map<String, Object> l = map(o);
                lr.add(row(TIME.format(Instant.parse(str(l.get("at")))), who.getOrDefault(str(l.get("who")), str(l.get("who"))), str(l.get("action")) + (Js.truthy(l.get("detail")) ? "\n" + str(l.get("detail")) : "")));
            }
            D.table(lr, new double[] {0.1, 0.15, 0.75}, 7.5);
        } else D.p("Not executed yet.");

        D.h1("9. Deviations and requirements not tested", false);
        List<Map<String, Object>> bad = checks.stream().filter(c -> "Fail".equals(c.get("result")) || "Not tested".equals(c.get("result"))).toList();
        if (!Js.truthy(w.get("executed_at"))) D.p("Not executed yet.");
        else if (bad.isEmpty()) D.p("None: every check passed.");
        else {
            List<List<Object>> br = new ArrayList<>();
            br.add(row("Check", "Result", "Why"));
            for (Map<String, Object> c : bad) br.add(row(nz(c.get("check_code")) + " " + nz(c.get("title")), res(c.get("result")), Js.truthy(c.get("note")) ? str(c.get("note")) : txt(JsValues.plain(c.get("actual")))));
            D.table(br, new double[] {0.4, 0.1, 0.5}, 8);
        }
        List<Map<String, Object>> ntReqs = reqs.stream().filter(r -> "Not tested".equals(r.get("result"))).toList();
        if (!ntReqs.isEmpty()) {
            List<List<Object>> nr = new ArrayList<>();
            nr.add(row("Requirement not tested", "QA justification"));
            for (Map<String, Object> r : ntReqs) nr.add(row(nz(r.get("req_code")) + " " + nz(r.get("statement")), Js.truthy(r.get("qa_justification")) ? str(r.get("qa_justification")) : "Waiting for QA"));
            D.table(nr, new double[] {0.55, 0.45}, 8);
        }

        D.h1("10. Conclusion", false);
        if ("Report signed".equals(w.get("status"))) {
            D.p(List.of(Run.of(nz(w.get("outcome")) + ". ").bolded(), Run.of(Js.truthy(w.get("report_conclusion")) ? str(w.get("report_conclusion")) : "")), Para.NONE);
            D.p("Signed by " + (S.get("report") != null ? str(map(S.get("report")).get("full_name")) : "") + " (QA), " + dt(w.get("report_signed_at")) + ".");
        } else if ("Cancelled".equals(w.get("status"))) D.p("Cancelled: " + (Js.truthy(w.get("cancelled_reason")) ? str(w.get("cancelled_reason")) : ""));
        else D.p("Waiting for the run, the evidence and QA's signature.");

        if (!evidence.isEmpty()) {
            D.h1("Appendix A. Objective evidence (screenshots)", true);
            D.p("Captured " + dt(w.get("evidence_captured_at")) + " by " + (S.get("evidence") != null ? str(map(S.get("evidence")).get("full_name")) : "") + ", in a headless browser signed in as that person. Each image is stored unchanged; its SHA-256 is printed under it.");
            for (int i = 0; i < evidence.size(); i++) {
                Map<String, Object> e = evidence.get(i);
                List<Object> codes = list(e.get("check_codes"));
                D.h2(e2(e.get("seq")) + ". " + nz(e.get("title")), i > 0);
                D.p(List.of(Run.of("Page " + nz(e.get("page_ref")) + " · captured " + dt(e.get("captured_at")) + " · checks " + (codes.isEmpty() ? "none" : String.join(", ", codes.stream().map(JsValues::str).toList()))).sized(8).colored("5C6773")), Para.after(40));
                D.image((byte[]) e.get("png"), e.get("width_px") == null ? null : ((Number) e.get("width_px")).intValue(), e.get("height_px") == null ? null : ((Number) e.get("height_px")).intValue(), 9.6, 5.7);
                D.p(List.of(Run.of("SHA-256 ").sized(7.5).colored("5C6773"), Run.of(nz(e.get("sha256"))).sized(7.5).monospaced().colored("5C6773")), new Para(null, "center", null, false, false));
            }
        }
        return D.build(nz(w.get("verification_code")) + " · " + nz(w.get("test_code")) + " " + nz(w.get("test_name")) + " v" + nz(w.get("version_no")) + " · Workflow verification protocol and report · Sandbox (not validated)", "LIMS3");
    }

    private static Map<String, Object> inp(Object sample, String part) { return map(map(map(sample).get("inputs")).get(part)); }

    private static String und(Map<String, Object> m, String k) { return m.containsKey(k) ? (m.get(k) == null ? "null" : str(m.get(k))) : "undefined"; }

    private static String sig(Object s) {
        if (s == null) return "";
        Map<String, Object> m = map(s);
        return nz(m.get("full_name")) + "\n" + dt(m.get("signed_at")) + "\n" + nz(m.get("method"));
    }

    private static String or(String a, String b) { return a == null || a.isEmpty() ? b : a; }
}
