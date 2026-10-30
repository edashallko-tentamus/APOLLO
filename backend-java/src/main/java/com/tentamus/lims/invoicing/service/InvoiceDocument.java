package com.tentamus.lims.invoicing.service;

import static com.tentamus.lims.core.documents.Html.esc;
import static com.tentamus.lims.core.documents.Html.num;
import static com.tentamus.lims.core.documents.Html.text;

import com.tentamus.lims.core.browser.HeadlessBrowser;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.documents.Pdfs;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Component;

/**
 * The invoice or credit note as the client receives it (the Node backend's invoices.js), from the record: the HTML page
 * (retests and late rushes spelled out on their lines; a draft, corrected or catch-up copy marked) and its PDF.
 */
@Component
public class InvoiceDocument {
    private final HeadlessBrowser browser;

    public InvoiceDocument(HeadlessBrowser browser) { this.browser = browser; }

    /** The invoice with its lab, order and client, and its active lines. */
    public record Data(Map<String, Object> inv, List<Map<String, Object>> lines) {}

    /** A corrected copy's banner: the PO before and after, and when. */
    public record Corrected(Object oldValue, Object newValue, Object at) {}

    public static Data data(Db db, Object id) {
        Map<String, Object> inv = db.one("""
            SELECT i.*, s.site_name, s.site_code, s.address AS site_address, s.invoice_remit_to, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name,
                c.legal_name, c.billing_address, c.payment_terms_days AS client_terms, cr.invoice_number AS credits_number, cr.invoice_date AS credits_date,
                COALESCE(i.invoice_number, i.draft_code) AS code
              FROM invoice i JOIN lab_site s ON s.id = i.site_id JOIN lab_order o ON o.id = i.lab_order_id JOIN client c ON c.id = i.client_id
              LEFT JOIN invoice cr ON cr.id = i.credit_of_id WHERE i.id = ?::uuid""", id);
        if (inv == null) throw new RuleException("Invoice not found");
        return new Data(inv, db.rows("SELECT * FROM invoice_line WHERE invoice_id = ?::uuid AND status = 'Active' ORDER BY line_no", id));
    }

    /** invoices.js money: "-$1,234.50" for a negative amount. */
    static String money(Object v) {
        double n = num(Js.truthy(v) ? v : 0);
        return (n < 0 ? "-" : "") + "$" + Html.amount(Math.abs(n));
    }

    private static String dOnly(Object d) { return Html.dOnly(d, Html::text); }

    /** The made PDF and the data it shows. */
    public record Made(Pdfs.Made pdf, Data data) {}

    public Made pdf(Db db, Object id, boolean preview, Corrected corrected) {
        Data d = data(db, id);
        Map<String, Object> inv = d.inv();
        String label = "Draft".equals(inv.get("status")) ? inv.get("draft_code") + " · DRAFT, NOT ISSUED"
            : text(inv.get("invoice_number")) + (corrected != null ? " · corrected copy" : "") + (Js.truthy(inv.get("catchup")) ? " · catch-up copy from the record" : "");
        byte[] buf = browser.htmlToPdf(html(d, preview, corrected), esc(label + " · " + text(inv.get("site_name")) + " · Tentamus North America"), false);
        return new Made(Pdfs.Made.of(buf), d);
    }

    private static String lateLine(Map<String, Object> l) {
        if (!Js.truthy(l.get("rush_ordered")) || !(num(l.get("late_days")) > 0)) return "";
        String billed = Objects.equals(l.get("rush_billed"), l.get("rush_ordered")) ? ""
            : "Billed " + (Js.truthy(l.get("rush_billed")) ? "at the " + esc(l.get("rush_billed")) + " rush rate" : "without a rush fee") + ".";
        return "<div class=\"m late\">Rush ordered: " + esc(l.get("rush_ordered")) + ", due " + esc(dOnly(l.get("due_date"))) + "; reported " + esc(dOnly(l.get("completed_on")))
            + " (" + text(l.get("late_days")) + " working day" + (num(l.get("late_days")) == 1 ? "" : "s") + " late).\n       " + billed + "</div>";
    }

