package com.tentamus.lims.quotes.service;

import static com.tentamus.lims.core.documents.Html.esc;
import static com.tentamus.lims.core.documents.Html.money;
import static com.tentamus.lims.core.documents.Html.num;
import static com.tentamus.lims.core.documents.Html.text;
import static com.tentamus.lims.core.web.Answers.map;

import com.tentamus.lims.core.browser.HeadlessBrowser;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.documents.Pdfs;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.stability.service.StabilityData;
import com.tentamus.lims.stability.service.StabilityDocuments;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Component;

/**
 * The quotation as the client receives it (the Node backend's quotes.js): the data from the record, the HTML page and its
 * PDF (headless Chromium). A stability quote's page is the stability quotation (study matrix, dates, price by year).
 */
@Component
public class QuoteDocument {
    private final HeadlessBrowser browser;

    public QuoteDocument(HeadlessBrowser browser) { this.browser = browser; }

    /** Everything the quotation shows: v (the version with its project, client and people), lines, rush, packages, charges. */
    public static Map<String, Object> data(Db db, Object vid) {
        Map<String, Object> v = db.one("""
            SELECT pv.*, p.project_code, p.project_name, p.purpose, p.kind, p.client_id, p.is_list_price_acceptance,
                COALESCE(cl.display_name, cl.legal_name) AS client_name, cl.legal_name AS client_legal_name, cl.billing_address,
                ou.full_name AS owner_name, qu.full_name AS quoted_by_name,
                NULLIF(btrim(COALESCE(qc.first_name, '') || ' ' || COALESCE(qc.last_name, '')), '') AS quote_contact_name, qc.email AS quote_contact_email,
                NULLIF(btrim(COALESCE(sc.first_name, '') || ' ' || COALESCE(sc.last_name, '')), '') AS sent_to_name
              FROM project_version pv JOIN project p ON p.id = pv.project_id JOIN client cl ON cl.id = p.client_id
              LEFT JOIN app_user ou ON ou.id = COALESCE(p.owner_id, p.created_by) LEFT JOIN app_user qu ON qu.id = pv.quoted_by
              LEFT JOIN contact qc ON qc.id = p.quote_contact_id LEFT JOIN contact sc ON sc.id = pv.sent_to_contact_id WHERE pv.id = ?::uuid""", vid);
        if (v == null) throw new RuleException("Quote version not found");
        // a subcontracted test is shown as such (ISO 17025: the client is told which work is subcontracted)
        List<Map<String, Object>> lines = db.rows("""
            SELECT r.*, COALESCE(s.site_code, '') AS site_code,
                COALESCE(s.site_name, 'Our laboratory') || CASE WHEN q.is_subcontracted THEN ' (subcontracted within Tentamus)' ELSE '' END AS site_name
              FROM quote_line_review r JOIN test t ON t.test_code = r.test_code JOIN quoted_test_configuration q ON q.id = r.line_id LEFT JOIN lab_site s ON s.id = t.site_id
             WHERE r.project_version_id = ?::uuid AND q.quoted_package_id IS NULL ORDER BY q.is_subcontracted, s.site_code NULLS LAST, r.test_name""", vid);
        List<Map<String, Object>> rush = db.rows("SELECT * FROM quote_rush_term WHERE project_version_id = ?::uuid ORDER BY schedule_name, rush_tat", vid);
        List<Map<String, Object>> packages = db.rows("""
            SELECT qp.*, (SELECT string_agg(t.test_name, ', ' ORDER BY q.created_at) FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
                WHERE q.quoted_package_id = qp.id AND q.status = 'Active') AS tests FROM quoted_package qp WHERE qp.project_version_id = ?::uuid AND qp.status = 'Active' ORDER BY qp.created_at""", vid);
        List<Map<String, Object>> charges = db.rows("""
            SELECT qc.quantity, qc.list_price, qc.unit_price, qc.note, ci.charge_name, ci.kind, charge_sign(ci.kind) AS sign
              FROM quoted_charge qc JOIN charge_item ci ON ci.id = qc.charge_item_id WHERE qc.project_version_id = ?::uuid AND qc.status = 'Active' ORDER BY ci.kind = 'Discount', ci.charge_name""", vid);
        return map("v", v, "lines", lines, "rush", rush, "packages", packages, "charges", charges);
    }

