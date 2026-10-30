package com.tentamus.lims.core.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Sessions and their cookie (auth.js). */
class SessionStoreTest {
    @Test
    void aSessionIsFoundByItsCookieUntilItEnds() {
        SessionStore s = new SessionStore(30, "0");
        String cookie = s.start("u1");
        assertTrue(cookie.matches("lims3_sid=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=/"));
        String header = "other=1; " + cookie.substring(0, cookie.indexOf(';'));
        assertEquals("u1", s.resolve(header).userId());
        s.endAll("u1");
        assertFalse(s.resolve(header).signedIn());
        assertFalse(s.resolve(null).signedIn());
        assertEquals(30L, s.idleMinutes());
    }

    @Test
    void anIdleSessionTimesOutOnceThenIsGone() throws Exception {
        SessionStore s = new SessionStore(0.0001, "1");   // about 6 ms
        String cookie = s.start("u1");
        assertTrue(cookie.endsWith("; Path=/; Secure"));
        Thread.sleep(30);
        String header = cookie.substring(0, cookie.indexOf(';'));
        assertTrue(s.resolve(header).timedOut());
        assertFalse(s.resolve(header).timedOut());
        assertEquals("lims3_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure", s.clearCookie());
    }
}
