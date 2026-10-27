package com.tentamus.lims.core.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** The headers every Node backend answer carries (server.js send()): no caching, no sniffing, same-origin framing. */
@Component
@Order(1)
public class SecurityHeadersFilter extends OncePerRequestFilter {
    private final boolean https;

    public SecurityHeadersFilter(@Value("${lims.https}") String https) { this.https = "1".equals(https); }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "same-origin");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        if (https) res.setHeader("Strict-Transport-Security", "max-age=31536000");
        chain.doFilter(req, res);
    }
}
