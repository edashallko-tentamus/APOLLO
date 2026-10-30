package com.tentamus.lims.reports.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.reports.service.CoaService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Making a COA: the preview and its PDF, the signed finalization, and the public verification check. */
@RestController
public class CoaController {
    private final CoaService coa;

    public CoaController(CoaService coa) { this.coa = coa; }

    @PostMapping("/api/reports/preview")
    public Object preview(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return coa.preview(RequestContext.of(req, b), body(b)); }

    @GetMapping("/api/reports/preview/{token}")
    public ResponseEntity<byte[]> previewPdf(HttpServletRequest req, @PathVariable String token) {
        return new StoredFile(coa.previewPdf(RequestContext.of(req, null), token), "application/pdf", "COA preview.pdf").response();
    }

    @PostMapping("/api/reports/finalize")
    public Object finalize(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return coa.finalize(RequestContext.of(req, b), body(b)); }

    @GetMapping("/api/public/coa/{code}")
    public Object publicCheck(@PathVariable String code) { return coa.publicCheck(code); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
