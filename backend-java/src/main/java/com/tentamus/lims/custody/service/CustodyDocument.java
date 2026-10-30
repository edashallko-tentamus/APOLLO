package com.tentamus.lims.custody.service;

import static com.tentamus.lims.core.documents.Html.esc;
import static com.tentamus.lims.core.documents.Html.fmtDateTime;

import com.tentamus.lims.core.browser.HeadlessBrowser;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.documents.Pdfs;
import com.tentamus.lims.core.documents.QrCode;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * The chain of custody and sample manifest (custody.js): one document per lab order; the printed copy travels with the
 * samples, each receipt is signed in the LIMS (the receiver's handwritten signature in a Received block). Landscape PDF.
 */
@Component
public class CustodyDocument {
    private final HeadlessBrowser browser;

    public CustodyDocument(HeadlessBrowser browser) { this.browser = browser; }

    /** Everything the document shows, from the record as it stands (inside the caller's transaction when given one). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> data(Db db, String orderId, String verifyBase) {
        Map<String, Object> o = db.one("""
            SELECT o.*, c.client_code, COALESCE(c.display_name, c.legal_name) AS client_name, COALESCE(c.site_address, c.billing_address, '') AS client_address,
                si.site_code, si.site_name, si.address AS lab_address, si.time_zone, ct.first_name || ' ' || ct.last_name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone
              FROM lab_order o JOIN client c ON c.id = o.client_id JOIN lab_site si ON si.id = o.site_id LEFT JOIN contact ct ON ct.id = o.ordering_contact_id WHERE o.id = ?::uuid""", orderId);
        if (o == null) throw new RuleException("Order not found");
        Map<String, Object> doc = db.one("SELECT * FROM custody_document WHERE lab_order_id = ?::uuid", orderId);
        List<Map<String, Object>> samples = db.rows("""
            SELECT s.id, s.sample_code, s.client_sample_id, s.description, s.matrix, s.lot, s.metrc_id, s.number_of_units, s.quantity_received::text AS quantity, s.quantity_unit,
                s.serving_count::text AS serving_count, s.serving_count_unit, s.serving_size::text AS serving_size, s.serving_unit,
                s.preservation, s.condition, s.receipt_temperature::text AS temperature, s.received_at, s.logged_at, s.status::text AS status,
                (SELECT string_agg(t.test_name, ', ' ORDER BY t.test_name) FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled') AS tests
              FROM sample s WHERE s.lab_order_id = ?::uuid AND s.status <> 'Cancelled' ORDER BY s.created_at, s.client_sample_id""", orderId);
        List<Map<String, Object>> events = doc == null ? List.of() : db.rows("""
            SELECT e.id, e.event_no, e.kind, e.event_at, e.sample_ids, e.delivered_by, e.tracking_no, e.temperature::text AS temperature, e.temperature_unit,
                e.condition, e.seals, e.note, e.signer_title, e.created_at, u.full_name AS by_name, f.mime_type AS sig_type, encode(f.content, 'base64') AS sig_b64, se.signed_at,
                th.equipment_code AS thermometer_code, th.equipment_name AS thermometer_name
              FROM custody_event e JOIN app_user u ON u.id = e.created_by LEFT JOIN document_file f ON f.id = e.signature_image_id LEFT JOIN signature_event se ON se.id = e.signature_id
              LEFT JOIN equipment th ON th.id = e.thermometer_id
             WHERE e.custody_document_id = ?::uuid ORDER BY e.event_no""", doc.get("id"));
        List<Map<String, Object>> receipts = new ArrayList<>();
        Map<Object, Integer> receiptNo = new HashMap<>();
        for (Map<String, Object> e : events) {
            if (!"Received".equals(e.get("kind"))) continue;
            Map<String, Object> r = new LinkedHashMap<>(e);
            int n = receipts.size() + 1;
            if (e.get("sample_ids") instanceof List<?> ids) for (Object sid : ids) receiptNo.put(String.valueOf(sid), n);
            r.put("n", n);
            r.put("signature", Js.truthy(e.get("sig_b64")) ? "data:" + e.get("sig_type") + ";base64," + e.get("sig_b64") : null);
            receipts.add(r);
        }
        List<Map<String, Object>> ss = new ArrayList<>();
        for (Map<String, Object> s : samples) {
            Map<String, Object> x = new LinkedHashMap<>(s);
            x.put("receipt", receiptNo.get(String.valueOf(s.get("id"))));
            ss.add(x);
        }
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("coc_code", doc != null ? doc.get("coc_code") : "COC-" + o.get("order_code"));
        d.put("made_at", doc != null ? doc.get("created_at") : null);
        d.put("made_at_migration", doc != null ? doc.get("made_at_migration") : false);
        d.put("time_zone", o.get("time_zone"));
        d.put("lab", Map.of("code", o.get("site_code"), "name", o.get("site_name"), "address", Js.orBlank(o.get("lab_address"))));
        d.put("client", Map.of("code", Html.text(o.get("client_code")), "name", Html.text(o.get("client_name")), "address", Html.text(o.get("client_address")),
            "contact", Js.orBlank(o.get("contact_name")), "email", Js.orBlank(o.get("contact_email")), "phone", Js.orBlank(o.get("contact_phone"))));
        Map<String, Object> order = new LinkedHashMap<>();
        order.put("id", o.get("id"));
        order.put("code", o.get("order_code"));
        order.put("po", Js.orBlank(o.get("po_number")));
        order.put("channel", o.get("submission_channel"));
        order.put("submitted_at", o.get("submitted_at"));
        order.put("notes", Js.orBlank(o.get("notes")));
        d.put("order", order);
        d.put("samples", ss);
        d.put("receipts", receipts);
        d.put("qr", QrCode.svg(verifyBase + "/#/orders/" + o.get("id"), 2, "Order link"));
        return d;
    }

    public Pdfs.Made pdf(Map<String, Object> d) {
        Map<?, ?> lab = (Map<?, ?>) d.get("lab"), order = (Map<?, ?>) d.get("order");
        return Pdfs.Made.of(browser.htmlToPdf(html(d), esc(d.get("coc_code") + " · Order " + Html.text(order.get("code")) + " · " + Html.text(lab.get("code"))), true));
    }

    /** String(Number(v)), or "" for nothing. */
    private static String num(Object v) { return v == null || "".equals(v) ? "" : Js.number(Js.toNumber(v)); }

    private static String or(Object v) { return Js.truthy(v) ? Html.text(v) : ""; }

    @SuppressWarnings("unchecked")
    static String html(Map<String, Object> d) {
        String tz = (String) d.get("time_zone");
        Map<String, Object> lab = (Map<String, Object>) d.get("lab"), client = (Map<String, Object>) d.get("client"), order = (Map<String, Object>) d.get("order");
        List<Map<String, Object>> samples = (List<Map<String, Object>>) d.get("samples"), receipts = (List<Map<String, Object>>) d.get("receipts");
        StringBuilder rows = new StringBuilder();
        for (int i = 0; i < samples.size(); i++) {
            Map<String, Object> s = samples.get(i);
            // the serving size the client shared (0.34.0)
            String serving = Js.truthy(s.get("serving_size"))
                ? ("Serving " + (Js.truthy(s.get("serving_count")) ? num(s.get("serving_count")) + " " + or(s.get("serving_count_unit")) + " = " : "") + num(s.get("serving_size")) + " " + or(s.get("serving_unit")))
                    .replaceAll("\\s+", " ").trim() : "";
            rows.append("<tr><td class=\"r\">").append(i + 1).append("</td><td>").append(esc(or(s.get("client_sample_id"))))
                .append(Js.truthy(s.get("description")) ? "<div class=\"sub\">" + esc(s.get("description")) + "</div>" : "")
                .append(serving.isEmpty() ? "" : "<div class=\"sub\">" + esc(serving) + "</div>").append("</td>\n    <td>").append(esc(or(s.get("matrix"))))
                .append(Js.truthy(s.get("lot")) ? "<div class=\"sub\">Lot " + esc(s.get("lot")) + "</div>" : "")
                .append(Js.truthy(s.get("metrc_id")) ? "<div class=\"sub\">METRC " + esc(s.get("metrc_id")) + "</div>" : "")
                .append("</td><td class=\"r\">").append(esc(s.get("number_of_units"))).append("</td>\n    <td>")
                .append(Js.truthy(s.get("quantity")) ? esc(num(s.get("quantity")) + " " + or(s.get("quantity_unit"))) : "").append("</td><td>").append(esc(or(s.get("preservation"))))
                .append("</td><td class=\"t\">").append(esc(or(s.get("tests")))).append("</td>\n    <td><b>").append(esc(or(s.get("sample_code")))).append("</b>")
                .append(s.get("receipt") != null ? "<div class=\"sub\">Receipt " + s.get("receipt") + "</div>" : Js.truthy(s.get("logged_at")) ? "<div class=\"sub\">Logged, no signed receipt</div>" : "")
                .append("</td>\n    <td>").append(esc(or(s.get("condition")))).append(Js.truthy(s.get("temperature")) ? "<div class=\"sub\">" + esc(num(s.get("temperature"))) + " °C</div>" : "")
                .append("</td></tr>");
        }
        StringBuilder received = new StringBuilder();
        for (Map<String, Object> e : receipts) {
            int k = e.get("sample_ids") instanceof List<?> l ? l.size() : 0;
            received.append("<div class=\"box rcv\"><div class=\"bl\">Received by the laboratory: receipt ").append(e.get("n")).append(" (").append(k).append(" sample").append(k == 1 ? "" : "s").append(")</div>\n")
                .append("      <div class=\"sig\">").append(e.get("signature") != null ? "<img src=\"" + e.get("signature") + "\" alt=\"Signature of " + esc(e.get("by_name")) + "\">" : "").append("</div>\n")
                .append("      <div class=\"line filled\"><b>").append(esc(e.get("by_name"))).append("</b>").append(Js.truthy(e.get("signer_title")) ? ", " + esc(e.get("signer_title")) : "")
                .append("<span>Signed electronically ").append(esc(fmtDateTime(Js.truthy(e.get("signed_at")) ? e.get("signed_at") : e.get("created_at"), tz))).append("</span></div>\n")
                .append("      <div class=\"kv2\"><div><span>Received</span>").append(esc(fmtDateTime(e.get("event_at"), tz))).append("</div><div><span>Delivered by</span>")
                .append(esc(or(e.get("delivered_by")))).append(Js.truthy(e.get("tracking_no")) ? " (" + esc(e.get("tracking_no")) + ")" : "").append("</div>\n")
                .append("      <div><span>Temperature</span>").append(Js.truthy(e.get("temperature")) ? esc(num(e.get("temperature")) + " " + Html.text(e.get("temperature_unit"))) : "")
                .append(Js.truthy(e.get("thermometer_code")) ? "<div class=\"sub\">Thermometer " + esc(e.get("thermometer_code")) + " " + esc(or(e.get("thermometer_name"))) + "</div>" : "")
                .append("</div><div><span>Condition</span>").append(esc(or(e.get("condition")))).append("</div><div><span>Custody seals</span>").append(esc(or(e.get("seals")))).append("</div></div>\n")
                .append("      ").append(Js.truthy(e.get("note")) ? "<div class=\"sub\">" + esc(e.get("note")) + "</div>" : "").append("</div>");
        }
        long containers = 0;
        for (Map<String, Object> s : samples) { double n = Js.toNumber(s.get("number_of_units")); if (!Double.isNaN(n)) containers += (long) n; }
        return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + esc(d.get("coc_code")) + "</title><style>\n"
            + "    body { font: 9pt/1.3 \"Helvetica Neue\", Arial, sans-serif; color: #1d2329; margin: 0; }\n"
            + "    .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #1f3a2c; padding-bottom: 8px; }\n"
            + "    .lab { font-size: 14pt; font-weight: 700; color: #1f3a2c; } .addr { color: #5c6773; white-space: pre-line; }\n"
            + "    .title { text-align: right; display: flex; gap: 10px; align-items: flex-start; } .title .t { font-size: 13pt; font-weight: 700; } .title .v { color: #5c6773; margin-top: 2px; }\n"
            + "    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 10px 0; }\n"
            + "    h4 { margin: 0 0 3px; font-size: 8pt; text-transform: uppercase; letter-spacing: .5px; color: #5c6773; }\n"
            + "    table.kv td { padding: 1px 8px 1px 0; vertical-align: top; } table.kv td:first-child { color: #5c6773; font-weight: 600; width: 34%; }\n"
            + "    table.m { width: 100%; border-collapse: collapse; } table.m th { background: #eef2f0; text-align: left; font-size: 7.5pt; padding: 4px 5px; border: 1px solid #c9d3cf; }\n"
            + "    table.m td { border: 1px solid #d9e0dd; padding: 4px 5px; vertical-align: top; } .r { text-align: right; } td.t { font-size: 8pt; }\n"
            + "    .sub { font-size: 7.5pt; color: #5c6773; }\n"
            + "    .boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; break-inside: avoid; }\n"
            + "    .box { border: 1px solid #9fb0a8; border-radius: 3px; padding: 6px 8px; break-inside: avoid; } .bl { font-weight: 700; color: #1f3a2c; margin-bottom: 4px; }\n"
            + "    .line { border-bottom: 1px solid #1d2329; height: 26px; position: relative; margin-top: 4px; } .line span { position: absolute; bottom: -12px; left: 0; font-size: 7pt; color: #5c6773; }\n"
            + "    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }\n"
            + "    .line.filled { height: auto; padding-bottom: 2px; margin-bottom: 4px; } .line.filled span { position: static; display: block; font-size: 7pt; color: #5c6773; }\n"
            + "    .rcv .sig img { height: 42px; max-width: 220px; object-fit: contain; display: block; }\n"
            + "    .kv2 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px 8px; margin-top: 4px; } .kv2 span { display: block; font-size: 7pt; color: #5c6773; }\n"
            + "    .rule { margin-top: 10px; font-size: 7.5pt; color: #333; }\n"
            + "  </style></head><body>\n"
            + "  <div class=\"top\"><div><div class=\"lab\">" + esc(lab.get("name")) + "</div><div class=\"addr\">" + esc(lab.get("address")) + "</div></div>\n"
            + "    <div class=\"title\"><div><div class=\"t\">CHAIN OF CUSTODY AND SAMPLE MANIFEST</div><div class=\"v\">" + esc(d.get("coc_code")) + " · Order " + esc(order.get("code")) + "</div>\n"
            + "      <div class=\"v\">" + (Js.truthy(order.get("submitted_at")) ? "Submitted " + esc(fmtDateTime(order.get("submitted_at"), tz)) : "") + "</div></div>" + d.get("qr") + "</div></div>\n"
            + "  <div class=\"grid\"><div><h4>Client</h4><table class=\"kv\"><tr><td>Client</td><td>" + esc(client.get("name")) + " (" + esc(client.get("code")) + ")</td></tr><tr><td>Address</td><td>"
            + esc(client.get("address")) + "</td></tr>\n"
            + "      <tr><td>Contact</td><td>" + esc(client.get("contact")) + (Js.truthy(client.get("phone")) ? ", " + esc(client.get("phone")) : "")
            + (Js.truthy(client.get("email")) ? "<br>" + esc(client.get("email")) : "") + "</td></tr></table></div>\n"
            + "    <div><h4>Order</h4><table class=\"kv\"><tr><td>Order</td><td>" + esc(order.get("code")) + "</td></tr><tr><td>PO</td><td>" + esc(order.get("po"))
            + "</td></tr><tr><td>Submitted by</td><td>" + esc(or(order.get("channel"))) + "</td></tr>\n"
            + "      <tr><td>Samples</td><td>" + samples.size() + ", " + (containers != 0 ? Long.toString(containers) : "?") + " container(s)</td></tr>"
            + (Js.truthy(order.get("notes")) ? "<tr><td>Notes</td><td>" + esc(order.get("notes")) + "</td></tr>" : "") + "</table></div></div>\n"
            + "  <table class=\"m\"><thead><tr><th>#</th><th>Client sample ID</th><th>Matrix</th><th>Containers</th><th>Quantity</th><th>Preservation</th><th>Tests requested</th><th>Lab sample ID</th><th>Condition on receipt</th></tr></thead>\n"
            + "    <tbody>" + (rows.length() > 0 ? rows : "<tr><td colspan=\"9\">No samples yet</td></tr>") + "</tbody></table>\n"
            + "  <div class=\"boxes\">" + blank("Relinquished by (client)") + blank("Received by (courier), if shipped") + blank("Relinquished by (courier)")
            + (received.length() > 0 ? received : "<div class=\"box\"><div class=\"bl\">Received by the laboratory</div><div class=\"sub\">Signed in the LIMS when the samples are received.</div></div>") + "</div>\n"
            + "  <div class=\"rule\">Each person who relinquishes or receives the samples signs this form. The laboratory's receipt is signed electronically; the signed copy is kept with the order in the LIMS."
            + (Boolean.TRUE.equals(d.get("made_at_migration")) ? " This chain of custody was made when the LIMS started keeping them (the order was submitted before)." : "") + "</div>\n"
            + "  </body></html>";
    }

    private static String blank(String label) {
        return "<div class=\"box\"><div class=\"bl\">" + label + "</div><div class=\"line\"><span>Signature</span></div><div class=\"pair\"><div class=\"line\"><span>Printed name</span></div><div class=\"line\"><span>Date and time</span></div></div></div>";
    }
}
