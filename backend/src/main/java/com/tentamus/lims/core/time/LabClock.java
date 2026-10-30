package com.tentamus.lims.core.time;

import com.tentamus.lims.core.db.Db;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Today's date in a lab's own time zone: the database function site_today(site), which falls back to UTC. */
@Component
public class LabClock {
    private final Db db;
    private final Clock clock;

    @Autowired
    public LabClock(Db db) { this(db, Clock.systemUTC()); }

    LabClock(Db db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    public LocalDate today(String siteId) {
        return LocalDate.now(clock.withZone(zoneOf(siteId)));
    }

    ZoneId zoneOf(String siteId) {
        if (siteId == null) return ZoneOffset.UTC;
        Map<String, Object> s = db.one("SELECT time_zone FROM lab_site WHERE id = ?", siteId);
        Object tz = s == null ? null : s.get("time_zone");
        return tz == null ? ZoneOffset.UTC : ZoneId.of(tz.toString());
    }
}
