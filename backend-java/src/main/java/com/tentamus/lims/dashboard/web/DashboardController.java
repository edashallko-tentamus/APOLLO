package com.tentamus.lims.dashboard.web;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.dashboard.service.DashboardService;
import com.tentamus.lims.dashboard.service.PerformanceReport;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Dashboards, group widgets, departments, the finance figures and the performance report: same paths and answers. */
@RestController
public class DashboardController {
    private final DashboardService dashboards;
    private final PerformanceReport performance;

    public DashboardController(DashboardService dashboards, PerformanceReport performance) {
        this.dashboards = dashboards;
        this.performance = performance;
    }

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
        return xlsx(dashboards.plansXlsx(ctx(req, null), q));
    }

    @GetMapping("/api/finance/report.xlsx")
    public ResponseEntity<byte[]> report(HttpServletRequest req, @RequestParam Map<String, String> q) { return xlsx(performance.report(ctx(req, null), q)); }

    private static ResponseEntity<byte[]> xlsx(DashboardService.Download d) {
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + d.fileName() + "\"")
            .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox").body(d.file());
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
