package com.tentamus.lims.permissions.web;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.permissions.service.PermissionsService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Permissions and lab groups: same paths and answers as the Node backend. */
@RestController
public class PermissionsController {
    private final PermissionsService permissions;

    public PermissionsController(PermissionsService permissions) { this.permissions = permissions; }

    @GetMapping("/api/permissions")
    public Object list() { return permissions.permissions(); }

    @GetMapping("/api/groups")
    public Object groups(HttpServletRequest req) { return permissions.groups(ctx(req, null)); }

    @PostMapping("/api/groups")
    public Object saveGroups(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return permissions.saveGroups(ctx(req, b), body(b)); }

    @PostMapping("/api/groups/permissions")
    public Object saveGroupPermissions(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return permissions.saveGroupPermissions(ctx(req, b), body(b)); }

    @PostMapping("/api/admin/memberships")
    public Object saveMemberships(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return permissions.saveMemberships(ctx(req, b), body(b)); }

    @GetMapping("/api/permission-matrix")
    public Object matrix(HttpServletRequest req) { return permissions.matrixPage(ctx(req, null)); }

    @GetMapping("/api/permission-history")
    public Object history(HttpServletRequest req) { return permissions.history(ctx(req, null)); }

    /** Opened as a download link: the lab comes in the address (?s=). */
    @GetMapping("/api/permission-matrix.xlsx")
    public ResponseEntity<byte[]> xlsx(HttpServletRequest req, @RequestParam Map<String, String> q) {
        RequestContext c = ctx(req, null);
        if (q.get("s") != null && !q.get("s").isEmpty()) c = c.withSite(RequestContext.isUuid(q.get("s")) ? q.get("s") : null);
        PermissionsService.Download d = permissions.matrixXlsx(c, q);
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + d.fileName() + "\"")
            .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox").body(d.file());
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
