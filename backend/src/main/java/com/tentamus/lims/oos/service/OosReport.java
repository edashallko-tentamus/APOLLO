package com.tentamus.lims.oos.service;

import static com.tentamus.lims.core.documents.Html.esc;
import static com.tentamus.lims.core.documents.Html.fmtDateTime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.browser.HeadlessBrowser;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.documents.Pdfs;
import com.tentamus.lims.core.excel.Js;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** The OOS investigation report (Phase I or Check and Acknowledge), as it stands with the conclusion being signed (oos.js report()). */
@Component
public class OosReport {
    private final HeadlessBrowser browser;
    private final ObjectMapper json;

    public OosReport(HeadlessBrowser browser, ObjectMapper json) {
        this.browser = browser;
        this.json = json;
    }

    /** The conclusion being signed: what the reviewer chose, by whom, when. */
    public record Pending(Object conclusion, Object cause, Object comment, Object answers, String by, Object at) {}

    public Pdfs.Made pdf(Db db, String oosId, Pending pending) {
        Map<String, Object> o = db.one("""
            SELECT x.*, s.sample_code, s.client_sample_id, s.description, s.lot, COALESCE(c.display_name, c.legal_name) AS client_name, si.site_name, si.time_zone,
                t.test_name, a.analyte_name, b.batch_code, ou.full_name AS opened_by_name, au.full_name AS analyst_name, su.full_name AS supervisor_name
              FROM oos_investigation x JOIN sample s ON s.id = x.sample_id JOIN lab_order lo ON lo.id = s.lab_order_id JOIN client c ON c.id = lo.client_id
              JOIN lab_site si ON si.id = x.site_id JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id JOIN analyte a ON a.id = x.analyte_id
              LEFT JOIN test_batch b ON b.id = x.batch_id JOIN app_user ou ON ou.id = x.opened_by LEFT JOIN app_user au ON au.id = x.analyst_by LEFT JOIN app_user su ON su.id = x.supervisor_by
             WHERE x.id = ?::uuid""", oosId);
        List<Map<String, Object>> items = db.rows("SELECT id, section, item_text FROM oos_checklist_item WHERE procedure::text = ? AND status = 'Active' ORDER BY section, sort_order",
            String.valueOf(o.get("procedure")));
        String html = html(o, items, pending);
        return Pdfs.Made.of(browser.htmlToPdf(html, esc(o.get("oos_code") + " · " + o.get("procedure") + " · " + o.get("site_name") + " · Sandbox (not validated)"), false));
    }

    private static String or(Object v) { return Js.truthy(v) ? com.tentamus.lims.core.documents.Html.text(v) : ""; }

    private String answers(List<Map<String, Object>> items, String sec, Object ans) {
        JsonNode a0 = ans == null ? json.createObjectNode() : json.valueToTree(ans);
        StringBuilder b = new StringBuilder("<table><thead><tr><th>Item</th><th style=\"width:60px\">Answer</th><th>Comment</th></tr></thead><tbody>");
        for (Map<String, Object> i : items) {
            if (!sec.equals(i.get("section"))) continue;
            JsonNode a = a0.path(String.valueOf(i.get("id")));
            b.append("<tr><td>").append(esc(i.get("item_text"))).append("</td><td><b>").append(esc(or(a.path("answer")))).append("</b></td><td>").append(esc(or(a.path("comment")))).append("</td></tr>");
        }
        return b.append("</tbody></table>").toString();
    }

