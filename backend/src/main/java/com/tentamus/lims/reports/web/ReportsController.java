package com.tentamus.lims.reports.web;

import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.reports.service.ReportsService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Report Finalization's routes other than making a COA (that is CoaController): same paths and answers. */
@RestController
public class ReportsController {
    private final ReportsService reports;

    public ReportsController(ReportsService reports) { this.reports = reports; }

    @GetMapping("/api/reports/queue")
    public Object queue(HttpServletRequest req) { return reports.queue(ctx(req, null)); }

    @PostMapping("/api/reports/claim")
    public Object claim(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return reports.claim(ctx(req, b), body(b)); }

    @PostMapping("/api/reports/claims/{id}/release")
    public Object release(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return reports.release(ctx(req, b), id, body(b)); }

    @GetMapping("/api/reports/issued")
    public Object issued(HttpServletRequest req, @RequestParam Map<String, String> q) { return reports.issued(ctx(req, null), q); }

    @GetMapping("/api/orders/{id}/coas")
    public Object orderCoas(HttpServletRequest req, @PathVariable String id) { return reports.orderCoas(ctx(req, null), id); }

    @PostMapping("/api/reports/notes")
    public Object addNote(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return reports.addNote(ctx(req, b), body(b)); }

    @PostMapping("/api/reports/notes/{id}/remove")
    public Object removeNote(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return reports.removeNote(ctx(req, b), id, body(b)); }

    @GetMapping("/api/reports/samples/{id}/coa")
    public Object sampleCoa(HttpServletRequest req, @PathVariable String id) { return reports.sampleCoa(ctx(req, null), id); }

    @GetMapping("/api/reports/coa/{id}/pdf")
    public ResponseEntity<byte[]> coaPdf(HttpServletRequest req, @PathVariable String id) {
        Map<String, Object> v = reports.coaPdf(ctx(req, null), id);
        return new StoredFile(Base64.getMimeDecoder().decode((String) v.get("b64")), "application/pdf", v.get("sample_code") + "-R" + Js.string(v.get("version_no")) + ".pdf").response();
    }

    @PostMapping("/api/samples/{id}/attachments")
    public Object attach(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return reports.attach(ctx(req, b), id, body(b)); }

    @GetMapping("/api/attachments/{id}/file")
    public ResponseEntity<byte[]> attachmentFile(HttpServletRequest req, @PathVariable String id) {
        Map<String, Object> d = reports.attachmentFile(ctx(req, null), id);
        return new StoredFile(Base64.getMimeDecoder().decode((String) d.get("b64")), (String) d.get("mime_type"), (String) d.get("file_name")).response();
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
