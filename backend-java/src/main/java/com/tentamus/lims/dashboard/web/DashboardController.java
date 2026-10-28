package com.tentamus.lims.dashboard.web;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.dashboard.service.DashboardService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Dashboards, group widgets, departments and the finance figures: same paths and answers (the performance report stays in Node). */
@RestController
public class DashboardController {
    private final DashboardService dashboards;

    public DashboardController(DashboardService dashboards) { this.dashboards = dashboards; }

    @GetMapping("/api/dashboard/{board}")
    public Object board(HttpServletRequest req, @PathVariable String board, @RequestParam Map<String, String> q) { return dashboards.board(ctx(req, null), board, q); }

    @GetMapping("/api/dashboard/{board}/detail")
    public Object detail(HttpServletRequest req, @PathVariable String board, @RequestParam Map<String, String> q) { return dashboards.detail(ctx(req, null), board, q); }

    @PutMapping("/api/dashboard/{board}/layout")
    public Object layout(HttpServletRequest req, @PathVariable String board, @RequestBody(required = false) Map<String, Object> b) { return dashboards.saveLayout(ctx(req, b), board, body(b)); }

    @PostMapping("/api/dashboard/{board}/reset")
    public Object reset(HttpServletRequest req, @PathVariable String board, @RequestBody(required = false) Map<String, Object> b) { return dashboards.reset(ctx(req, b), board); }

    @GetMapping("/api/departments")
    public Object departments(HttpServletRequest req) { return dashboards.departments(ctx(req, null)); }

    @GetMapping("/api/admin/dashboard-widgets")
    public Object widgets(HttpServletRequest req) { return dashboards.groupWidgets(ctx(req, null)); }

    @PostMapping("/api/admin/dashboard-widgets")
    public Object saveWidgets(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return dashboards.saveGroupWidgets(ctx(req, b), body(b)); }

    @GetMapping("/api/finance")
    public Object finance(HttpServletRequest req, @RequestParam Map<String, String> q) { return dashboards.finance(ctx(req, null), q); }

    @PostMapping("/api/finance/weeks")
    public Object weeks(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return dashboards.saveWeeks(ctx(req, b), body(b)); }

    @PostMapping("/api/finance/plans")
    public Object plans(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return dashboards.savePlans(ctx(req, b), body(b)); }

    @PostMapping("/api/finance/plans/preview")
    public Object preview(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return dashboards.previewPlans(ctx(req, b), body(b)); }

    @GetMapping("/api/finance/plans.xlsx")
    public ResponseEntity<byte[]> plansXlsx(HttpServletRequest req, @RequestParam Map<String, String> q) {
        DashboardService.Download d = dashboards.plansXlsx(ctx(req, null), q);
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + d.fileName() + "\"")
            .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox").body(d.file());
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