    private static String row(Map<String, Object> l, int sign) {
        double list = num(l.get("list_price")), price = num(l.get("price")), rush = num(l.get("rush_fee"));
        return "<tr" + (Js.truthy(l.get("retest_of_id")) ? " class=\"retest\"" : "") + ">\n"
            + "      <td>" + (Js.truthy(l.get("sample_code")) ? "<b>" + esc(l.get("sample_code")) + "</b>" : Js.truthy(l.get("order_charge_id")) ? "<span class=\"m\">Order</span>" : "")
            + (Js.truthy(l.get("client_sample_id")) ? "<div class=\"m\">" + esc(l.get("client_sample_id")) + "</div>" : "") + "</td>\n"
            + "      <td>" + (Js.truthy(l.get("retest_of_id")) ? "<span class=\"tag\">Retest</span> " : "") + esc(l.get("test_name"))
            + (Js.truthy(l.get("line_note")) ? "<div class=\"m\">" + esc(l.get("line_note")) + "</div>" : "") + lateLine(l) + "\n"
            + "        " + (Js.truthy(l.get("price_note")) ? "<div class=\"m\">" + esc(l.get("price_note")) + "</div>" : "") + "</td>\n"
            + "      <td>" + esc(dOnly(l.get("completed_on"))) + "</td>\n"
            + "      <td class=\"n\">" + money(sign * list) + "</td>\n"
            + "      <td class=\"n\">" + (list - price != 0 ? money(sign * (list - price)) : "-") + "</td>\n"
            + "      <td class=\"n\">" + money(sign * price) + "</td>\n"
            + "      <td class=\"n\">" + (rush != 0 && !Double.isNaN(rush) ? money(sign * rush) + "<div class=\"m\">" + esc(Js.orBlank(l.get("rush_billed"))) + "</div>" : "-") + "</td>\n"
            + "      <td class=\"n\"><b>" + money(l.get("amount")) + "</b></td></tr>";
    }

