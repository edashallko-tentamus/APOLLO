package com.tentamus.lims.audit.web;

import com.tentamus.lims.audit.service.AuditService;
import com.tentamus.lims.core.web.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The audit trail: same paths and answers as the Node backend's /api/audit routes. */
@RestController
public class AuditController {
    private final AuditService audit;

    public AuditController(AuditService audit) { this.audit = audit; }

    @GetMapping("/api/audit")
    public Object log(HttpServletRequest req, @RequestParam Map<String, String> q) { return audit.log(RequestContext.of(req, null), q); }

    @GetMapping("/api/audit/tables")
    public Object tables() { return audit.tables(); }

    @GetMapping("/api/audit/scope")
    public Object scope(HttpServletRequest req, @RequestParam Map<String, String> q) { return audit.scope(RequestContext.of(req, null), q); }
}
