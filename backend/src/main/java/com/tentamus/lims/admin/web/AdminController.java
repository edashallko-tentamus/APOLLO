package com.tentamus.lims.admin.web;

import com.tentamus.lims.admin.service.AdminService;
import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** The remaining core routes (people, reference lists, reasons, users admin, signatures): same paths and answers. */
@RestController
public class AdminController {
    private final AdminService admin;

    public AdminController(AdminService admin) { this.admin = admin; }

    @GetMapping("/api/users")
    public Object users(HttpServletRequest req) { return admin.users(ctx(req, null)); }

    @GetMapping("/api/meta")
    public Object meta() { return admin.meta(); }

    @GetMapping("/api/dashboard")
    public Object start(HttpServletRequest req) { return admin.startCounts(ctx(req, null)); }

    @GetMapping("/api/reasons")
    public Object reasons(@RequestParam Map<String, String> q) { return admin.reasons(q); }

    @GetMapping("/api/reasons/all")
    public Object allReasons() { return admin.allReasons(); }

    @PostMapping("/api/reasons/bulk")
    public Object saveReasons(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return admin.saveReasons(ctx(req, b), body(b)); }

    @PostMapping("/api/tests")
    public Object createTest(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return admin.createTest(ctx(req, b), body(b)); }

    @GetMapping("/api/admin/users")
    public Object adminUsers(HttpServletRequest req) { return admin.adminUsers(ctx(req, null)); }

    @PostMapping("/api/admin/users/{id}/signature")
    public Object setSignature(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return admin.setSignature(ctx(req, b), id, body(b)); }

    /** Shown as an image: the lab comes in the link (?s=). */
    @GetMapping("/api/admin/users/{id}/signature")
    public ResponseEntity<byte[]> signature(HttpServletRequest req, @PathVariable String id, @RequestParam Map<String, String> q) {
        RequestContext c = ctx(req, null);
        if (q.get("s") != null && !q.get("s").isEmpty()) c = c.withSite(RequestContext.isUuid(q.get("s")) ? q.get("s") : null);
        Map<String, Object> d = admin.signature(c, id);
        return new StoredFile(Base64.getMimeDecoder().decode((String) d.get("b64")), (String) d.get("mime_type"), "signature").response();
    }

    @PostMapping("/api/versions/{vid}/serving-line")
    public Object servingLine(HttpServletRequest req, @PathVariable String vid, @RequestBody(required = false) Map<String, Object> b) { return admin.servingLine(ctx(req, b), vid, body(b)); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
