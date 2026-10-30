package com.tentamus.lims.core.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpServletResponseWrapper;
import java.io.IOException;
import java.io.PrintWriter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * The headers every Node backend answer carried (server.js send()): no caching, no sniffing, same-origin framing, HSTS
 * behind HTTPS. A file or download (an answer with Content-Disposition) other than a PDF also gets the sandbox policy,
 * so nothing in it can run as part of the app, even when a controller forgot to set it (StoredFile sets it already).
 */
@Component
@Order(1)
public class SecurityHeadersFilter extends OncePerRequestFilter {
    static final String FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox";
    private final boolean https;

    public SecurityHeadersFilter(@Value("${lims.https}") String https) { this.https = "1".equals(https); }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "same-origin");
        res.setHeader("X-Frame-Options", "SAMEORIGIN");
        if (https) res.setHeader("Strict-Transport-Security", "max-age=31536000");
        chain.doFilter(req, new FileHeaders(res));
    }

    /** Adds the file policy just before the body is written, when the headers are final. */
    static final class FileHeaders extends HttpServletResponseWrapper {
        FileHeaders(HttpServletResponse res) { super(res); }

        private void fileCsp() {
            String type = getContentType();
            if (getHeader("Content-Disposition") != null && getHeader("Content-Security-Policy") == null
                && (type == null || !type.toLowerCase().startsWith("application/pdf"))) setHeader("Content-Security-Policy", FILE_CSP);
        }

        @Override
        public ServletOutputStream getOutputStream() throws IOException { fileCsp(); return super.getOutputStream(); }

        @Override
        public PrintWriter getWriter() throws IOException { fileCsp(); return super.getWriter(); }
    }
}