    public static String html(Data data, boolean preview, Corrected corrected) {
        Map<String, Object> inv = data.inv();
        List<Map<String, Object>> lines = data.lines();
        boolean credit = "Credit note".equals(inv.get("kind"));
        int sign = credit ? -1 : 1;
        boolean draft = "Draft".equals(inv.get("status"));
        Object terms = inv.get("payment_terms_days") != null ? inv.get("payment_terms_days") : inv.get("client_terms");
        StringBuilder rows = new StringBuilder();
        for (Map<String, Object> l : lines) rows.append(row(l, sign));
        Object billAddr = Js.truthy(inv.get("bill_to_address")) ? inv.get("bill_to_address") : inv.get("billing_address");
        boolean charges = lines.stream().anyMatch(l -> Js.truthy(l.get("order_charge_id"))), retests = lines.stream().anyMatch(l -> Js.truthy(l.get("retest_of_id")));
        return "<!doctype html><html><head><meta charset=\"utf-8\"><style>\n"
            + "    body { font: 10pt Helvetica, Arial, sans-serif; color: #1d2329; margin: 0; }\n"
            + "    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1f3a2c; padding-bottom: 10px; margin-bottom: 14px; }\n"
            + "    .brand { font-size: 16pt; font-weight: 700; color: #1f3a2c; } .m { color: #5c6773; font-size: 8.5pt; margin-top: 2px; }\n"
            + "    h1 { margin: 0; font-size: 20pt; color: #1f3a2c; text-align: right; letter-spacing: .5px; } .meta { text-align: right; font-size: 9pt; line-height: 1.45; }\n"
            + "    .to { display: flex; gap: 40px; margin-bottom: 14px; } .to div { min-width: 200px; } .to b { display: block; color: #5c6773; font-size: 8.5pt; }\n"
            + "    table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; } th { background: #eef3f0; text-align: left; font-size: 8.5pt; padding: 5px; border-bottom: 1px solid #c8d3cc; }\n"
            + "    td { padding: 5px; border-bottom: 1px solid #e6ebe8; vertical-align: top; font-size: 9pt; } .n { text-align: right; white-space: nowrap; }\n"
            + "    tr.retest td { background: #fbf7ec; } .tag { background: #8a5a00; color: #fff; font-size: 7pt; padding: 1px 5px; border-radius: 3px; font-weight: 700; }\n"
            + "    .late { color: #8a3b12; }\n"
            + "    .tot { margin-left: auto; width: 300px; } .tot div { display: flex; justify-content: space-between; padding: 2px 0; }\n"
            + "    .tot .big { font-size: 13pt; font-weight: 700; color: #1f3a2c; border-top: 1px solid #c8d3cc; padding-top: 6px; margin-top: 4px; }\n"
            + "    h2 { font-size: 10.5pt; color: #1f3a2c; margin: 16px 0 4px; } .terms { font-size: 8.5pt; color: #5c6773; margin-top: 18px; border-top: 1px solid #e6ebe8; padding-top: 8px; }\n"
            + "    .banner { border: 2px solid #c68a00; color: #8a5a00; padding: 6px 10px; margin-bottom: 10px; font-weight: 700; }\n"
            + "    .reason { border-left: 3px solid #1f3a2c; padding: 4px 10px; margin: 6px 0 12px; background: #f6f8f7; }\n"
            + "  </style></head><body>\n  "
            + (preview || draft ? "<div class=\"banner\">DRAFT: not issued. This is a preview for checking; the invoice number and date are given when it is issued.</div>" : "") + "\n  "
            + (corrected != null ? "<div class=\"banner\">CORRECTED COPY (" + esc(dOnly(corrected.at())) + "): the PO number has changed from " + esc(Js.truthy(corrected.oldValue()) ? corrected.oldValue() : "none")
                + " to " + esc(Js.truthy(corrected.newValue()) ? corrected.newValue() : "none") + ". Nothing else on this invoice has changed.</div>" : "") + "\n  "
            + (Js.truthy(inv.get("catchup")) ? "<div class=\"banner\">Catch-up invoice: work completed before invoicing moved into LIMS3, dated the Friday of the week its report was issued. Not sent to the client.</div>" : "") + "\n"
            + "  <div class=\"head\"><div><div class=\"brand\">" + esc(inv.get("site_name")) + "</div><div class=\"m\">Tentamus North America" + (Js.truthy(inv.get("site_address")) ? "<br>" + esc(inv.get("site_address")) : "") + "</div></div>\n"
            + "    <div><h1>" + (credit ? "Credit note" : "Invoice") + "</h1><div class=\"meta\">" + esc(draft ? text(inv.get("draft_code")) + " (draft)" : inv.get("invoice_number")) + "<br>\n"
            + "      Date: " + (Js.truthy(inv.get("invoice_date")) ? esc(dOnly(inv.get("invoice_date"))) : "when issued") + "<br>\n"
            + "      " + (credit ? "Credits invoice " + esc(Js.orBlank(inv.get("credits_number"))) + (Js.truthy(inv.get("credits_date")) ? " of " + esc(dOnly(inv.get("credits_date"))) : "")
                : "Due: " + (Js.truthy(inv.get("due_date")) ? esc(dOnly(inv.get("due_date"))) : "net " + text(terms) + " days from the invoice date")) + "</div></div></div>\n"
            + "  <div class=\"to\"><div><b>Bill to</b>" + esc(Js.truthy(inv.get("bill_to_name")) ? inv.get("bill_to_name") : inv.get("legal_name"))
            + (Js.truthy(billAddr) ? "<br><span class=\"m\">" + esc(billAddr) + "</span>" : "") + "</div>\n"
            + "    <div><b>Order</b>" + esc(inv.get("order_code")) + (Js.truthy(inv.get("po_number")) ? "<br>Your PO: " + esc(inv.get("po_number")) : "") + "</div>\n"
            + "    " + (credit ? "" : "<div><b>Terms</b>" + (num(terms) == 0 ? "Due on receipt" : "Net " + esc(terms) + " days") + "</div>") + "</div>\n"
            + "  " + (credit && Js.truthy(inv.get("reason")) ? "<div class=\"reason\"><b>Reason:</b> " + esc(inv.get("reason")) + "</div>" : "") + "\n"
            + "  <table><thead><tr><th>Sample</th><th>Test</th><th>Date</th><th class=\"n\">List price</th><th class=\"n\">Discount</th><th class=\"n\">Price</th><th class=\"n\">Rush</th><th class=\"n\">Amount</th></tr></thead>\n"
            + "    <tbody>" + rows + "</tbody></table>\n"
            + "  <div class=\"tot\">\n"
            + "    <div><span>List value</span><span>" + money(inv.get("list_total")) + "</span></div>\n"
            + "    <div><span>Discounts</span><span>" + money(-num(inv.get("discount_total"))) + "</span></div>\n"
            + "    <div><span>Rush fees</span><span>" + money(inv.get("rush_total")) + "</span></div>\n"
            + "    <div class=\"big\"><span>" + (credit ? "Total credited" : "Total due") + "</span><span>" + money(inv.get("total")) + "</span></div></div>\n"
            + "  " + (Js.truthy(inv.get("note")) ? "<h2>Note</h2><div>" + esc(inv.get("note")) + "</div>" : "") + "\n"
            + "  <div class=\"terms\">" + (credit ? "This credit note reduces the amount owed on the invoice named above." : "<b>Payment.</b> "
                + (Js.truthy(inv.get("invoice_remit_to")) ? esc(inv.get("invoice_remit_to")) : "Please quote the invoice number with your payment. Payment details are available from our accounts team."))
            + "\n    Prices are in USD per sample and test, as quoted. Work is invoiced once its report has been issued" + (charges ? "; kits, shipping and other charges when they are added" : "") + "."
            + (retests ? " Retests are listed with the test they repeat; a retest ordered by the laboratory for its own investigation is not charged." : "") + "</div>\n"
            + "  </body></html>";
    }
}
