package com.tentamus.lims.core.session;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Sign-in sessions (auth.js): a random token in the HttpOnly cookie lims3_sid, kept in memory. A session ends after
 * LIMS_IDLE_MINUTES (30) without a request, on sign out, when an administrator sets the person a temporary password, or
 * when the server restarts. shortcut: in this process only, so one Java backend serves everyone; move to a database
 * table if several backends ever run side by side.
 */
@Component
public class SessionStore implements SessionGateway {
    public static final String COOKIE = "lims3_sid";
    private static final SecureRandom RANDOM = new SecureRandom();
    private final double idleMinutes;
    private final long idleMs;
    private final String secure;
    private final Map<String, Entry> sessions = new ConcurrentHashMap<>();

    private static final class Entry {
        final String userId;
        volatile long lastSeen = System.currentTimeMillis();

        Entry(String userId) { this.userId = userId; }
    }

    /** A short-lived session for the server's own headless browser (verification evidence): ended when the capture is done. */
    public record CaptureSession(String name, String token, SessionStore store) {
        public void end() { store.end(token); }
    }

    public SessionStore(@Value("${lims.idle-minutes:30}") double idleMinutes, @Value("${lims.https}") String https) {
        this.idleMinutes = idleMinutes;
        this.idleMs = (long) (idleMinutes * 60 * 1000);
        this.secure = "1".equals(https) ? "; Secure" : "";
    }

    /** The person behind a request; touches the idle timer. An expired session is removed and answered once as timed out. */
    @Override
    public Session resolve(String cookieHeader) {
        String token = cookies(cookieHeader).get(COOKIE);
        Entry e = token == null ? null : sessions.get(token);
        if (e == null) return Session.none(false);
        long now = System.currentTimeMillis();
        if (now - e.lastSeen > idleMs) {
            sessions.remove(token);
            return Session.none(true);
        }
        e.lastSeen = now;
        return new Session(e.userId, token, false);
    }

    /** Starts a session; the answer is the Set-Cookie header value. */
    public String start(String userId) {
        String token = newToken();
        sessions.put(token, new Entry(userId));
        return COOKIE + "=" + token + "; HttpOnly; SameSite=Strict; Path=/" + secure;
    }

    public String clearCookie() { return COOKIE + "=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" + secure; }

    public CaptureSession capture(String userId) {
        String token = newToken();
        sessions.put(token, new Entry(userId));
        return new CaptureSession(COOKIE, token, this);
    }

    public void end(String token) { if (token != null) sessions.remove(token); }

    /** Signs a person out everywhere. */
    public void endAll(String userId) { sessions.values().removeIf(e -> e.userId.equals(userId)); }

    /** LIMS_IDLE_MINUTES as JavaScript writes the number (30, not 30.0). */
    public Number idleMinutes() { return idleMinutes == Math.rint(idleMinutes) ? (Number) (long) idleMinutes : (Number) idleMinutes; }

    private static String newToken() {
        byte[] b = new byte[32];
        RANDOM.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    static Map<String, String> cookies(String header) {
        Map<String, String> out = new HashMap<>();
        if (header == null) return out;
        for (String part : header.split(";")) {
            int i = part.indexOf('=');
            if (i > 0) out.put(part.substring(0, i).trim(), part.substring(i + 1).trim());
        }
        return out;
    }
}
