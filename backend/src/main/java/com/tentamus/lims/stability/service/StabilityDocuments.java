package com.tentamus.lims.stability.service;

import static com.tentamus.lims.core.documents.Html.esc;
import static com.tentamus.lims.core.documents.Html.money;
import static com.tentamus.lims.core.documents.Html.num;
import static com.tentamus.lims.core.documents.Html.text;

import com.fasterxml.jackson.databind.JsonNode;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.excel.Js;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The stability documents as the Node backend's stability.js wrote them: the stability quotation (the study matrix, the
 * dates, the price per test and per study year) and the cumulative report (the summary, or the issued report with its
 * signature), from StabilityData's design and report data.
 */
public final class StabilityDocuments {
    private StabilityDocuments() {}

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Object o) { return o instanceof List<?> l ? (List<Map<String, Object>>) l : List.of(); }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> obj(Object o) { return o instanceof Map<?, ?> m ? (Map<String, Object>) m : null; }

    private static Object field(Map<String, Object> m, String k) { return m == null ? null : m.get(k); }

    /** Number(x).toFixed(n): rounded on the exact binary value, half up, as JavaScript does. */
    static String toFixed(double v, int n) { return new BigDecimal(v).setScale(n, RoundingMode.HALF_UP).toPlainString(); }

    private static String dOnly(Object d) { return Html.dOnly(d, x -> Html.fmtDate(x, null)); }

    /** The stability quotation: v is the quote's version row (quotes' data), d its design. */
    public static String quoteHtml(Map<String, Object> v, Map<String, Object> d, boolean preview) {
        Map<String, Object> plan = obj(d.get("plan"));
        List<Map<String, Object>> tps = list(d.get("timepoints")), lines = list(d.get("lines")), cells = list(d.get("cells")), conds = list(d.get("conditions"));
        List<Map<String, Object>> years = StabilityData.priceByYear(d);
        double total = 0;
        for (Map<String, Object> y : years) total += num(y.get("total"));
        List<Map<String, Object>> pulls = tps.stream().filter(t -> num(t.get("interval_value")) > 0).toList();
        Map<String, Object> t0 = tps.stream().filter(t -> num(t.get("interval_value")) == 0).findFirst().orElse(null);
        List<Map<String, Object>> cols = new ArrayList<>();
        if (t0 != null) cols.add(t0);
        cols.addAll(pulls);
        StringBuilder head = new StringBuilder();
        for (Map<String, Object> t : cols)
            head.append("<th class=\"c\">").append(esc(t.get("label"))).append(Js.truthy(t.get("planned_date")) ? "<div class=\"m\">" + esc(dOnly(t.get("planned_date"))) + "</div>" : "").append("</th>");
        StringBuilder tables = new StringBuilder();
        for (Map<String, Object> cond : conds) {
            tables.append("<h2>").append(esc(cond.get("condition_name"))).append(" <span class=\"m\">").append(esc(cond.get("condition_type"))).append("</span></h2>\n    <table><thead><tr><th>Test</th>")
                .append(head).append("<th class=\"n\">Times</th></tr></thead><tbody>\n    ");
            for (Map<String, Object> l : lines) {
                List<Boolean> marks = new ArrayList<>();
                for (Map<String, Object> t : cols) marks.add(has(cells, l, t, num(t.get("interval_value")) == 0 ? null : cond.get("condition_id")));
                if (!marks.contains(true)) continue;
                tables.append("<tr><td>").append(esc(l.get("test_name"))).append("</td>");
                for (int i = 0; i < marks.size(); i++) tables.append("<td class=\"c\">").append(marks.get(i) ? (i == 0 && t0 != null ? "T0" : "&#10003;") : "").append("</td>");
                tables.append("<td class=\"n\">").append(marks.stream().filter(b -> b).count()).append("</td></tr>");
            }
            tables.append("\n    </tbody></table>");
        }
        Object escPctRaw = field(plan, "escalation_pct");
        double escPct = num(escPctRaw);
        StringBuilder price = new StringBuilder();
        for (Map<String, Object> l : lines) {
            long n = cells.stream().filter(c -> Objects.equals(c.get("line_id"), l.get("id"))).count();
            price.append("<tr><td>").append(esc(l.get("test_name"))).append("</td><td class=\"n\">").append(money(l.get("list_price"))).append("</td><td class=\"n\">")
                .append(money(l.get("final_price"))).append("</td><td class=\"n\">").append(n).append("</td>\n      <td class=\"n\">")
                .append(Js.truthy(l.get("units")) ? text(l.get("units")) : "1").append("</td><td class=\"n\">").append(money(num(l.get("final_price")) * n)).append("</td></tr>");
        }
        StringBuilder byYear = new StringBuilder();
        if (years.size() > 1 || Js.truthy(escPct)) {
            byYear.append("<h2>By study year</h2><table><thead><tr><th>Study year</th><th class=\"n\">Tests performed</th><th class=\"n\">Price factor</th><th class=\"n\">Amount</th></tr></thead><tbody>\n    ");
            for (Map<String, Object> y : years) {
                int yr = ((Number) y.get("year")).intValue();
                byYear.append("<tr><td>Year ").append(yr).append("</td><td class=\"n\">").append(text(y.get("tests"))).append("</td><td class=\"n\">")
                    .append(toFixed(Math.pow(1 + num(Js.truthy(escPctRaw) ? escPctRaw : 0) / 100, yr - 1), 4)).append("</td><td class=\"n\">").append(money(y.get("total"))).append("</td></tr>");
            }
            byYear.append("</tbody></table>");
        }
        String late = pulls.stream().map(t -> text(t.get("days_late"))).collect(Collectors.toCollection(LinkedHashSet::new)).stream().collect(Collectors.joining("/"));
        Object reserve = plan == null ? null : (plan.get("reserve_pct") != null ? plan.get("reserve_pct") : plan.get("stability_reserve_pct"));
        double res = Js.truthy(reserve) ? num(reserve) : 10;
        return "<!doctype html><html><head><meta charset=\"utf-8\"><style>\n"
            + "    body { font: 9.5pt Helvetica, Arial, sans-serif; color: #1d2329; margin: 0; }\n"
            + "    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1f3a2c; padding-bottom: 10px; margin-bottom: 12px; }\n"
            + "    .brand { font-size: 17pt; font-weight: 700; color: #1f3a2c; } .m { color: #5c6773; font-size: 8pt; font-weight: 400; }\n"
            + "    h1 { margin: 0; font-size: 17pt; color: #1f3a2c; text-align: right; } .meta { text-align: right; font-size: 9pt; }\n"
            + "    .to { display: flex; gap: 36px; margin-bottom: 10px; } .to b { display: block; color: #5c6773; font-size: 8pt; text-transform: uppercase; }\n"
            + "    table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; } th { background: #eef3f0; text-align: left; font-size: 8pt; padding: 4px 5px; border-bottom: 1px solid #c8d3cc; vertical-align: bottom; }\n"
            + "    td { padding: 4px 5px; border-bottom: 1px solid #e6ebe8; vertical-align: top; font-size: 8.5pt; } .n { text-align: right; white-space: nowrap; } .c { text-align: center; }\n"
            + "    h2 { font-size: 10.5pt; color: #1f3a2c; margin: 14px 0 2px; } .tot { display: flex; justify-content: flex-end; gap: 24px; font-size: 10pt; } .big { font-size: 13pt; font-weight: 700; color: #1f3a2c; }\n"
            + "    .terms { font-size: 8pt; color: #5c6773; margin-top: 14px; border-top: 1px solid #e6ebe8; padding-top: 8px; } .draft { border: 2px solid #c68a00; color: #8a5a00; padding: 6px 10px; margin-bottom: 10px; font-weight: 700; }\n"
            + "    .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 20px; margin: 6px 0 10px; } .facts div b { color: #5c6773; font-size: 8pt; display: block; text-transform: uppercase; }\n"
            + "  </style></head><body>\n  "
            + (preview ? "<div class=\"draft\">PREVIEW: not issued. Prices are final only when the quotation is issued.</div>" : "")
            + "\n  <div class=\"head\"><div><div class=\"brand\">Tentamus North America</div><div class=\"m\">Stability testing · " + esc(plan == null ? "" : plan.get("site_name")) + "</div></div>\n"
            + "    <div><h1>Stability study quotation</h1><div class=\"meta\">" + esc(v.get("project_code")) + " · version " + text(v.get("version_no")) + "<br>Issued: "
            + (Js.truthy(v.get("quoted_at")) ? esc(Html.fmtDate(v.get("quoted_at"), null)) : "not yet issued") + "<br>Valid until: "
            + (Js.truthy(v.get("valid_until")) ? esc(dOnly(v.get("valid_until"))) : "no expiry date") + "</div></div></div>\n"
            + "  <div class=\"to\"><div><b>Prepared for</b>" + esc(v.get("client_legal_name")) + (Js.truthy(v.get("quote_contact_name")) ? "<br>Attn: " + esc(v.get("quote_contact_name")) : "")
            + "</div><div><b>Prepared by</b>" + esc(Js.orBlank(v.get("owner_name"))) + "</div>" + (Js.truthy(v.get("project_name")) ? "<div><b>Reference</b>" + esc(v.get("project_name")) + "</div>" : "") + "</div>\n"
            + "  <div class=\"facts\">\n"
            + "    <div><b>Product</b>" + esc(Js.orBlank(field(plan, "product"))) + "</div><div><b>Lot</b>" + esc(Js.orBlank(field(plan, "lot"))) + "</div><div><b>Protocol</b>" + esc(Js.orBlank(field(plan, "protocol_ref"))) + "</div>\n"
            + "    <div><b>Conditions</b>" + esc(conds.stream().map(c -> text(c.get("condition_name"))).collect(Collectors.joining("; "))) + "</div>\n"
            + "    <div><b>Timepoints</b>" + esc(tps.stream().map(t -> text(t.get("label"))).collect(Collectors.joining(", "))) + "</div>\n"
            + "    <div><b>Placement</b>" + (plan != null && Js.truthy(plan.get("planned_placement")) ? esc(dOnly(plan.get("planned_placement"))) + " (planned)" : "on receipt of the material") + "</div>\n"
            + "  </div>\n  " + tables
            + "\n  <h2>Price</h2>\n  <table><thead><tr><th>Test</th><th class=\"n\">List price</th><th class=\"n\">Your price per test</th><th class=\"n\">Times in the study</th><th class=\"n\">Material per test ("
            + esc(Js.truthy(field(plan, "unit_name")) ? plan.get("unit_name") : "units") + ")</th><th class=\"n\">Total (year-one prices)</th></tr></thead><tbody>\n    " + price
            + "\n  </tbody></table>\n  " + byYear
            + "\n  <div class=\"tot\"><span class=\"big\">Study total " + money(total) + "</span></div>\n"
            + "  <div class=\"terms\"><b>Terms.</b> Prices are per test in USD. The client ships all the material at the start; T0 (baseline) is tested when the material is placed in the chambers, and each later timepoint is pulled from the chamber on its date and billed when it is completed. "
            + (Js.truthy(escPct) ? "Prices rise " + Js.number(escPct) + "% on each anniversary of acceptance, compounded; each pull is billed at the price for the study year it falls in." : "Prices hold for the whole study.")
            + " Pull dates that fall on a weekend or holiday move to the nearest working day inside each timepoint's window (± " + (late.isEmpty() ? "7" : late)
            + " days). Turnaround for each pull counts from its scheduled date. The material needed is " + (lines.isEmpty() ? "agreed" : "listed above per test")
            + ", plus a reserve of " + Js.number(res) + "%.</div>\n  </body></html>";
    }

    private static boolean has(List<Map<String, Object>> cells, Map<String, Object> l, Map<String, Object> tp, Object cond) {
        for (Map<String, Object> c : cells)
            if (Objects.equals(c.get("line_id"), l.get("id")) && Objects.equals(c.get("timepoint_id"), tp.get("id")) && Objects.equals(c.get("condition_id"), cond)) return true;
        return false;
    }

    /** The signed issue printed on an issued report (null for the summary). */
    public record Issue(String reportCode, int versionNo, boolean isFinal, String by, String title, String signature, Object at, String tz) {}

    private static final Map<String, String> FATE = Map.of("Destroyed", "destroyed", "Returned", "returned to the client", "Retained", "kept as a retain", "Used up", "used up", "Stored", "stored");

    private static String joinText(Object o) {
        if (o instanceof JsonNode n && n.isArray()) {
            List<String> out = new ArrayList<>();
            for (JsonNode x : n) out.add(x.isNull() ? "" : x.asText());
            return String.join("; ", out);
        }
        if (o instanceof List<?> l) return l.stream().map(Html::text).collect(Collectors.joining("; "));
        return "";
    }

    /** The cumulative report: the summary (issue null) or the issued report the client is sent. */
    @SuppressWarnings("unchecked")
    public static String reportHtml(Map<String, Object> r, Issue issue) {
        Map<String, Object> st = (Map<String, Object>) r.get("study");
        String tz = issue == null ? null : issue.tz();
        Function<Object, String> when = v -> Js.truthy(v) ? Html.mediumShort(v, tz) : "";
        String title = issue != null ? "Stability report " + issue.reportCode() : "Stability summary report";
        String sub = issue != null
            ? (issue.isFinal() ? "Final report" : "Interim report, version " + issue.versionNo()) + " · " + esc(st.get("study_code")) + " · " + esc(st.get("project_code")) + " v" + text(st.get("version_no"))
                + "<br>Issued " + esc(when.apply(issue.at()))
            : esc(st.get("study_code")) + " · " + esc(st.get("project_code")) + " v" + text(st.get("version_no")) + "<br>Results as of " + esc(Html.fmtDate(Instant.now(), null))
                + " · not issued, not a Certificate of Analysis";
        List<Map<String, Object>> excursions = list(r.get("excursions")), amendments = list(r.get("amendments")), storage = list(r.get("storage")), sections = list(r.get("sections"));
        StringBuilder exc = new StringBuilder();
        if (!excursions.isEmpty()) {
            exc.append("<h2>Chamber excursions and their assessment</h2>\n    <table><thead><tr><th class=\"l\">When</th><th class=\"l\">Chamber</th><th class=\"l\">Material</th><th class=\"l\">Reading</th><th class=\"l\">Back in range</th><th class=\"l\">Assessment</th><th class=\"l\">Justification</th><th class=\"l\">Pulls concerned</th></tr></thead><tbody>\n    ");
            for (Map<String, Object> x : excursions) {
                exc.append("<tr><td class=\"l\">").append(esc(when.apply(x.get("entry_at")))).append("</td><td class=\"l\">").append(esc(x.get("equipment_code"))).append(' ').append(esc(x.get("equipment_name")))
                    .append("</td><td class=\"l\">").append(esc(x.get("storage_code"))).append("</td>\n      <td class=\"l\">").append(esc(joinText(x.get("problems"))))
                    .append(Js.truthy(x.get("failure_reason")) ? " (" + esc(x.get("failure_reason")) + ")" : "").append("</td><td class=\"l\">")
                    .append(Js.truthy(x.get("window_end")) ? esc(when.apply(x.get("window_end"))) : "not yet").append("</td>\n      <td class=\"l\"><b>")
                    .append(esc(Js.truthy(x.get("decision")) ? x.get("decision") : "Not assessed yet")).append("</b>")
                    .append(Js.truthy(x.get("assessed_by_name")) ? "<br><span class=\"m\">" + esc(x.get("assessed_by_name")) + ", " + esc(when.apply(x.get("assessed_at"))) + "</span>" : "")
                    .append("</td>\n      <td class=\"l\">").append(esc(Js.orBlank(x.get("justification")))).append("</td><td class=\"l\">").append(esc(Js.orBlank(x.get("affected_pulls")))).append("</td></tr>");
            }
            exc.append("</tbody></table>");
        }
        StringBuilder amd = new StringBuilder();
        if (!amendments.isEmpty()) {
            amd.append("<h2>Amendments</h2><ul class=\"amd\">");
            for (Map<String, Object> a : amendments)
                amd.append("<li>Amendment ").append(text(a.get("amendment_no"))).append(": quote version ").append(text(a.get("to_version"))).append(" (replacing version ").append(text(a.get("from_version")))
                    .append(") accepted ").append(esc(when.apply(a.get("applied_at")))).append(": ").append(text(a.get("pulls_added"))).append(" pull(s) added, ").append(text(a.get("pulls_cancelled")))
                    .append(" cancelled, ").append(text(a.get("pulls_changed"))).append(" moved. Pulls already taken were not changed.</li>");
            amd.append("</ul>");
        }
        String can = "";
        if ("Cancelled".equals(st.get("status"))) {
            String mat = storage.stream().map(s -> esc(s.get("storage_code")) + " (" + esc(s.get("condition_name")) + ") "
                + esc(FATE.getOrDefault(text(s.get("status")), text(s.get("status")))) + (Js.truthy(s.get("disposition_note")) ? ": " + esc(s.get("disposition_note")) : "")).collect(Collectors.joining("; "));
            can = "<h2>Study cancelled</h2><p>Cancelled " + esc(when.apply(st.get("cancelled_at"))) + " by " + esc(Js.orBlank(st.get("cancelled_by_name"))) + ": " + esc(Js.orBlank(st.get("cancel_reason")))
                + ".\n    Material: " + mat + ".</p>";
        }
        String sig = issue == null ? "" : "<div class=\"sig\">" + (issue.signature() != null ? "<img src=\"" + issue.signature() + "\" alt=\"Signature of " + esc(issue.by()) + "\">" : "<div style=\"height:40px\"></div>")
            + "\n    <div class=\"sigline\">" + esc(issue.by()) + (Js.truthy(issue.title()) ? "<br>" + esc(issue.title()) : "") + "<br>Signed " + esc(when.apply(issue.at())) + " (electronic signature)</div></div>";
        StringBuilder body = new StringBuilder();
        for (Map<String, Object> s : sections) {
            Map<String, Object> cond = (Map<String, Object>) s.get("condition");
            List<Map<String, Object>> tps = list(s.get("timepoints"));
            body.append("<h2>").append(esc(cond.get("condition_name"))).append(Js.truthy(cond.get("dropped")) ? " <span class=\"dropped\">(no longer in the study)</span>" : "").append("</h2>");
            for (Map<String, Object> t : list(s.get("tests"))) {
                body.append("<h3>").append(esc(t.get("test_name"))).append("</h3>\n    <table><thead><tr><th class=\"l\">Analyte</th><th class=\"l\">Unit</th><th class=\"l\">Specification</th>");
                for (Map<String, Object> tp : tps) body.append("<th>").append(esc(tp.get("label"))).append("</th>");
                body.append("</tr></thead><tbody>\n    ");
                List<Map<String, Object>> analytes = list(t.get("analytes"));
                if (analytes.isEmpty()) body.append("<tr><td class=\"l pend\" colspan=\"").append(3 + tps.size()).append("\">No results yet</td></tr>");
                for (Map<String, Object> a : analytes) {
                    body.append("<tr><td class=\"l\">").append(esc(a.get("analyte_name"))).append("</td><td class=\"l\">").append(esc(a.get("unit"))).append("</td><td class=\"l\">").append(esc(a.get("spec"))).append("</td>");
                    for (Object v : (List<Object>) a.get("values")) body.append(cell(obj(v)));
                    body.append("</tr>");
                }
                body.append("</tbody></table>");
            }
        }
        return "<!doctype html><html><head><meta charset=\"utf-8\"><style>\n"
            + "    body { font: 9pt Helvetica, Arial, sans-serif; color: #1d2329; margin: 0; }\n"
            + "    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1f3a2c; padding-bottom: 8px; margin-bottom: 10px; }\n"
            + "    .brand { font-size: 15pt; font-weight: 700; color: #1f3a2c; } h1 { margin: 0; font-size: 15pt; color: #1f3a2c; text-align: right; } .m { color: #5c6773; font-size: 8pt; }\n"
            + "    .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 16px; margin-bottom: 8px; } .facts b { display: block; color: #5c6773; font-size: 7.5pt; text-transform: uppercase; }\n"
            + "    h2 { font-size: 11pt; color: #1f3a2c; margin: 14px 0 4px; border-bottom: 1px solid #c8d3cc; } h3 { font-size: 9.5pt; margin: 8px 0 2px; }\n"
            + "    table { width: 100%; border-collapse: collapse; margin-bottom: 6px; } th { background: #eef3f0; font-size: 7.5pt; padding: 3px 4px; text-align: center; border-bottom: 1px solid #c8d3cc; }\n"
            + "    th.l, td.l { text-align: left; } td { padding: 3px 4px; border-bottom: 1px solid #e6ebe8; font-size: 8pt; vertical-align: top; } .c { text-align: center; }\n"
            + "    .pend { color: #8a95a0; font-style: italic; } .na { color: #c0c7cd; } .oos { color: #b42318; font-weight: 700; } sup { color: #8a5a00; } sup.ex { color: #b42318; font-weight: 700; }\n"
            + "    .note { font-size: 7.5pt; color: #5c6773; margin-top: 10px; } .amd { margin: 0; padding-left: 16px; } .dropped { color: #5c6773; font-weight: 400; font-size: 8.5pt; }\n"
            + "    .sig { margin-top: 18px; width: 260px; } .sig img { max-height: 46px; max-width: 220px; } .sigline { border-top: 1px solid #1d2329; padding-top: 3px; font-size: 8pt; }\n"
            + "  </style></head><body>\n"
            + "  <div class=\"head\"><div><div class=\"brand\">Tentamus North America</div><div class=\"m\">" + esc(st.get("site_code")) + " · stability testing</div></div>\n"
            + "    <div><h1>" + esc(title) + "</h1><div class=\"m\" style=\"text-align:right\">" + sub + "</div></div></div>\n"
            + "  <div class=\"facts\"><div><b>Client</b>" + esc(st.get("client_name")) + "</div><div><b>Product</b>" + esc(Js.orBlank(st.get("product"))) + "</div><div><b>Lot</b>" + esc(Js.orBlank(st.get("lot")))
            + "</div><div><b>Placed</b>" + (Js.truthy(st.get("placement_date")) ? esc(dOnly(st.get("placement_date"))) : "not yet") + "</div>\n"
            + "    <div><b>Study</b>" + esc(st.get("study_code")) + " (" + esc(st.get("status")) + ")</div><div><b>Conditions</b>"
            + esc(sections.stream().map(s -> text(((Map<String, Object>) s.get("condition")).get("condition_name"))).collect(Collectors.joining("; ")))
            + "</div><div><b>Pulls</b>" + text(st.get("pulls_done")) + " of " + text(st.get("pulls_total")) + " taken</div><div><b>Amendments</b>"
            + (Js.truthy(st.get("amendment_no")) ? text(st.get("amendment_no")) : "none") + "</div></div>\n  "
            + body + "\n  " + exc + amd + can
            + "\n  <div class=\"note\">T0 is the baseline, tested at placement, shown under every condition. "
            + (issue != null ? "Only finalized results are reported; pending: not yet pulled, tested or finalized." : "<sup>P</sup> preliminary result (not final). Pending: the timepoint has not been pulled or reviewed yet.")
            + "\n    <sup class=\"ex\">E</sup> material that was in a chamber during an excursion assessed as having an impact (see the excursions above). Each pull's results are also reported on its own Certificate of Analysis.</div>\n  "
            + sig + "\n  </body></html>";
    }

    private static String cell(Map<String, Object> v) {
        if (v == null) return "<td class=\"c na\">–</td>";
        if (Boolean.TRUE.equals(v.get("pending"))) return "<td class=\"c pend\">pending</td>";
        return "<td class=\"c " + ("Does not conform".equals(v.get("conformance")) ? "oos" : "") + "\">" + esc(v.get("text")) + ("Preliminary".equals(v.get("stage")) ? "<sup>P</sup>" : "")
            + (Boolean.TRUE.equals(v.get("flagged")) ? "<sup class=\"ex\">E</sup>" : "") + "</td>";
    }
}
