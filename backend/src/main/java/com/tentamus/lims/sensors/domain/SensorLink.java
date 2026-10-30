package com.tentamus.lims.sensors.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.Duration;
import java.time.Instant;

/**
 * A sensor linked to a logbook field and a piece of equipment: linked (signed), approved by QA (signed, not whoever
 * linked it), retired with a reason. Replaces the rule part of the database trigger sensor_link_rules, the checks on
 * the sensor ID and the gap, and the functions approve_sensor_link and retire_sensor_link (migration 070). Whether a
 * logbook can take the sensor ({@code problem}) is the database's sensor_link_problem, still used by the Node feed.
 */
public final class SensorLink {
    public String id, siteId, externalId, sensorName, measures, status = "Awaiting QA", createdBy, retiredReason;
    public int gapMinutes = 30;
    public String logbookId, equipmentId, fieldKey;

    /** A new link: the sensor's ID and gap checked, its logbook and equipment of the sensor's lab and able to take it. */
    public void checkNew(String logbookSite, String equipmentSite, String problem) {
        externalId = externalId == null ? "" : externalId.strip();
        sensorName = sensorName == null || sensorName.strip().isEmpty() ? null : sensorName.strip();
        if (!externalId.matches("^[0-9A-Za-z_-]{1,40}$")) throw RuleException.withCode("The sensor ID is letters, digits, - and _ (40 at most)", "23514");
        if (gapMinutes < 10 || gapMinutes > 1440) throw RuleException.withCode("A silence is 10 to 1440 minutes", "23514");
        if (!siteId.equals(logbookSite) || !siteId.equals(equipmentSite)) throw RuleException.database("The logbook and the equipment must be of the sensor's lab");
        if (problem != null) throw RuleException.database(problem);
        status = "Awaiting QA";
    }

    /** QA's approval: the feed starts from {@code from}, at most 7 days back and never in the future; returns the start used. */
    public Instant approve(String user, String problem, Instant from, Instant now) {
        if (!"Awaiting QA".equals(status)) throw RuleException.database("The link is " + status.toLowerCase());
        if (user.equals(createdBy)) throw RuleException.database("You linked this sensor: someone else in QA approves it");
        if (problem != null) throw RuleException.database(problem);
        if (from.isAfter(now.plus(Duration.ofMinutes(1)))) throw RuleException.database("The feed cannot start in the future");
        if (from.isBefore(now.minus(Duration.ofDays(7)))) throw RuleException.database("The feed starts at most 7 days back");
        status = "Active";
        return from.isBefore(now) ? from : now;
    }

    /** Retiring needs why; a retired link stays retired. */
    public void retire(String why) {
        if ("Retired".equals(status)) throw RuleException.database("The link is already retired");
        if (why == null || why.strip().isEmpty()) throw RuleException.database("Say why the sensor is no longer linked (moved, replaced, equipment retired)");
        status = "Retired";
        retiredReason = why.strip();
    }
}
