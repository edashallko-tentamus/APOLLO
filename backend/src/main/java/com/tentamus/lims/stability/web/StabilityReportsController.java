package com.tentamus.lims.stability.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.stability.service.StabilityReportsService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** The stability report PDFs (summary, preview, issue, an issued report): same paths and answers as the Node backend. */
@RestController
public class StabilityReportsController {
    private final StabilityReportsService reports;

    public StabilityReportsController(StabilityReportsService reports) { this.reports = reports; }

    @GetMapping("/api/stability/studies/{id}/report.pdf")
    public ResponseEntity<byte[]> summary(HttpServletRequest req, @PathVariable String id) { return file(reports.summary(RequestContext.of(req, null), id)); }

    @GetMapping("/api/stability/studies/{id}/report-preview.pdf")
    public ResponseEntity<byte[]> preview(HttpServletRequest req, @PathVariable String id) { return file(reports.preview(RequestContext.of(req, null), id)); }

    @PostMapping("/api/stability/studies/{id}/reports")
    public Object issue(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) {
        Map<String, Object> body = b == null ? Map.of() : b;
        return reports.issue(RequestContext.of(req, body), id, body);
    }

    @GetMapping("/api/stability/reports/{id}/pdf")
    public ResponseEntity<byte[]> issued(HttpServletRequest req, @PathVariable String id) { return file(reports.issued(RequestContext.of(req, null), id)); }

    private static ResponseEntity<byte[]> file(StabilityReportsService.File f) { return new StoredFile(f.buf(), "application/pdf", f.name()).response(); }
}
