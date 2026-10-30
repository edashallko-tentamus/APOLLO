package com.tentamus.lims.core.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.session.SessionGateway;
import com.tentamus.lims.core.signature.FailureLimiter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Who is asking, checked as the Node backend's server.js checked it. Public pages (/api/public/...) are rate limited per
 * computer. Every other /api request needs a live session, except sign-in itself (OPEN): no session or a timed-out one is
 * 401 with signIn; for a live session, an inactive or locked account is 401 and a temporary password must be changed first.
 */
@Component
@Order(2)
public class SessionFilter extends OncePerRequestFilter {
    /** Reachable without being signed in (sign in, first-time setup, sign out, change password, state). */
    static final Set<String> OPEN = Set.of("/api/auth/state", "/api/auth/login", "/api/auth/setup", "/api/auth/logout", "/api/auth/change-password");
    private final SessionGateway sessions;
    private final FailureLimiter limiter;
    private final Db db;
    private final ObjectMapper json;

    public SessionFilter(SessionGateway sessions, FailureLimiter limiter, Db db, ObjectMapper json) {
        this.sessions = sessions;
        this.limiter = limiter;
        this.db = db;
        this.json = json;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest req) { return !req.getRequestURI().startsWith("/api/"); }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        String path = req.getRequestURI();
        boolean pub = path.startsWith("/api/public/"), open = OPEN.contains(path);
        if (pub) {
            try {
                limiter.checkPublic(RequestContext.clientIp(req));
            } catch (RuleException e) {
                send(res, e.status(), Answers.map("error", e.getMessage(), "code", null));
                return;
            }
        }
        SessionGateway.Session s = sessions.resolve(req.getHeader("Cookie"));
        if (!s.signedIn() && !open && !pub) {
            deny(res, s.timedOut() ? "Your session timed out. Sign in again." : "Sign in first.", "signIn");
            return;
        }
        if (s.timedOut()) req.setAttribute(RequestContext.EXPIRED_ATTRIBUTE, true);
        if (s.signedIn()) {
            if (!open) {
                Map<String, Object> u = db.one("SELECT must_change_password, is_active, locked_at FROM app_user WHERE id = ?", s.userId());
                if (u == null || !Boolean.TRUE.equals(u.get("is_active")) || u.get("locked_at") != null) {
                    deny(res, "This account cannot be used. Ask an administrator.", "signIn");
                    return;
                }
                if (Boolean.TRUE.equals(u.get("must_change_password"))) {
                    deny(res, "Change your temporary password first.", "changePassword");
                    return;
                }
            }
            req.setAttribute(RequestContext.USER_ATTRIBUTE, s.userId());
            req.setAttribute(RequestContext.TOKEN_ATTRIBUTE, s.token());
        }
        chain.doFilter(req, res);
    }

    private void deny(HttpServletResponse res, String error, String flag) throws IOException {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("error", error);
        b.put(flag, true);
        send(res, 401, b);
    }

    private void send(HttpServletResponse res, int status, Map<String, Object> body) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json; charset=utf-8");
        res.getWriter().write(json.writeValueAsString(body));
    }
}
