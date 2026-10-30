package com.tentamus.lims.stability.web;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.stability.service.StabilityService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** Stability studies: same paths and answers as the Node backend (the report PDFs are StabilityReportsController's). */
@RestController
public class StabilityController {
    private final StabilityService stability;

    public StabilityController(StabilityService stability) { this.stability = stability; }

    @GetMapping("/api/stability/setup")
    public Object setup(HttpServletRequest req) { return stability.setup(ctx(req, null)); }

    @PostMapping("/api/stability/conditions")
    public Object conditions(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return stability.saveConditions(ctx(req, b), body(b)); }

    @PostMapping("/api/stability/chambers")
    public Object chambers(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return stability.saveChambers(ctx(req, b), body(b)); }

    @PostMapping("/api/stability/racks")
    public Object racks(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return stability.saveRacks(ctx(req, b), body(b)); }

    @GetMapping("/api/stability/quotes")
    public Object quotes(HttpServletRequest req) { return stability.quotes(ctx(req, null)); }

    @PostMapping("/api/stability/quotes")
    public Object newQuote(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return stability.newQuote(ctx(req, b), body(b)); }

    @GetMapping("/api/stability/quotes/{id}")
    public Object quote(HttpServletRequest req, @PathVariable String id) { return stability.quote(ctx(req, null), id); }

    @PostMapping("/api/stability/versions/{vid}/design")
    public Object design(HttpServletRequest req, @PathVariable String vid, @RequestBody(required = false) Map<String, Object> b) { return stability.saveDesign(ctx(req, b), vid, body(b)); }

    @PostMapping("/api/stability/quotes/{id}/new-version")
    public Object newVersion(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return stability.newVersion(ctx(req, b), id); }

    @GetMapping("/api/stability/studies")
    public Object studies(HttpServletRequest req, @RequestParam Map<String, String> q) { return stability.studies(ctx(req, null), q); }

    @GetMapping("/api/stability/studies/{id}")
    public Object study(HttpServletRequest req, @PathVariable String id) { return stability.study(ctx(req, null), id); }

    @PostMapping("/api/stability/studies/{id}/place")
    public Object place(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return stability.place(ctx(req, b), id, body(b)); }

    @PostMapping("/api/stability/pulls/{id}/record")
    public Object record(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return stability.recordPull(ctx(req, b), id, body(b)); }

    @PostMapping("/api/stability/pulls/create-due")
    public Object createDue(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return stability.createDue(ctx(req, b)); }

    @GetMapping("/api/stability/studies/{id}/report")
    public Object report(HttpServletRequest req, @PathVariable String id) { return stability.report(ctx(req, null), id); }

    @PostMapping("/api/stability/studies/{id}/cancel")
    public Object cancel(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return stability.cancel(ctx(req, b), id, body(b)); }

    @PostMapping("/api/stability/storage/{id}/dispose")
    public Object dispose(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return stability.dispose(ctx(req, b), id, body(b)); }

    @PostMapping("/api/stability/studies/{id}/excursions/{entry}/assess")
    public Object assess(HttpServletRequest req, @PathVariable String id, @PathVariable String entry, @RequestBody(required = false) Map<String, Object> b) {
        return stability.assess(ctx(req, b), id, entry, body(b));
    }

    @GetMapping("/api/stability/reports-due")
    public Object reportsDue(HttpServletRequest req) { return stability.reportsDue(ctx(req, null)); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
