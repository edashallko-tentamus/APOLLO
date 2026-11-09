package com.tentamus.lims.sensors.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** The sensor connection and link rules moved out of the database in migration 070 (test_039). */
class SensorRulesTest {
    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static SensorLink link() {
        SensorLink l = new SensorLink();
        l.id = "l1"; l.siteId = "cfl"; l.externalId = " R501 "; l.measures = "temperature"; l.createdBy = "sup";
        return l;
    }

    @Test
    void connection() {
        SensorConnection c = new SensorConnection();
        c.mode = "iMonnit cloud"; c.enabled = true; c.baseUrl = " "; c.readEveryMinutes = 10; c.lookbackHours = 24;
        assertEquals("Give iMonnit's address before switching the connection on", refusal(c::check));
        c.baseUrl = "ftp://x";
        assertEquals("iMonnit's address starts with https://", refusal(c::check));
        c.baseUrl = " https://www.imonnit.com ";
        c.check();
        assertEquals("https://www.imonnit.com", c.baseUrl);
        c.readEveryMinutes = 4;
        assertNotNull(refusal(c::check));
        c.readEveryMinutes = 10; c.lookbackHours = 73;
        assertNotNull(refusal(c::check));
        SensorConnection pretend = new SensorConnection();
        pretend.mode = "Pretend (sandbox)"; pretend.enabled = true; pretend.readEveryMinutes = 10; pretend.lookbackHours = 24;
        assertNull(refusal(pretend::check));
    }

    @Test
    void linking() {
        SensorLink l = link();
        l.checkNew("cfl", "cfl", null);
        assertEquals("R501", l.externalId);
        assertEquals("Awaiting QA", l.status);                              // it waits for QA
        assertEquals("The logbook and the equipment must be of the sensor's lab", refusal(() -> link().checkNew("tps", "cfl", null)));
        assertEquals("Temperature is not a number field", refusal(() -> link().checkNew("cfl", "cfl", "Temperature is not a number field")));
        SensorLink bad = link();
        bad.externalId = "R 501!";
        assertNotNull(refusal(() -> bad.checkNew("cfl", "cfl", null)));
        SensorLink gap = link();
        gap.gapMinutes = 5;
        assertNotNull(refusal(() -> gap.checkNew("cfl", "cfl", null)));
    }

    @Test
    void approvingAndRetiring() {
        Instant now = Instant.parse("2026-10-29T12:00:00Z");
        assertEquals("You linked this sensor: someone else in QA approves it", refusal(() -> link().approve("sup", null, now, now)));
        assertEquals("The feed starts at most 7 days back", refusal(() -> link().approve("qa", null, now.minus(Duration.ofDays(8)), now)));
        assertEquals("The feed cannot start in the future", refusal(() -> link().approve("qa", null, now.plus(Duration.ofMinutes(5)), now)));
        SensorLink l = link();
        assertEquals(now.minus(Duration.ofHours(11)), l.approve("qa", null, now.minus(Duration.ofHours(11)), now));
        assertEquals("Active", l.status);
        assertEquals("The link is active", refusal(() -> l.approve("qa", null, now, now)));
        assertEquals("Say why the sensor is no longer linked (moved, replaced, equipment retired)", refusal(() -> l.retire(" ")));
        l.retire(" Sensor moved to the new fridge ");
        assertEquals("Sensor moved to the new fridge", l.retiredReason);
        assertEquals("The link is already retired", refusal(() -> l.retire("again")));
    }
}
