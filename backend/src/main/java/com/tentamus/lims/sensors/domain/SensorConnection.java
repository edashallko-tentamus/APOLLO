package com.tentamus.lims.sensors.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * A lab's connection to iMonnit (or the pretend service). Replaces the rule part of the database trigger
 * sensor_connection_rules and the range checks on its columns (migration 070; that only a system administrator sets it
 * stays in the database).
 */
public final class SensorConnection {
    public String mode, baseUrl;
    public boolean enabled;
    public int readEveryMinutes, lookbackHours;

    /** Checks the connection about to be saved (the address trimmed, blank as none). */
    public void check() {
        baseUrl = baseUrl == null || baseUrl.strip().isEmpty() ? null : baseUrl.strip();
        if (!"Pretend (sandbox)".equals(mode) && enabled && baseUrl == null) throw RuleException.database("Give iMonnit's address before switching the connection on");
        if (baseUrl != null && !baseUrl.matches("^https?://.*")) throw RuleException.database("iMonnit's address starts with https://");
        if (readEveryMinutes < 5 || readEveryMinutes > 60) throw RuleException.withCode("Read every 5 to 60 minutes", "23514");
        if (lookbackHours < 2 || lookbackHours > 72) throw RuleException.withCode("Each read looks back 2 to 72 hours", "23514");
    }
}