    /** The quote's PDF and the data it was made from. */
    public record Made(Pdfs.Made pdf, Map<String, Object> data) {}

    @SuppressWarnings("unchecked")
    public Made pdf(Db db, Object vid, boolean preview) {
        Map<String, Object> d = data(db, vid);
        Map<String, Object> v = (Map<String, Object>) d.get("v");
        String tail = preview ? " · PREVIEW, NOT ISSUED" : "";
        if ("Stability".equals(v.get("kind"))) {
            String html = StabilityDocuments.quoteHtml(v, StabilityData.design(db, vid), preview);
            return new Made(Pdfs.Made.of(browser.htmlToPdf(html, esc(v.get("project_code") + " v" + text(v.get("version_no")) + " · stability study · Tentamus North America" + tail), false)), d);
        }
        return new Made(Pdfs.Made.of(browser.htmlToPdf(html(d, preview), esc(v.get("project_code") + " v" + text(v.get("version_no")) + " · Tentamus North America" + tail), false)), d);
    }

    /** quotes.js dOnly: the date part, else the date in Los Angeles. */
    public static String dOnly(Object d) { return Html.dOnly(d, x -> Html.fmtDate(x, null)); }

    private static String days(Object n, Object unit) {
        return text(n) + " " + ("Business Days".equals(unit) ? "business" : "calendar") + " day" + (num(n) == 1 ? "" : "s");
    }