    String html(Map<String, Object> o, List<Map<String, Object>> items, Pending pending) {
        String tz = (String) o.get("time_zone");
        boolean phase1 = "Full Phase I (21 CFR 211)".equals(String.valueOf(o.get("procedure")));
        StringBuilder checks = new StringBuilder();
        Object ac = o.get("auto_checks");
        if (ac instanceof JsonNode n && n.isArray()) for (JsonNode c : n) {
            checks.append("<tr><td>").append(esc(c.get("title"))).append("</td><td class=\"").append(esc(c.get("level"))).append("\">").append(esc(c.get("level")))
                .append("</td><td>").append(esc(c.get("detail"))).append("</td></tr>");
        }
        String body = phase1
            ? "<h2>Analyst section</h2>" + answers(items, "Analyst", o.get("analyst_answers"))
                + (Js.truthy(o.get("hypothesis")) ? "<p><b>Hypothesis testing:</b> " + esc(o.get("hypothesis")) + "</p>" : "")
                + (Js.truthy(o.get("analyst_comment")) ? "<p>" + esc(o.get("analyst_comment")) + "</p>" : "")
                + "\n    <div class=\"sig\">Signed by " + esc(or(o.get("analyst_name"))) + ", " + esc(fmtDateTime(o.get("analyst_at"), tz)) + "</div>\n"
                + "    <h2>Supervisor section</h2>" + answers(items, "Supervisor", o.get("supervisor_answers"))
                + (Js.truthy(o.get("supervisor_comment")) ? "<p>" + esc(o.get("supervisor_comment")) + "</p>" : "")
                + "\n    <div class=\"sig\">Signed by " + esc(or(o.get("supervisor_name"))) + ", " + esc(fmtDateTime(o.get("supervisor_at"), tz)) + "</div>"
            : "<h2>Review checklist</h2>" + answers(items, "Reviewer", pending.answers());
        return "<!doctype html><html><head><meta charset=\"utf-8\"><style>\n"
            + "    body { font: 9.5pt/1.4 \"Helvetica Neue\", Arial, sans-serif; color: #1d2329; }\n"
            + "    h1 { font-size: 15pt; color: #1f3a2c; margin: 0 0 2px; } h2 { font-size: 11pt; color: #1f3a2c; margin: 16px 0 5px; border-bottom: 1px solid #c9d3cf; padding-bottom: 2px; }\n"
            + "    .sub { color: #5c6773; margin-bottom: 10px; } table { width: 100%; border-collapse: collapse; margin: 4px 0; } th { background: #eef2f0; text-align: left; font-size: 8.5pt; padding: 4px 6px; }\n"
            + "    td { padding: 4px 6px; border-bottom: 1px solid #e3e8e6; vertical-align: top; } .kv td:first-child { width: 28%; color: #5c6773; font-weight: 600; }\n"
            + "    .Fail { color: #b42318; font-weight: 700; } .Pass { color: #1e7a4a; font-weight: 700; } .sig { margin-top: 4px; color: #333; }\n"
            + "  </style></head><body>\n"
            + "  <h1>" + (phase1 ? "OOS investigation, Phase I (laboratory)" : "OOS check and acknowledgement") + ": " + esc(o.get("oos_code")) + "</h1>\n"
            + "  <div class=\"sub\">" + esc(o.get("site_name")) + " · " + esc(o.get("procedure")) + " · opened " + esc(fmtDateTime(o.get("opened_at"), tz)) + " by " + esc(o.get("opened_by_name")) + "</div>\n"
            + "  <table class=\"kv\"><tbody>\n"
            + "    <tr><td>Client</td><td>" + esc(o.get("client_name")) + "</td></tr><tr><td>Sample</td><td>" + esc(o.get("sample_code")) + " (" + esc(or(o.get("client_sample_id"))) + ") "
            + esc(or(o.get("description"))) + (Js.truthy(o.get("lot")) ? ", lot " + esc(o.get("lot")) : "") + "</td></tr>\n"
            + "    <tr><td>Test</td><td>" + esc(o.get("test_name")) + (Js.truthy(o.get("batch_code")) ? ", batch " + esc(o.get("batch_code")) : "") + "</td></tr>\n"
            + "    <tr><td>Result</td><td><b>" + esc(o.get("analyte_name")) + ": " + esc(or(o.get("reported"))) + " " + esc(or(o.get("unit"))) + "</b></td></tr><tr><td>Specification</td><td>" + esc(or(o.get("spec_text"))) + "</td></tr>\n"
            + "    " + (Js.truthy(o.get("opened_reason")) ? "<tr><td>Why opened</td><td>" + esc(o.get("opened_reason")) + "</td></tr>" : "") + "\n"
            + "  </tbody></table>\n"
            + "  <h2>Automatic data checks</h2><table><thead><tr><th>Check</th><th style=\"width:55px\">Result</th><th>Detail</th></tr></thead><tbody>\n"
            + "    " + checks + "</tbody></table>\n"
            + "  " + body + "\n"
            + "  <h2>Conclusion" + (phase1 ? " (QA)" : "") + "</h2>\n"
            + "  <p><b>" + esc(pending.conclusion()) + "</b>" + (Js.truthy(pending.cause()) ? ". Assignable cause: " + esc(pending.cause()) : "") + "</p><p>" + esc(pending.comment()) + "</p>\n"
            + "  <p>" + ("OOS confirmed".equals(pending.conclusion())
                ? "No laboratory error was found: the result stands and is reported as out of specification. The client is told when it is released."
                : "The result is invalid: it is not reported, and a laboratory investigation retest (re-prep from the retained sample, not billed) replaces it.") + "</p>\n"
            + "  <div class=\"sig\">Signed by " + esc(pending.by()) + ", " + esc(fmtDateTime(pending.at(), tz)) + "</div>\n"
            + "  </body></html>";
    }

}
