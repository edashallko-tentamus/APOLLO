package com.tentamus.lims.logbooks.web;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.logbooks.service.LogbooksService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** Electronic logbooks, and a batch's logbook flags, lot entries and aliquots: same paths and answers as the Node backend. */
@RestController
public class LogbooksController {
    private final LogbooksService logbooks;

    public LogbooksController(LogbooksService logbooks) { this.logbooks = logbooks; }

    @GetMapping("/api/logbooks")
    public Object list(HttpServletRequest req) { return logbooks.list(ctx(req, null)); }

    @PostMapping("/api/logbooks")
    public Object create(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return logbooks.create(ctx(req, b), body(b)); }

    @GetMapping("/api/logbooks/review")
    public Object review(HttpServletRequest req) { return logbooks.review(ctx(req, null)); }

    @PostMapping("/api/logbooks/review/approve")
    public Object approveEntries(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return logbooks.approveEntries(ctx(req, b), body(b)); }

    @GetMapping("/api/logbooks/excursions")
    public Object excursions(HttpServletRequest req, @RequestParam Map<String, String> q) { return logbooks.excursions(ctx(req, null), q); }

    @GetMapping("/api/logbooks/{id}")
    public Object logbook(HttpServletRequest req, @PathVariable String id, @RequestParam Map<String, String> q) { return logbooks.logbook(ctx(req, null), id, q); }

    @PostMapping("/api/logbooks/{id}/settings")
    public Object settings(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.saveSettings(ctx(req, b), id, body(b)); }

    @PostMapping("/api/logbooks/{id}/new-version")
    public Object newVersion(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.newVersion(ctx(req, b), id, body(b)); }

    @PostMapping("/api/logbooks/{id}/fields")
    public Object fields(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.saveFields(ctx(req, b), id, body(b)); }

    @PostMapping("/api/logbooks/{id}/approve")
    public Object approve(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.approveDesign(ctx(req, b), id, body(b)); }

    @PostMapping("/api/logbooks/{id}/equipment")
    public Object equipment(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.saveEquipment(ctx(req, b), id, body(b)); }

    @PostMapping("/api/logbooks/{id}/entries")
    public Object record(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.record(ctx(req, b), id, body(b)); }

    @GetMapping("/api/logbooks/entries/{id}")
    public Object entry(HttpServletRequest req, @PathVariable String id) { return logbooks.entry(ctx(req, null), id); }

    @PostMapping("/api/logbooks/entries/{id}/correct")
    public Object correct(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.correct(ctx(req, b), id, body(b)); }

    @PostMapping("/api/logbooks/entries/{id}/return")
    public Object returnEntry(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.returnEntry(ctx(req, b), id, body(b)); }

    @PostMapping("/api/logbooks/entries/{id}/void")
    public Object voidEntry(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.voidEntry(ctx(req, b), id, body(b)); }

    @GetMapping("/api/testing/batches/{id}/equipment-flags")
    public Object equipmentFlags(HttpServletRequest req, @PathVariable String id) { return logbooks.equipmentFlags(ctx(req, null), id); }

    @PostMapping("/api/testing/batches/{id}/accept-flag")
    public Object acceptFlag(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.acceptFlag(ctx(req, b), id, body(b)); }

    @GetMapping("/api/testing/batches/{id}/lot-entries")
    public Object lotEntries(HttpServletRequest req, @PathVariable String id) { return logbooks.lotEntries(ctx(req, null), id); }

    @PostMapping("/api/testing/step-runs/{id}/scan-aliquot")
    public Object scanAliquot(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.scanAliquot(ctx(req, b), id, body(b)); }

    @GetMapping("/api/testing/batches/{id}/aliquots")
    public Object aliquots(HttpServletRequest req, @PathVariable String id) { return logbooks.aliquots(ctx(req, null), id); }

    @PostMapping("/api/logbooks/flags/{id}/resolve")
    public Object resolveFlag(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return logbooks.resolveFlag(ctx(req, b), id, body(b)); }

    @GetMapping("/api/logbooks/for-equipment/{id}")
    public Object forEquipment(HttpServletRequest req, @PathVariable String id) { return logbooks.forEquipment(ctx(req, null), id); }

    @GetMapping("/api/logbooks/for-lot/{id}")
    public Object forLot(HttpServletRequest req, @PathVariable String id) { return logbooks.forLot(ctx(req, null), id); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
