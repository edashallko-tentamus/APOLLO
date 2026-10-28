package com.tentamus.lims.testing.service;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Request values read as JavaScript reads them: new Date(v).toISOString() and Number(v). */
class TestingValuesTest {
    @Test
    void timesAsJavaScriptReadsThem() {
        assertEquals("2026-10-27T08:12:00.000Z", TestingValues.when("2026-10-27T08:12:00Z"));
        assertEquals("2026-10-27T15:12:00.000Z", TestingValues.when("2026-10-27T08:12:00-07:00"));
        assertEquals("2026-10-27T00:00:00.000Z", TestingValues.when("2026-10-27"));   // a date alone: UTC midnight
        String local = LocalDateTime.of(2026, 10, 27, 8, 12).atZone(ZoneId.systemDefault()).withZoneSameInstant(ZoneOffset.UTC)
            .format(DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"));
        assertEquals(local, TestingValues.when("2026-10-27T08:12"));                  // no zone: the server's own time
        assertEquals(local, TestingValues.when("2026-10-27 08:12"));
        assertNull(TestingValues.when(""));
        assertTrue(TestingValues.when("now").endsWith("Z"));
        assertThrows(RuleException.class, () -> TestingValues.when("yesterday"));
    }

    @Test
    void numbersAsJavaScriptReadsThem() {
        Map<String, Object> b = new HashMap<>();
        b.put("runs", "2");
        b.put("none", null);
        assertEquals(2L, TestingValues.jsNumber(b, "runs"));
        assertEquals(0L, TestingValues.jsNumber(b, "none"));
        assertTrue(((Double) TestingValues.jsNumber(b, "missing")).isNaN());
        assertEquals(1L, TestingValues.orOne("0"));
        assertEquals(3L, TestingValues.orOne(3));
        assertEquals("duplicate", TestingValues.replicateWord(2L));
        assertEquals("NaN", TestingValues.replicateWord(Double.NaN));
        assertNull(TestingValues.num(""));
        assertEquals(1.5, TestingValues.num("1.5"));
    }
}
