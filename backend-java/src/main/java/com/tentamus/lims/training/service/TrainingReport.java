package com.tentamus.lims.training.service;

import static com.tentamus.lims.core.documents.Html.esc;

import com.tentamus.lims.core.browser.HeadlessBrowser;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.excel.Js;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/** A person's training report as a PDF (the Node route GET /api/training/people/:id/report.pdf). */
@Component
public class TrainingReport {
    private final HeadlessBrowser browser;

    public TrainingReport(HeadlessBrowser browser) { this.browser = browser; }

    @SuppressWarnings("unchecked")
    public byte[] pdf(Map<String, Object> lab, Map<String, Object> p) {
        Map<String, Object> person = (Map<String, Object>) p.get("person");
        return browser.htmlToPdf(html(lab, p, Instant.now()), esc("Training report · " + Html.text(person.get("full_name")) + " · " + Html.text(lab.get("site_code"))), false);
    }

    /** `${v}` in a JavaScript template: null prints "null". */
    private static String tpl(Object v) { return v == null ? "null" : Html.text(v); }

    private static String or(Object v) { return Js.truthy(v) ? Html.text(v) : ""; }

    @SuppressWarnings("unchecked")
    static String html(Map<String, Object> lab, Map<String, Object> p, Instant now) {
        String tz = (String) lab.get("time_zone");
        java.util.function.Function<Object, String> d8 = v -> Js.truthy(v) ? Html.fmtDate(v, tz) : "";
        Map<String, Object> person = (Map<String, Object>) p.get("person");
        Map<String, Object> last = (Map<String, Object>) p.get("last_competency_sample");
        StringBuilder quals = new StringBuilder();
        for (Map<String, Object> q : (List<Map<String, Object>>) p.get("qualifications")) {
            quals.append("<tr><td>").append(esc(q.get("test_name"))).append("</td><td>").append(esc(or(q.get("department_name")))).append("</td><td>").append(esc(q.get("source")))
                .append(Js.truthy(q.get("attempt_code")) ? " " + esc(q.get("attempt_code")) : "").append(Js.truthy(q.get("conditions")) ? "<div class=\"sub\">Conditional: " + esc(q.get("conditions")) + "</div>" : "")
                .append("</td>\n      <td>").append(esc(d8.apply(q.get("granted_at")))).append("</td><td>").append(esc(d8.apply(q.get("last_competency_at")))).append("</td><td>").append(esc(d8.apply(q.get("due_on"))))
                .append("</td><td>").append(tpl(q.get("runs_12m"))).append(" / ").append(tpl(q.get("runs_total"))).append("</td><td>").append(esc(d8.apply(q.get("last_run")))).append("</td>\n      <td class=\"")
                .append("Lapsed".equals(q.get("state")) ? "lapsed" : "Due soon".equals(q.get("state")) ? "due" : "").append("\">").append(esc(q.get("state")))
                .append(Js.truthy(q.get("why")) ? "<div class=\"sub\">" + esc(q.get("why")) + "</div>" : "").append("</td></tr>");
        }
        StringBuilder depts = new StringBuilder();
        for (Map<String, Object> d : (List<Map<String, Object>>) p.get("departments")) {
            boolean anyTest = Js.truthy(d.get("unlock_any_test"));
            depts.append("<tr><td>").append(esc(d.get("department_name"))).append("</td><td>").append(tpl(d.get("current_tests"))).append(Js.truthy(d.get("needed")) ? " of " + Html.text(d.get("needed")) : "")
                .append("</td><td>").append(Js.truthy(d.get("trained")) ? "Yes" + (anyTest ? ": any test of the department" : "") + (Js.truthy(d.get("unlock_can_train")) ? (anyTest ? "; " : ": ") + "may train others" : "") : "No")
                .append("</td></tr>");
        }
        StringBuilder attempts = new StringBuilder();
        for (Map<String, Object> a : (List<Map<String, Object>>) p.get("attempts")) {
            Object when = Js.truthy(a.get("decided_at")) ? a.get("decided_at") : Js.truthy(a.get("evaluated_at")) ? a.get("evaluated_at") : a.get("created_at");
            attempts.append("<tr><td>").append(esc(a.get("attempt_code"))).append("</td><td>").append(esc(a.get("kind"))).append("</td><td>").append(esc(a.get("test_name"))).append("</td><td>").append(esc(a.get("route")))
                .append("</td><td>").append(esc(or(a.get("evaluation")))).append(Js.truthy(a.get("evaluation_note")) ? "<div class=\"sub\">" + esc(a.get("evaluation_note")) + "</div>" : "")
                .append("</td>\n      <td>").append(esc(or(a.get("evaluated_by_name")))).append("</td><td>").append(esc(a.get("status"))).append(Js.truthy(a.get("decided_by_name")) ? " (" + esc(a.get("decided_by_name")) + ")" : "")
                .append("</td><td>").append(esc(d8.apply(when))).append("</td></tr>");
        }
        StringBuilder activity = new StringBuilder();
        for (Map<String, Object> x : (List<Map<String, Object>>) p.get("activity")) {
            activity.append("<tr><td>").append(esc(x.get("test_name"))).append("</td><td>").append(esc(or(x.get("department_name")))).append("</td><td>").append(tpl(x.get("runs_12m"))).append("</td><td>")
                .append(tpl(x.get("runs_total"))).append("</td><td>").append(esc(d8.apply(x.get("last_at")))).append("</td></tr>");
        }
        return "<!doctype html><html><head><meta charset=\"utf-8\"><style>\n"
            + "      body { font: 9.5pt/1.35 \"Helvetica Neue\", Arial, sans-serif; color: #1d2329; } h1 { font-size: 15pt; margin: 0; color: #1f3a2c; } h2 { font-size: 11pt; color: #1f3a2c; margin: 14px 0 4px; }\n"
            + "      .top { display: flex; justify-content: space-between; border-bottom: 2.5px solid #1f3a2c; padding-bottom: 8px; margin-bottom: 8px; } .sub { color: #5c6773; }\n"
            + "      table { width: 100%; border-collapse: collapse; } th { background: #eef2f0; text-align: left; font-size: 8pt; padding: 4px 5px; border-bottom: 1px solid #c9d3cf; }\n"
            + "      td { padding: 4px 5px; border-bottom: 1px solid #e3e8e6; vertical-align: top; } .lapsed { color: #9a2b2b; font-weight: 600; } .due { color: #8a5a00; font-weight: 600; }\n"
            + "    </style></head><body>\n"
            + "    <div class=\"top\"><div><h1>Training report: " + esc(person.get("full_name")) + "</h1><div class=\"sub\">" + (Js.truthy(person.get("title")) ? esc(person.get("title")) + " · " : "")
            + esc(lab.get("site_name")) + (!java.util.Objects.equals(lab.get("site_name"), lab.get("site_code")) ? " (" + esc(lab.get("site_code")) + ")" : "") + "</div></div>\n"
            + "      <div class=\"sub\" style=\"text-align:right\">Printed " + esc(Html.fmtDate(now, tz)) + "<br>Last competency sample: "
            + (last != null ? esc(last.get("test_name")) + ", " + esc(d8.apply(last.get("decided_at"))) + " (" + esc(last.get("attempt_code")) + ")" : "none") + "</div></div>\n"
            + "    <h2>Qualifications</h2><table><thead><tr><th>Test</th><th>Department</th><th>How</th><th>Granted</th><th>Last competency</th><th>Next due</th><th>Runs (12 months / all)</th><th>Last run</th><th>State</th></tr></thead><tbody>\n"
            + "    " + (quals.length() > 0 ? quals : "<tr><td colspan=\"9\">None</td></tr>") + "</tbody></table>\n"
            + "    <h2>Departments</h2><table><thead><tr><th>Department</th><th>Current qualifications</th><th>Department trained</th></tr></thead><tbody>\n"
            + "    " + depts + "</tbody></table>\n"
            + "    <h2>Competency (initial and continuing)</h2><table><thead><tr><th>Attempt</th><th>Kind</th><th>Test</th><th>Route</th><th>Evaluation</th><th>Evaluated by</th><th>Decision</th><th>Date</th></tr></thead><tbody>\n"
            + "    " + (attempts.length() > 0 ? attempts : "<tr><td colspan=\"8\">None</td></tr>") + "</tbody></table>\n"
            + "    <h2>Work done (the rolling counter)</h2><table><thead><tr><th>Test</th><th>Department</th><th>Runs, last 12 months</th><th>Runs, all</th><th>Last run</th></tr></thead><tbody>\n"
            + "    " + (activity.length() > 0 ? activity : "<tr><td colspan=\"5\">None</td></tr>") + "</tbody></table>\n"
            + "    <p class=\"sub\">A run is a batch in which the person signed a bench step (QC Review not counted). Qualification states follow the lab's training rules.</p></body></html>";
    }
}
