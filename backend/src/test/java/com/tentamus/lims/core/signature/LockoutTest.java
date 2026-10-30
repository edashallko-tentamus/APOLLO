package com.tentamus.lims.core.signature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.tentamus.lims.core.web.RuleException;
import org.junit.jupiter.api.Test;

/** The account lock (5 wrong passwords) and the per-computer limits (auth.js, ratelimit.js). */
class LockoutTest {
    @Test
    void theFifthWrongPasswordLocksTheAccount() {
        assertEquals(1, AuthEvents.nextAttempt(null));
        assertEquals(1, AuthEvents.nextAttempt(0));
        int n = 0;
        for (int i = 0; i < 4; i++) { n = AuthEvents.nextAttempt(n); assertFalse(AuthEvents.locks(n)); }
        n = AuthEvents.nextAttempt(n);
        assertEquals(5, n);
        assertTrue(AuthEvents.locks(n));
    }

    @Test
    void aComputerWaitsAfterTooManyWrongPasswords() {
        FailureLimiter f = new FailureLimiter(3, 120);
        for (int i = 0; i < 3; i++) { f.check("10.0.0.1"); f.note("10.0.0.1"); }
        RuleException e = assertThrows(RuleException.class, () -> f.check("10.0.0.1"));
        assertEquals(429, e.status());
        assertEquals("Too many wrong passwords from this computer. Wait 15 minutes and try again.", e.getMessage());
        f.check("10.0.0.2");   // another computer is not affected
    }

    @Test
    void publicPagesAreLimitedPerMinute() {
        FailureLimiter f = new FailureLimiter(20, 2);
        f.checkPublic("10.0.0.1");
        f.checkPublic("10.0.0.1");
        RuleException e = assertThrows(RuleException.class, () -> f.checkPublic("10.0.0.1"));
        assertEquals("Too many requests from this computer. Wait a minute and try again.", e.getMessage());
        f.prune();
        f.checkPublic("10.0.0.2");
    }
}