    /** Number(x).toFixed(n) (exact binary value, half up). */
    private static String toFixed(double v, int n) { return new BigDecimal(v).setScale(n, RoundingMode.HALF_UP).toPlainString(); }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Object o) { return o instanceof List<?> l ? (List<Map<String, Object>>) l : List.of(); }

    private static String row(Map<String, Object> l) {
        return "<tr><td><b>" + esc(l.get("test_name")) + "</b>" + ("Analyte Selection".equals(l.get("pricing_mode")) ? "<div class=\"m\">" + text(l.get("analytes_included")) + " of " + text(l.get("analytes_total")) + " analytes</div>" : "")
            + (Js.truthy(l.get("special_instructions")) ? "<div class=\"m\">" + esc(l.get("special_instructions")) + "</div>" : "") + "</td>\n"
            + "    <td class=\"n\">" + text(l.get("quantity")) + "</td><td class=\"n\">" + money(l.get("list_price")) + "</td><td class=\"n\">" + money(l.get("final_price")) + "</td>\n"
            + "    <td class=\"n\">" + (l.get("final_price") == null ? "" : Js.truthy(num(l.get("discount_pct"))) ? toFixed(num(l.get("discount_pct")), 1) + "%" : "-") + "</td><td class=\"n\">" + money(l.get("line_total")) + "</td>\n"
            + "    <td>" + esc(days(l.get("standard_tat"), l.get("tat_unit"))) + "</td></tr>";
    }

    /** The standard quotation page. */
    @SuppressWarnings("unchecked")
    public static String html(Map<String, Object> d, boolean preview) {
        Map<String, Object> v = (Map<String, Object>) d.get("v");
        List<Map<String, Object>> lines = list(d.get("lines")), rush = list(d.get("rush")), packages = list(d.get("packages")), charges = list(d.get("charges"));
        double total = 0, listTotal = 0;
        for (Map<String, Object> l : lines) { total += num(l.get("line_total")); listTotal += num(l.get("list_price")) * num(l.get("quantity")); }
        for (Map<String, Object> p : packages) { total += num(p.get("package_price")) * num(p.get("quantity")); listTotal += num(p.get("list_price")) * num(p.get("quantity")); }
        StringBuilder pkgRows = new StringBuilder();
        for (Map<String, Object> p : packages) {
            double lp = num(p.get("list_price")), pp = num(p.get("package_price"));
            pkgRows.append("<tr class=\"pkg\"><td><b>").append(esc(p.get("package_name"))).append("</b> <span class=\"m\">(").append(esc(p.get("package_code"))).append(", package)</span><div class=\"m\">Includes: ")
                .append(esc(Js.orBlank(p.get("tests")))).append("</div></td>\n    <td class=\"n\">").append(text(p.get("quantity"))).append("</td><td class=\"n\">").append(money(p.get("list_price")))
                .append("</td><td class=\"n\">").append(money(p.get("package_price"))).append("</td>\n    <td class=\"n\">").append(lp > 0 && pp < lp ? toFixed((1 - pp / lp) * 100, 1) + "%" : "-")
                .append("</td><td class=\"n\">").append(money(pp * num(p.get("quantity")))).append("</td><td></td></tr>");
        }
        List<String> labs = new ArrayList<>(new LinkedHashSet<>(lines.stream().map(l -> text(l.get("site_name"))).toList()));
        boolean byLab = labs.size() > 1;
        boolean scheds = !rush.isEmpty();
        StringBuilder body = new StringBuilder();
        if (byLab) {
            for (String lab : labs) {
                List<Map<String, Object>> ls = lines.stream().filter(l -> Objects.equals(text(l.get("site_name")), lab)).toList();
                double sub = 0;
                for (Map<String, Object> l : ls) sub += num(l.get("line_total"));
                body.append("<tr class=\"lab\"><td colspan=\"7\">").append(esc(lab)).append("</td></tr>");
                for (Map<String, Object> l : ls) body.append(row(l));
                body.append("<tr class=\"sub\"><td colspan=\"5\" class=\"n\">Subtotal, ").append(esc(lab)).append("</td><td class=\"n\">").append(money(sub)).append("</td><td></td></tr>");
            }
        } else for (Map<String, Object> l : lines) body.append(row(l));
        StringBuilder ch = new StringBuilder();
        if (!charges.isEmpty()) {
            ch.append("<h2>Other charges</h2><table><thead><tr><th>Charge</th><th class=\"n\">Qty</th><th class=\"n\">List price</th><th class=\"n\">Your price</th><th class=\"n\">Total</th></tr></thead><tbody>\n    ");
            for (Map<String, Object> x : charges) {
                double s = num(x.get("sign"));
                ch.append("<tr><td><b>").append(esc(x.get("charge_name"))).append("</b> <span class=\"m\">(").append(esc(x.get("kind"))).append(")</span>")
                    .append(Js.truthy(x.get("note")) ? "<div class=\"m\">" + esc(x.get("note")) + "</div>" : "").append("</td><td class=\"n\">").append(text(x.get("quantity"))).append("</td>\n      <td class=\"n\">")
                    .append(money(s * num(x.get("list_price")))).append("</td><td class=\"n\">").append(money(s * num(x.get("unit_price")))).append("</td><td class=\"n\">")
                    .append(money(s * num(x.get("unit_price")) * num(x.get("quantity")))).append("</td></tr>");
            }
            ch.append("</tbody></table>\n    <p class=\"m\">Charges are invoiced when they are added to an order (for example, shipping when a kit is sent); a discount is taken off the invoice it is added to.</p>");
        }
        StringBuilder rs = new StringBuilder();
        if (scheds) {
            rs.append("<h2>Rush options</h2><table><thead><tr><th>Schedule</th><th>Tier</th><th>Turnaround</th><th class=\"n\">Surcharge</th><th class=\"n\">Your rush discount</th></tr></thead><tbody>\n    ");
            for (Map<String, Object> r : rush)
                rs.append("<tr><td>").append(esc(r.get("schedule_name"))).append("</td><td>").append(esc(r.get("tier_name"))).append("</td><td>").append(esc(days(r.get("rush_tat"), r.get("tat_unit"))))
                    .append("</td>\n      <td class=\"n\">").append("Flat".equals(r.get("surcharge_type")) ? money(r.get("surcharge_value")) : Js.number(num(r.get("surcharge_value"))) + "% of price")
                    .append("</td><td class=\"n\">").append(Js.truthy(num(r.get("discount_pct"))) ? Js.number(num(r.get("discount_pct"))) + "%" : "-").append("</td></tr>");
            rs.append("</tbody></table>");
        }
        String to = "Project".equals(v.get("kind")) ? "<div><b>Project</b>" + esc(v.get("project_name")) + (Js.truthy(v.get("purpose")) ? "<br><span class=\"m\">" + esc(v.get("purpose")) + "</span>" : "") + "</div>"
            : Js.truthy(v.get("project_name")) ? "<div><b>Reference</b>" + esc(v.get("project_name")) + "</div>" : "";
        return "<!doctype html><html><head><meta charset=\"utf-8\"><style>\n"
            + "    body { font: 10pt Helvetica, Arial, sans-serif; color: #1d2329; margin: 0; }\n"
            + "    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1f3a2c; padding-bottom: 10px; margin-bottom: 14px; }\n"
            + "    .brand { font-size: 17pt; font-weight: 700; color: #1f3a2c; } .m { color: #5c6773; font-size: 8.5pt; }\n"
            + "    h1 { margin: 0; font-size: 18pt; color: #1f3a2c; text-align: right; } .meta { text-align: right; font-size: 9pt; }\n"
            + "    .to { display: flex; gap: 40px; margin-bottom: 14px; } .to div { min-width: 200px; } .to b { display: block; color: #5c6773; font-size: 8.5pt; text-transform: uppercase; }\n"
            + "    table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; } th { background: #eef3f0; text-align: left; font-size: 8.5pt; padding: 5px; border-bottom: 1px solid #c8d3cc; }\n"
            + "    td { padding: 5px; border-bottom: 1px solid #e6ebe8; vertical-align: top; font-size: 9pt; } .n { text-align: right; white-space: nowrap; }\n"
            + "    tr.lab td { background: #f6f8f7; font-weight: 700; color: #1f3a2c; } tr.sub td { font-weight: 700; border-bottom: 1px solid #c8d3cc; }\n"
            + "    .tot { display: flex; justify-content: flex-end; gap: 24px; font-size: 10pt; } .tot .big { font-size: 13pt; font-weight: 700; color: #1f3a2c; }\n"
            + "    h2 { font-size: 11pt; color: #1f3a2c; margin: 16px 0 4px; } .terms { font-size: 8.5pt; color: #5c6773; margin-top: 18px; border-top: 1px solid #e6ebe8; padding-top: 8px; }\n"
            + "    .draft { border: 2px solid #c68a00; color: #8a5a00; padding: 6px 10px; margin-bottom: 10px; font-weight: 700; }\n"
            + "  </style></head><body>\n  "
            + (preview ? "<div class=\"draft\">PREVIEW: not issued. Prices are final only when the quotation is issued.</div>" : "")
            + "\n  <div class=\"head\"><div><div class=\"brand\">Tentamus North America</div><div class=\"m\">Laboratory testing services" + (labs.isEmpty() ? "" : " · " + esc(String.join(" · ", labs))) + "</div></div>\n"
            + "    <div><h1>Quotation</h1><div class=\"meta\">" + esc(v.get("project_code")) + " · version " + text(v.get("version_no")) + "<br>Issued: "
            + (Js.truthy(v.get("quoted_at")) ? esc(Html.fmtDate(v.get("quoted_at"), null)) : "not yet issued") + "<br>Valid until: " + (Js.truthy(v.get("valid_until")) ? esc(dOnly(v.get("valid_until"))) : "no expiry date") + "</div></div></div>\n"
            + "  <div class=\"to\"><div><b>Prepared for</b>" + esc(v.get("client_legal_name")) + (Js.truthy(v.get("quote_contact_name")) ? "<br>Attn: " + esc(v.get("quote_contact_name")) : "")
            + (Js.truthy(v.get("billing_address")) ? "<br><span class=\"m\">" + esc(v.get("billing_address")) + "</span>" : "") + "</div>\n"
            + "    <div><b>Prepared by</b>" + esc(Js.orBlank(v.get("owner_name"))) + "</div>\n    " + to + "</div>\n"
            + "  <table><thead><tr><th>Test</th><th class=\"n\">Qty</th><th class=\"n\">List price</th><th class=\"n\">Your price</th><th class=\"n\">Discount</th><th class=\"n\">Line total</th><th>Standard turnaround</th></tr></thead>\n"
            + "    <tbody>" + pkgRows + body + "</tbody></table>\n"
            + "  <div class=\"tot\"><span>List value " + money(listTotal) + "</span><span>You save " + money(listTotal - total) + "</span><span class=\"big\">Total " + money(total) + "</span></div>\n  "
            + ch + "\n  " + rs + "\n  " + (Js.truthy(v.get("notes")) ? "<h2>Notes</h2><div>" + esc(v.get("notes")) + "</div>" : "")
            + "\n  <div class=\"terms\"><b>Terms.</b> Prices are per sample in USD. Testing is performed against an accepted quotation at the prices shown; each test is performed at the laboratory named. Standard turnaround is the maximum, counted from the day samples are logged (Day 0); samples received after a test's cutoff time start the next working day.</div>\n"
            + "  </body></html>";
    }
}
