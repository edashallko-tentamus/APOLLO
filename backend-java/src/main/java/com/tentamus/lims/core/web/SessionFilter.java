package com.tentamus.lims.core.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.session.SessionGateway;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Every /api request needs a live session, checked as the Node backend checks it (server.js): no session or a timed-out
 * one is 401 with signIn; an inactive or locked account is 401; a temporary password must be changed first.
 */
@Component
@Order(2)
public class SessionFilter extends OncePerRequestFilter {
    private final SessionGateway sessions;
    private final Db db;
    private final ObjectMapper json;

    public SessionFilter(SessionGateway sessions, Db db, ObjectMapper json) {
        this.sessions = sessions;
        this.db = db;
        this.json = json;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest req) {
        return !req.getRequestURI().startsWith("/api/") || req.getRequestURI().startsWith("/api/public/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        SessionGateway.Session s = sessions.resolve(req.getHeader("Cookie"));
        if (!s.signedIn()) {
            deny(res, s.timedOut() ? "Your session timed out. Sign in again." : "Sign in first.", "signIn");
            return;
        }
        Map<String, Object> u = db.one("SELECT must_change_password, is_active, locked_at FROM app_user WHERE id = ?", s.userId());
        if (u == null || !Boolean.TRUE.equals(u.get("is_active")) || u.get("locked_at") != null) {
            deny(res, "This account cannot be used. Ask an administrator.", "signIn");
            return;
        }
        if (Boolean.TRUE.equals(u.get("must_change_password"))) {
            deny(res, "Change your temporary password first.", "changePassword");
            return;
        }
        req.setAttribute(RequestContext.USER_ATTRIBUTE, s.userId());
        chain.doFilter(req, res);
    }

    private void deny(HttpServletResponse res, String error, String flag) throws IOException {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("error", error);
        b.put(flag, true);
        res.setStatus(401);
        res.setContentType("application/json; charset=utf-8");
        res.getWriter().write(json.writeValueAsString(b));
    }
}
