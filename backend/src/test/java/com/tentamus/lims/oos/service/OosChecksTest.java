package com.tentamus.lims.oos.service;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

/** The check texts are stored, so numbers and dates are written as the Node backend's JavaScript writes them. */
class OosChecksTest {
    @Test
    void toPrecisionAsJavaScript() {
        assertEquals("82.0000000", OosChecks.toPrecision(82, 9));
        assertEquals("100.0", OosChecks.toPrecision(100, 4));
        assertEquals("100", OosChecks.toPrecision(99.99, 3));
        assertEquals("0.001234", OosChecks.toPrecision(0.0012345, 4));   // the double is just under 0.0012345, as in JavaScript
        assertEquals("1.235e+5", OosChecks.toPrecision(123456, 4));
        assertEquals("1.000e-7", OosChecks.toPrecision(1e-7, 4));
        assertEquals("-2.500", OosChecks.toPrecision(-2.5, 4));
        assertEquals("0.000", OosChecks.toPrecision(0, 4));
    }

    @Test
    void datesInLosAngeles() {
        assertEquals("Oct 4, 2026", OosChecks.fmtDate("2026-10-05"));   // a date alone is UTC midnight
        assertEquals("Oct 5, 2026", OosChecks.fmtDate("2026-10-05T18:00:00.000Z"));
        assertEquals("", OosChecks.fmtDate(null));
    }
}
