package com.tentamus.lims.trending.service;

import static com.tentamus.lims.trending.service.TrendEngine.esc;
import static com.tentamus.lims.trending.service.TrendEngine.fmt;

import com.tentamus.lims.core.excel.Js;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** The trend chart PDF's page (routes_trending.js pdfHtml): each panel's SVGs, facts and signals with their reviews. */
final class TrendPdf {
    private TrendPdf() {}

    private static String s(Object v) { return v == null ? "" : TrendEngine.tpl(v); }

    @SuppressWarnings("unchecked")
    private static String block(Map<String, Object> p) {
        if (p.get("error") != null) return "<section><h2>" + esc(p.get("title")) + "</h2><p class=\"m\">" + esc(p.get("error")) + "</p></section>";
        Map<String, Object> st = p.get("stats") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        Object chart = p.get("chart");
        List<String> facts = new ArrayList<>();
        if ("pareto".equals(chart)) facts.add(TrendEngine.tpl(p.get("total")) + " in all");
        else if ("regression".equals(chart)) {
            if (p.get("fits") instanceof List<?> fits) for (Object o : fits) {
                Map<String, Object> x = (Map<String, Object>) o;
                facts.add(TrendEngine.tpl(x.get("name")) + ": " + TrendEngine.tpl(x.get("note"))
                    + (x.containsKey("slope") ? " (slope " + fmt(TrendEngine.dv(x.get("slope"))) + " per month, r² " + fmt(TrendEngine.dv(x.get("r2")), 2) + ")" : ""));
            }
        } else {
            facts.add((p.get("points") instanceof List<?> l ? l.size() : 0) + " points");
            boolean pc = "p".equals(chart);
            if (st.get("cl") != null) {
                Double cl = TrendEngine.dv(st.get("cl"));
                facts.add("centre line " + fmt(pc && cl != null ? cl * 100 : cl) + (pc ? " %" : "") + (Js.truthy(st.get("frozen")) ? " (frozen)" : ""));
            }
            // JavaScript's st.ucl !== null is also true when the key is absent
            if ("i".equals(chart) && (st.get("ucl") != null || !st.containsKey("ucl"))) facts.add("limits " + fmt(TrendEngine.dv(st.get("lcl"))) + " to " + fmt(TrendEngine.dv(st.get("ucl"))));
            if (p.get("capability") instanceof Map<?, ?> c && c.get("cpk") != null && Double.isFinite(TrendEngine.dv(c.get("cpk")))) {
                facts.add("Cpk " + fmt(TrendEngine.dv(c.get("cpk")), 2) + (Js.truthy(c.get("note")) ? " (" + c.get("note") + ")" : ""));
            }
        }
        facts.removeIf(String::isEmpty);
        List<String> escaped = facts.stream().map(TrendEngine::esc).toList();
        List<Map<String, Object>> sig = p.get("signals") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
        StringBuilder sigs = new StringBuilder();
        if (!sig.isEmpty()) {
            sigs.append("<table><thead><tr><th>Point</th><th>Rule</th><th>What it means</th><th>Review</th></tr></thead><tbody>");
            for (Map<String, Object> x : sig) {
                Map<String, Object> rv = x.get("review") instanceof Map<?, ?> r ? (Map<String, Object>) r : null;
                sigs.append("<tr><td>").append(esc(x.get("label"))).append("</td><td>").append(esc(x.get("rule"))).append("</td><td>").append(esc(x.get("text"))).append("</td><td>")
                    .append(rv != null ? esc(rv.get("outcome")) + ": " + esc(rv.get("comment")) + " (" + esc(rv.get("reviewed_by_name")) + ")" : "<i>Not reviewed</i>").append("</td></tr>");
            }
            sigs.append("</tbody></table>");
        } else if (Js.truthy(chart) && !"pareto".equals(chart) && !"regression".equals(chart)) sigs.append("<p class=\"m\">No signals.</p>");
        return "<section><h2>" + esc(p.get("title")) + "</h2>" + (Js.truthy(p.get("qa")) ? "<p class=\"m\">" + esc(p.get("qa")) + "</p>" : "") + "<div class=\"svg\">" + s(p.get("svg")) + "</div>"
            + (Js.truthy(p.get("mrSvg")) ? "<div class=\"svg mr\">" + p.get("mrSvg") + "</div>" : "") + "\n      <p class=\"facts\">" + String.join(" · ", escaped) + "</p>\n      " + sigs + "</section>";
    }

    static String html(String title, String intro, List<Map<String, Object>> panels, Map<String, Object> lab, Map<String, Object> me, Object from, Object to) {
        StringBuilder body = new StringBuilder();
        for (Map<String, Object> p : panels) body.append(block(p));
        String now = String.valueOf(me.get("now"));
        return "<!doctype html><html><head><meta charset=\"utf-8\"><style>\n"
            + "    body { font: 9pt Helvetica, Arial, sans-serif; color: #1d2a33; margin: 0; }\n"
            + "    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1f3a2c; padding-bottom: 8px; margin-bottom: 10px; }\n"
            + "    .brand { font-size: 15pt; font-weight: 700; color: #1f3a2c; } h1 { margin: 0; font-size: 15pt; color: #1f3a2c; text-align: right; } .m { color: #66737f; font-size: 8.5pt; }\n"
            + "    section { page-break-inside: avoid; margin-bottom: 14px; } h2 { font-size: 11pt; color: #1f3a2c; margin: 10px 0 4px; }\n"
            + "    .svg svg { width: 100%; height: auto; } .facts { margin: 4px 0; } table { width: 100%; border-collapse: collapse; margin-top: 4px; }\n"
            + "    th { background: #eef3f0; text-align: left; font-size: 8pt; padding: 3px 4px; } td { border-bottom: 1px solid #e6ebe8; padding: 3px 4px; font-size: 8pt; vertical-align: top; }\n"
            + "  </style></head><body>\n"
            + "  <div class=\"head\"><div><div class=\"brand\">Tentamus North America</div><div class=\"m\">" + esc(Js.truthy(lab.get("site_name")) ? lab.get("site_name") : lab.get("site_code")) + " · trending</div></div>\n"
            + "    <div><h1>" + esc(title) + "</h1><div class=\"m\" style=\"text-align:right\">"
            + (Js.truthy(from) || Js.truthy(to) ? esc(Js.truthy(from) ? from : "the start") + " to " + esc(Js.truthy(to) ? to : "today") : "Default period")
            + " · printed " + esc(now.substring(0, Math.min(16, now.length())).replace('T', ' ')) + " UTC by " + esc(me.get("full_name")) + "</div></div></div>\n"
            + "  " + (Js.truthy(intro) ? "<p>" + esc(intro) + "</p>" : "") + "\n"
            + "  " + (body.length() > 0 ? body : "<p class=\"m\">Nothing to chart.</p>") + "\n"
            + "  <p class=\"m\">Control limits are the centre line ± 3 sigma (individuals: sigma from the average moving range / 1.128; p: from the overall rate and each period's count; c: √mean). Signals follow the Western Electric rules: R1 a point beyond 3 sigma; R2 2 of 3 beyond 2 sigma; R3 4 of 5 beyond 1 sigma; R4 8 in a row on one side; R5 6 in a row rising or falling; LIM outside the specification or acceptance limits. A trend chart is a monitoring tool (ISO/IEC 17025 7.7); it does not change any result.</p>\n"
            + "  </body></html>";
    }
}
