package com.tentamus.lims.invoicing.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.invoicing.service.InvoiceIssueService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Billing's document routes (issue, credit note, PO correction, an invoice's PDF): same paths and answers as the Node backend. */
@RestController
public class InvoiceIssueController {
    private final InvoiceIssueService issue;

    public InvoiceIssueController(InvoiceIssueService issue) { this.issue = issue; }

    @PostMapping("/api/billing/issue")
    public Object issue(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return issue.issue(RequestContext.of(req, body(b)), body(b)); }

    @PostMapping("/api/billing/invoices/{id}/credit")
    public Object credit(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return issue.credit(RequestContext.of(req, body(b)), id, body(b)); }

    @PostMapping("/api/billing/invoices/{id}/correct-po")
    public Object correctPo(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return issue.correctPo(RequestContext.of(req, body(b)), id, body(b)); }

    @GetMapping("/api/billing/invoices/{id}/pdf")
    public ResponseEntity<byte[]> pdf(HttpServletRequest req, @PathVariable String id) {
        InvoiceIssueService.File f = issue.pdf(RequestContext.of(req, null), id);
        return new StoredFile(f.buf(), "application/pdf", f.name()).response();
    }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
