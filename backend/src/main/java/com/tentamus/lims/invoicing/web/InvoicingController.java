package com.tentamus.lims.invoicing.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.invoicing.service.InvoicingService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Billing's routes other than those that make PDFs (those are InvoiceIssueController's): same paths and answers. */
@RestController
public class InvoicingController {
    private final InvoicingService billing;

    public InvoicingController(InvoicingService billing) { this.billing = billing; }

    @GetMapping("/api/billing/ready")
    public Object ready(HttpServletRequest req) { return billing.ready(ctx(req, null)); }

    @GetMapping("/api/billing/invoices")
    public Object invoices(HttpServletRequest req, @RequestParam Map<String, String> q) { return billing.invoices(ctx(req, null), q); }

    @PostMapping("/api/billing/claim")
    public Object claim(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return billing.claim(ctx(req, b), body(b)); }

    @GetMapping("/api/billing/invoices/{id}")
    public Object invoice(HttpServletRequest req, @PathVariable String id) { return billing.invoice(ctx(req, null), id); }

    @PutMapping("/api/billing/invoices/{id}")
    public Object update(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return billing.update(ctx(req, b), id, body(b)); }

    @PostMapping("/api/billing/lines/{id}/price")
    public Object price(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return billing.linePrice(ctx(req, b), id, body(b)); }

    @PostMapping("/api/billing/lines/{id}/rush")
    public Object rush(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return billing.lineRush(ctx(req, b), id, body(b)); }

    @PostMapping("/api/billing/lines/remove")
    public Object remove(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return billing.removeLines(ctx(req, b), body(b)); }

    @PostMapping("/api/billing/invoices/{id}/release")
    public Object release(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return billing.release(ctx(req, b), id); }

    @PostMapping("/api/billing/invoices/{id}/charges")
    public Object charge(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return billing.addCharge(ctx(req, b), id, body(b)); }

    @PostMapping("/api/billing/invoices/{id}/payment")
    public Object payment(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return billing.payment(ctx(req, b), id, body(b)); }

    @GetMapping("/api/billing/corrections/{id}/pdf")
    public ResponseEntity<byte[]> correctionPdf(HttpServletRequest req, @PathVariable String id) {
        Map<String, Object> d = billing.correctionPdf(ctx(req, null), id);
        return new StoredFile(Base64.getMimeDecoder().decode((String) d.get("b64")), "application/pdf", (String) d.get("file_name")).response();
    }

    @GetMapping("/api/orders/{id}/billing")
    public Object orderBilling(HttpServletRequest req, @PathVariable String id) { return billing.orderBilling(ctx(req, null), id); }

    @GetMapping("/api/billing/settings")
    public Object settings(HttpServletRequest req) { return billing.settings(ctx(req, null)); }

    @PostMapping("/api/billing/settings/terms")
    public Object terms(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return billing.saveTerms(ctx(req, b), body(b)); }

    @PutMapping("/api/billing/settings/connection")
    public Object connection(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return billing.saveConnection(ctx(req, b), body(b)); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
