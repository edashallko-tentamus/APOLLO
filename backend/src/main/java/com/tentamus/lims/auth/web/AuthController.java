package com.tentamus.lims.auth.web;

import com.tentamus.lims.auth.service.AuthService;
import com.tentamus.lims.core.web.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Sign in, sessions and the administrators' account tools: same paths, answers and cookie as the Node backend's auth.js. */
@RestController
public class AuthController {
    private final AuthService auth;

    public AuthController(AuthService auth) { this.auth = auth; }

    @GetMapping("/api/auth/state")
    public Object state(HttpServletRequest req) { return auth.state(ctx(req, null), req.getAttribute(RequestContext.EXPIRED_ATTRIBUTE) != null); }

    @PostMapping("/api/auth/setup")
    public ResponseEntity<Object> setup(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return cookie(auth.setup(ctx(req, b), body(b))); }

    @PostMapping("/api/auth/login")
    public ResponseEntity<Object> login(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return cookie(auth.login(ctx(req, b), body(b))); }

    @PostMapping("/api/auth/logout")
    public ResponseEntity<Object> logout(HttpServletRequest req) { return cookie(auth.logout(ctx(req, null), (String) req.getAttribute(RequestContext.TOKEN_ATTRIBUTE))); }

    @PostMapping("/api/auth/change-password")
    public Object changePassword(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return auth.changePassword(ctx(req, b), body(b)); }

    @PostMapping("/api/admin/users")
    public Object createUser(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return auth.createUser(ctx(req, b), body(b)); }

    @PostMapping("/api/admin/users/{id}/temp-password")
    public Object tempPassword(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) {
        return auth.tempPassword(ctx(req, b), id, body(b));
    }

    @GetMapping("/api/admin/auth-events")
    public Object authEvents(HttpServletRequest req) { return auth.authEvents(ctx(req, null)); }

    private static ResponseEntity<Object> cookie(AuthService.WithCookie a) { return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE, a.cookie()).body(a.body()); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
