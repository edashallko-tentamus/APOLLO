package com.tentamus.lims.purchasing.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.purchasing.domain.PurchasingMessages;
import com.tentamus.lims.purchasing.service.PurchasingService;
import com.tentamus.lims.purchasing.service.VendorService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

/** The purchasing and vendor approval routes, same paths and answers as the Node backend. Thin. */
@RestController
@RequestMapping("/api/purchasing")
public class PurchasingController {
    private final PurchasingService purchasing;
    private final VendorService vendors;
    private final ApiExceptionHandler errors;

    public PurchasingController(PurchasingService purchasing, VendorService vendors, ApiExceptionHandler errors) {
        this.purchasing = purchasing;
        this.vendors = vendors;
        this.errors = errors;
    }

    @GetMapping("/me")
    public Object me(HttpServletRequest req) { return purchasing.me(ctx(req, null)); }

    // ---- requests, approvals, orders, receiving
    @GetMapping("/lines")
    public Object lines(HttpServletRequest req, @RequestParam Map<String, String> q) { return purchasing.lines(ctx(req, null), q); }

    @GetMapping("/lines/{id}")
    public Object line(HttpServletRequest req, @PathVariable String id) { return purchasing.line(ctx(req, null), id); }

    @PostMapping("/lines")
    public Object createLine(HttpServletRequest req, @RequestBody Map<String, Object> b) { return purchasing.createLine(ctx(req, b), b); }

    @PutMapping("/lines/{id}")
    public Object updateLine(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return purchasing.updateLine(ctx(req, b), id, b); }

    @PostMapping("/approve")
    public Object approve(HttpServletRequest req, @RequestBody Map<String, Object> b) { return purchasing.approve(ctx(req, b), b); }

    @PostMapping("/reject")
    public Object reject(HttpServletRequest req, @RequestBody Map<String, Object> b) { return purchasing.reject(ctx(req, b), b); }

    @PostMapping("/orders")
    public Object createOrder(HttpServletRequest req, @RequestBody Map<String, Object> b) { return purchasing.createOrder(ctx(req, b), b); }

    @GetMapping("/orders")
    public Object orders(HttpServletRequest req, @RequestParam Map<String, String> q) { return purchasing.orders(ctx(req, null), q); }

    @GetMapping("/orders/{id}")
    public Object order(HttpServletRequest req, @PathVariable String id) { return purchasing.order(ctx(req, null), id); }

    @PutMapping("/orders/{id}")
    public Object updateOrder(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return purchasing.updateOrder(ctx(req, b), id, b); }

    @PostMapping("/lines/{id}/receive")
    public Object receive(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return purchasing.receive(ctx(req, b), id, b); }

    @GetMapping("/receipts/{id}/slip")
    public ResponseEntity<byte[]> slip(HttpServletRequest req, @PathVariable String id) { return file(purchasing.slip(ctx(req, null), id)); }

    @GetMapping("/settings")
    public ResponseEntity<Object> settings(HttpServletRequest req) {
        Map<String, Object> s = purchasing.settings(ctx(req, null));
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(s == null ? "null" : s);
    }

    @PutMapping("/settings")
    public Object saveSettings(HttpServletRequest req, @RequestBody Map<String, Object> b) { return purchasing.saveSettings(ctx(req, b), b); }

    // ---- suppliers and vendor approvals
    @GetMapping("/suppliers")
    public Object suppliers(HttpServletRequest req) { return vendors.suppliers(ctx(req, null)); }

    @GetMapping("/suppliers/{id}")
    public Object supplier(HttpServletRequest req, @PathVariable String id) { return vendors.supplier(ctx(req, null), id); }

    @PostMapping("/suppliers/{id}/qualifications")
    public Object qualify(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return vendors.qualify(ctx(req, b), id, b); }

    @PostMapping("/qualifications/{id}/withdraw")
    public Object withdrawQualification(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) {
        return vendors.withdrawQualification(ctx(req, b), id, body(b));
    }

    @PostMapping("/qualifications/{id}/documents")
    public Object addDocuments(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return vendors.addDocuments(ctx(req, b), id, b); }

    @PostMapping("/qualifications/{id}/propose")
    public Object propose(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return vendors.propose(ctx(req, b), id, body(b)); }

    @PostMapping("/documents/{id}/withdraw")
    public Object withdrawDocument(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) {
        return vendors.withdrawDocument(ctx(req, b), id, body(b));
    }

    @GetMapping("/documents/{id}/file")
    public ResponseEntity<byte[]> documentFile(HttpServletRequest req, @PathVariable String id, @RequestParam(name = "s", required = false) String s) {
        return file(vendors.documentFile(ctx(req, null), id, s));
    }

    @PostMapping("/promotions/{id}/decide")
    public Object decide(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return vendors.decide(ctx(req, b), id, body(b)); }

    @PostMapping("/promotions/{id}/withdraw")
    public Object withdrawPromotion(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) {
        return vendors.withdrawPromotion(ctx(req, b), id, body(b));
    }

    @PostMapping("/notices/acknowledge")
    public Object acknowledge(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return vendors.acknowledge(ctx(req, b), body(b)); }

    @GetMapping("/vendors")
    public Object vendorList(HttpServletRequest req) { return vendors.vendors(ctx(req, null)); }

    @GetMapping("/scopes")
    public Object scopes(HttpServletRequest req) { return vendors.scopes(ctx(req, null)); }

    @PostMapping("/scopes")
    public Object saveScopes(HttpServletRequest req, @RequestBody Map<String, Object> b) { return vendors.saveScopes(ctx(req, b), b); }

    @GetMapping("/risk-classes")
    public Object riskClasses(HttpServletRequest req) { return vendors.riskClasses(ctx(req, null)); }

    @PostMapping("/risk-classes")
    public Object saveRiskClasses(HttpServletRequest req, @RequestBody Map<String, Object> b) { return vendors.saveRiskClasses(ctx(req, b), b); }

    /** Purchasing's own wording for its database checks, then the usual error contract. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> error(Exception e) {
        if (e instanceof HttpMessageNotReadableException bad) return errors.badJson(bad);
        Exception t = PurchasingMessages.MESSAGES.translate(e);
        return t instanceof RuleException r ? errors.rule(r) : errors.other(t);
    }

    private static ResponseEntity<byte[]> file(Map<String, Object> d) {
        return new StoredFile(Base64.getMimeDecoder().decode((String) d.get("b64")), (String) d.get("mime_type"), (String) d.get("file_name")).response();
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
