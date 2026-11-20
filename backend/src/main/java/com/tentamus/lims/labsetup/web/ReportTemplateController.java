package com.tentamus.lims.labsetup.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.labsetup.service.ReportTemplateService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Report templates and their versions (migration 074). */
@RestController
public class ReportTemplateController {
    private final ReportTemplateService templates;

    public ReportTemplateController(ReportTemplateService templates) { this.templates = templates; }

    @GetMapping("/api/report-templates")
    public Object list(HttpServletRequest req) { return templates.list(ctx(req, null)); }

    @PostMapping("/api/report-templates")
    public Object create(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return templates.create(ctx(req, b), body(b)); }

    @GetMapping("/api/report-templates/{id}")
    public Object one(HttpServletRequest req, @PathVariable String id) { return templates.one(ctx(req, null), id); }

    @PutMapping("/api/report-templates/{id}")
    public Object rename(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return templates.rename(ctx(req, b), id, body(b)); }

    @PostMapping("/api/report-templates/{id}/copy")
    public Object copy(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return templates.copy(ctx(req, b), id, body(b)); }

    @PostMapping("/api/report-templates/{id}/draft")
    public Object newDraft(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return templates.newDraft(ctx(req, b), id); }

    @PostMapping("/api/report-templates/{id}/labs")
    public Object labs(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return templates.setLabs(ctx(req, b), id, body(b)); }

    @PostMapping("/api/report-templates/{id}/accept")
    public Object accept(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return templates.accept(ctx(req, b), id, body(b)); }

    @PostMapping("/api/report-templates/{id}/default")
    public Object makeDefault(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return templates.makeDefault(ctx(req, b), id); }

    @PostMapping("/api/report-templates/{id}/retire")
    public Object retire(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return templates.retire(ctx(req, b), id); }

    @PutMapping("/api/report-templates/versions/{vid}")
    public Object saveDraft(HttpServletRequest req, @PathVariable String vid, @RequestBody(required = false) Map<String, Object> b) { return templates.saveDraft(ctx(req, b), vid, body(b)); }

    @PostMapping("/api/report-templates/versions/{vid}/approve")
    public Object approve(HttpServletRequest req, @PathVariable String vid, @RequestBody(required = false) Map<String, Object> b) { return templates.approve(ctx(req, b), vid, body(b)); }

    @GetMapping("/api/report-templates/versions/{vid}/preview.pdf")
    public ResponseEntity<byte[]> preview(HttpServletRequest req, @PathVariable String vid, @RequestParam(required = false) String s) {
        // opened in a new tab, so the lab comes as ?s= (a link carries no header)
        RequestContext c = ctx(req, null);
        return new StoredFile(templates.preview(RequestContext.isUuid(s) ? c.withSite(s) : c, vid), "application/pdf", "template preview.pdf").response();
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
