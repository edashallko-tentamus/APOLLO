package com.tentamus.lims.trending.web;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.trending.service.TrendingService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Trending and control charts, and their PDF: same paths and answers as the Node backend. */
@RestController
public class TrendingController {
    private final TrendingService trending;

    public TrendingController(TrendingService trending) { this.trending = trending; }

    @GetMapping("/api/trending/options")
    public Object options(HttpServletRequest req) { return trending.options(ctx(req, null)); }

    @PostMapping("/api/trending/build")
    public Object build(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return trending.build(ctx(req, b), body(b)); }

    @GetMapping("/api/trending/charts")
    public Object charts(HttpServletRequest req) { return trending.charts(ctx(req, null)); }

    @PostMapping("/api/trending/charts")
    public Object save(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return trending.save(ctx(req, b), body(b)); }

    @GetMapping("/api/trending/charts/{id}")
    public Object chart(HttpServletRequest req, @PathVariable String id, @RequestParam Map<String, String> q) { return trending.chart(ctx(req, null), id, q); }

    @PostMapping("/api/trending/charts/{id}/approve")
    public Object approve(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return trending.approve(ctx(req, b), id, body(b)); }

    @PostMapping("/api/trending/charts/{id}/apply-limits")
    public Object applyLimits(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return trending.applyLimits(ctx(req, b), id, body(b)); }

    @PostMapping("/api/trending/charts/{id}/freeze")
    public Object freeze(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return trending.freeze(ctx(req, b), id, body(b)); }

    @PostMapping("/api/trending/charts/{id}/unfreeze")
    public Object unfreeze(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return trending.unfreeze(ctx(req, b), id, body(b)); }

    @PostMapping("/api/trending/charts/{id}/retire")
    public Object retire(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return trending.retire(ctx(req, b), id, body(b)); }

    @PostMapping("/api/trending/signals/review")
    public Object reviewSignal(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return trending.reviewSignal(ctx(req, b), body(b)); }

    @GetMapping("/api/trending/watch")
    public Object watch(HttpServletRequest req) { return trending.watch(ctx(req, null)); }

    @GetMapping("/api/trending/packs/{pack}")
    public Object pack(HttpServletRequest req, @PathVariable String pack, @RequestParam Map<String, String> q) { return trending.pack(ctx(req, null), pack, q); }

    @GetMapping("/api/trending/review/{batchId}")
    public Object review(HttpServletRequest req, @PathVariable String batchId) { return trending.review(ctx(req, null), batchId); }

    @PostMapping("/api/trending/pdf")
    public ResponseEntity<byte[]> pdf(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) {
        TrendingService.Download d = trending.pdf(ctx(req, b), body(b));
        return new com.tentamus.lims.core.files.StoredFile(d.file(), "application/pdf", d.fileName()).response();
    }

    @PostMapping("/api/trending/export.xlsx")
    public ResponseEntity<byte[]> exportXlsx(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) {
        TrendingService.Download d = trending.exportXlsx(ctx(req, b), body(b));
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + d.fileName() + "\"")
            .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox").body(d.file());
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
