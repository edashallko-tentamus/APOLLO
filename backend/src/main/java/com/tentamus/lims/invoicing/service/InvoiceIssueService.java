package com.tentamus.lims.invoicing.service;

import static com.tentamus.lims.core.web.Answers.map;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.documents.Pdfs;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.Answers;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Issuing invoices and credit notes and correcting an issued invoice's PO: each signed, its PDF made inside the same
 * transaction, attached and emailed (issue_invoices, credit_invoice, correct_invoice_po, record_invoice_document,
 * record_invoice_correction_document, send_invoice stay in the database); and an invoice's PDF.
 */
@Service
public class InvoiceIssueService {
    private final Db db;
    private final SignatureService signatures;
    private final InvoicingService billing;
    private final InvoiceDocument document;

    public InvoiceIssueService(Db db, SignatureService signatures, InvoicingService billing, InvoiceDocument document) {
        this.db = db;
        this.signatures = signatures;
        this.billing = billing;
        this.document = document;
    }

    /** A PDF to send: its bytes and file name. */
    public record File(byte[] buf, String name) {}

    /** The PDF for an issued invoice, made inside the issuing transaction, attached and sent. */
    private Map<String, Object> attachAndSend(Db d, Object id) {
        InvoiceDocument.Made p = document.pdf(d, id, false, null);
        Object number = p.data().inv().get("invoice_number");
        String doc = Pdfs.store(d, Html.text(number) + ".pdf", p.pdf());
        d.raw("SELECT record_invoice_document(?::uuid, ?::uuid, ?)", id, doc, p.pdf().sha256());
        Object n = d.one("SELECT send_invoice(?::uuid) AS n", id).get("n");
        return map("id", id, "invoice_number", number, "emails", Html.jsNumber(Js.toNumber(n)));
    }

    /** Issue checked drafts: one signature ("Invoiced by"); each PDF made, attached, emailed and queued. */
    public Map<String, Object> issue(RequestContext ctx, Map<String, Object> body) {
        List<Object> ids = Answers.uuids(body.get("ids"));
        if (ids.isEmpty()) throw new RuleException("Choose the draft invoices to issue");
        for (Object id : ids) billing.invoiceOf(ctx, id);
        Object sent = signatures.signed(ctx.orReason("Invoice issued"), body,
            new Meaning("Invoiced by", "Issued " + ids.size() + " invoice" + (ids.size() > 1 ? "s" : ""), "Invoicing"), d -> {
                d.raw("SELECT issue_invoices(?::uuid[])", ids);
                List<Object> out = new ArrayList<>();
                for (Object id : ids) out.add(attachAndSend(d, id));
                return out;
            });
        return map("issued", sent);
    }

    /** Credit an issued invoice (all its lines or some); the work invoiced again or not. */
    public Map<String, Object> credit(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> i = billing.invoiceOf(ctx, id);
        List<Object> lines = body.get("lines") instanceof List<?> l && !l.isEmpty() ? Answers.uuids(l) : null;
        String why = Js.truthy(body.get("credit_reason")) ? Js.string(body.get("credit_reason")).trim() : "";
        Object out = signatures.signed(ctx.orReason("Credit note issued"), body, new Meaning("Credited by", "Credit note for " + Html.text(i.get("invoice_number")), "Invoicing"), d -> {
            Object cn = d.one("SELECT credit_invoice(?::uuid, ?::uuid[], ?, ?) AS id", i.get("id"), lines, Js.truthy(body.get("rebill")), why).get("id");
            return attachAndSend(d, cn);
        });
        return map("credit_note", out);
    }

    /** Correct the PO number of an issued invoice (signed "Corrected by", with a reason): the corrected copy made and emailed. */
    public Map<String, Object> correctPo(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> i = billing.invoiceOf(ctx, id);
        if (ctx.reason().isEmpty()) throw new RuleException("Say why the PO number is corrected");
        String po = Js.truthy(body.get("po_number")) ? Js.string(body.get("po_number")).trim() : "";
        return signatures.signed(ctx, body, new Meaning("Corrected by", "PO number of " + Html.text(i.get("invoice_number")) + " corrected", "Invoicing"), d -> {
            Object k = d.one("SELECT correct_invoice_po(?::uuid, ?) AS id", i.get("id"), po).get("id");
            Map<String, Object> row = d.one("SELECT * FROM invoice_correction WHERE id = ?::uuid", k);
            InvoiceDocument.Made p = document.pdf(d, i.get("id"), false, new InvoiceDocument.Corrected(row.get("old_value"), row.get("new_value"), row.get("created_at")));
            String doc = Pdfs.store(d, Html.text(i.get("invoice_number")) + " corrected " + Html.text(row.get("correction_no")) + ".pdf", p.pdf());
            Object n = d.one("SELECT record_invoice_correction_document(?::uuid, ?::uuid, ?) AS n", k, doc, p.pdf().sha256()).get("n");
            return map("correction_id", k, "emails", Html.jsNumber(Js.toNumber(n)));
        });
    }

    /** The PDF: as issued (stored), or for a draft or a catch-up invoice made from the record. */
    public File pdf(RequestContext ctx, String id) {
        Map<String, Object> i = billing.invoiceOf(ctx, id);
        if (i.get("document_id") != null) {
            Map<String, Object> d = db.one("SELECT encode(content, 'base64') AS b64 FROM document_file WHERE id = ?::uuid", i.get("document_id"));
            return new File(Base64.getMimeDecoder().decode((String) d.get("b64")), i.get("code") + ".pdf");
        }
        boolean draft = "Draft".equals(i.get("status"));
        return new File(document.pdf(db, i.get("id"), draft, null).pdf().buf(), i.get("code") + (draft ? " draft" : "") + ".pdf");
    }
}
