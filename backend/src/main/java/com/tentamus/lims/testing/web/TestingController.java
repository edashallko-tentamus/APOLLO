package com.tentamus.lims.testing.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.testing.domain.TestingMessages;
import com.tentamus.lims.testing.service.BatchService;
import com.tentamus.lims.testing.service.BenchService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

/** The testing routes (backlog, batches, the bench, QC Review), same paths and answers as the Node backend. Thin. */
@RestController
@RequestMapping("/api/testing")
public class TestingController {
    private final BatchService batches;
    private final BenchService bench;
    private final ApiExceptionHandler errors;

    public TestingController(BatchService batches, BenchService bench, ApiExceptionHandler errors) {
        this.batches = batches;
        this.bench = bench;
        this.errors = errors;
    }

    // ---- backlog, batches, worklist
    @GetMapping("/backlog")
    public Object backlog(HttpServletRequest req) { return batches.backlog(ctx(req, null)); }

    @PostMapping("/batches")
    public Object create(HttpServletRequest req, @RequestBody Map<String, Object> b) { return batches.create(ctx(req, b), b); }

    @GetMapping("/batches")
    public Object list(HttpServletRequest req, @RequestParam Map<String, String> q) { return batches.batches(ctx(req, null), q); }

    @GetMapping("/batches/{id}")
    public Object batch(HttpServletRequest req, @PathVariable String id) { return batches.batch(ctx(req, null), id); }

    @GetMapping("/batches/{id}/options")
    public Object options(HttpServletRequest req, @PathVariable String id) { return batches.options(ctx(req, null), id); }

    @GetMapping("/batches/{id}/pool")
    public Object pool(HttpServletRequest req, @PathVariable String id) { return batches.pool(ctx(req, null), id); }

    @PostMapping("/batches/{id}/add")
    public Object add(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return batches.add(ctx(req, b), id, body(b)); }

    @PostMapping("/entries/{id}/remove")
    public Object remove(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return batches.remove(ctx(req, b), id, body(b)); }

    @GetMapping("/open-batches")
    public Object openBatches(HttpServletRequest req, @RequestParam(name = "version", required = false) String version) { return batches.openBatches(ctx(req, null), version); }

    @PostMapping("/batches/{id}/reprep")
    public Object reprep(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return batches.reprep(ctx(req, b), id, body(b)); }

    @PostMapping("/batches/{id}/assign")
    public Object assign(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return batches.assign(ctx(req, b), id, body(b)); }

    // ---- the bench
    @PostMapping("/step-runs/{id}/values")
    public Object values(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return bench.values(ctx(req, b), id, body(b)); }

    @PostMapping("/step-runs/{id}/fields")
    public Object fields(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return json(bench.fields(ctx(req, b), id, body(b))); }

    @PostMapping("/step-runs/{id}/equipment")
    public Object equipment(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return bench.equipment(ctx(req, b), id, body(b)); }

    @PostMapping("/step-runs/{id}/materials")
    public Object materials(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return bench.materials(ctx(req, b), id, body(b)); }

    @PostMapping("/used/{kind}/{id}/remove")
    public Object removeUsed(HttpServletRequest req, @PathVariable String kind, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) {
        return json(bench.removeUsed(ctx(req, b), kind, id, body(b)));
    }

    @PostMapping("/step-runs/{id}/attachments")
    public Object attach(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return json(bench.attach(ctx(req, b), id, body(b))); }

    @GetMapping("/attachments/{id}/file")
    public ResponseEntity<byte[]> attachmentFile(HttpServletRequest req, @PathVariable String id) {
        Map<String, Object> d = bench.attachmentFile(ctx(req, null), id);
        return new StoredFile(Base64.getMimeDecoder().decode((String) d.get("b64")), (String) d.get("mime_type"), (String) d.get("file_name")).response();
    }

    @PostMapping("/entries/{id}/parent")
    public Object parent(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return json(bench.parent(ctx(req, b), id, body(b))); }

    @PostMapping("/step-runs/{id}/loads")
    public Object addLoad(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return json(bench.addLoad(ctx(req, b), id, body(b))); }

    @PostMapping("/loads/{id}")
    public Object changeLoad(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return json(bench.changeLoad(ctx(req, b), id, body(b))); }

    @GetMapping("/split-requests")
    public Object splitRequests(HttpServletRequest req) { return bench.splitRequests(ctx(req, null)); }

    @PostMapping("/split-requests/{id}/decide")
    public Object decideSplit(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return bench.decideSplit(ctx(req, b), id, body(b)); }

    @PostMapping("/step-runs/{id}/complete")
    public Object complete(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return bench.complete(ctx(req, b), id, body(b)); }

    @PostMapping("/step-runs/{id}/reopen")
    public Object reopen(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return bench.reopen(ctx(req, b), id, body(b)); }

    @PostMapping("/step-runs/{id}/reanalysis")
    public Object reanalysis(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return bench.reanalysis(ctx(req, b), id, body(b)); }

    @PostMapping("/step-runs/{id}/runs")
    public Object addRun(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return bench.addRun(ctx(req, b), id, body(b)); }

    @PostMapping("/entries/{id}/pick")
    public Object pick(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return bench.pick(ctx(req, b), id, body(b)); }

    @PostMapping("/picks/{id}/clear")
    public Object clearPick(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return bench.clearPick(ctx(req, b), id, body(b)); }

    // ---- QC Review
    @GetMapping("/batches/{id}/review")
    public Object review(HttpServletRequest req, @PathVariable String id) { return batches.review(ctx(req, null), id); }

    @PostMapping("/batches/{id}/choose")
    public Object choose(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return batches.choose(ctx(req, b), id, body(b)); }

    @PostMapping("/batches/{id}/accept-qc")
    public Object acceptQc(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return batches.acceptQc(ctx(req, b), id, body(b)); }

    @PostMapping("/batches/{id}/accept-load")
    public Object acceptLoad(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return batches.acceptLoad(ctx(req, b), id, body(b)); }

    @PostMapping("/batches/{id}/steps/{runId}/review-mark")
    public Object reviewMark(HttpServletRequest req, @PathVariable String id, @PathVariable String runId, @RequestBody(required = false) Map<String, Object> b) {
        return batches.reviewMark(ctx(req, b), id, runId, body(b));
    }

    @PostMapping("/batches/{id}/approve")
    public Object approve(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return batches.approve(ctx(req, b), id, body(b)); }

    @PostMapping("/batches/{id}/timepoints/{runId}/release")
    public Object release(HttpServletRequest req, @PathVariable String id, @PathVariable String runId, @RequestBody(required = false) Map<String, Object> b) {
        return batches.release(ctx(req, b), id, runId, body(b));
    }

    @PostMapping("/batches/{id}/return")
    public Object returnBatch(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return batches.returnBatch(ctx(req, b), id, body(b)); }

    @PostMapping("/batches/{id}/cancel")
    public Object cancel(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return batches.cancel(ctx(req, b), id, body(b)); }

    @GetMapping("/samples/{id}/results")
    public Object sampleResults(HttpServletRequest req, @PathVariable String id) { return batches.sampleResults(ctx(req, null), id); }

    /** Testing's own wording for its database checks, then the usual error contract. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> error(Exception e) {
        if (e instanceof HttpMessageNotReadableException bad) return errors.badJson(bad);
        Exception t = TestingMessages.translate(e);
        return t instanceof RuleException r ? errors.rule(r) : errors.other(t);
    }

    /** A row the database may not return answers JSON null, as the Node backend does. */
    private static ResponseEntity<Object> json(Object x) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(x == null ? "null" : x);
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
