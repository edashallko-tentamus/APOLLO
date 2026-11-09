package com.tentamus.lims.sensors.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.jobs.SensorFeed;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.sensors.imonnit.ImonnitClient;
import com.tentamus.lims.sensors.imonnit.ImonnitReader;
import com.tentamus.lims.sensors.imonnit.PretendImonnit;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.postgresql.util.PSQLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * The sensor feed (sensor_feed.js): reads each lab's linked sensors from iMonnit (or the pretend service in the
 * Sandbox) and hands the readings to the database, which turns them into logbook entries (sensor_feed_refresh). Runs as
 * the automated account "sensor.feed", signing as the feed, once per link and read; every read of a lab is logged
 * (sensor_sync_log). The iMonnit key is read from the server's environment (LIMS_IMONNIT_KEY), never stored. Database
 * functions still called: sensor_feed_sign, sensor_add_readings, sensor_feed_refresh.
 */
@Service
public class SensorFeedService implements SensorFeed, DisposableBean {
    private static final Logger log = LoggerFactory.getLogger(SensorFeedService.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private final Db db;
    private final UnitOfWork uow;
    private final String key;
    private PretendImonnit pretend;   // the Sandbox's pretend service, started on first use, in this process

    public SensorFeedService(Db db, UnitOfWork uow, @Value("${lims.imonnit-key:}") String key) {
        this.db = db;
        this.uow = uow;
        this.key = key == null ? "" : key;
    }

    public boolean keySet() { return !key.isEmpty(); }

    private synchronized PretendImonnit pretendService() {
        if (pretend == null) pretend = PretendImonnit.start(null, true, null);
        return pretend;
    }

    ImonnitClient clientFor(Map<String, Object> conn) {
        if ("Pretend (sandbox)".equals(conn.get("mode"))) { PretendImonnit m = pretendService(); return new ImonnitClient(m.url(), m.token, 500); }
        if (key.isEmpty()) throw new RuleException("The iMonnit key is not set on the server (LIMS_IMONNIT_KEY)");
        if (!Js.truthy(conn.get("base_url"))) throw new RuleException("iMonnit's address is not set");
        return new ImonnitClient(Js.string(conn.get("base_url")).replaceAll("/+$", ""), key, 1000);
    }

    /** The sensors iMonnit lists for the lab's connection (name, battery, signal, last message). */
    public List<Map<String, Object>> listSensors(Map<String, Object> conn) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> s : clientFor(conn).listSensors()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", Js.string(s.get("SensorID")));
            m.put("name", s.get("SensorName"));
            m.put("battery", s.get("BatteryLevel"));
            m.put("signal", s.get("SignalStrength"));
            Long last = Js.truthy(s.get("LastCommunicationDate")) ? ImonnitReader.parseDate(s.get("LastCommunicationDate")) : null;
            if (Js.truthy(s.get("LastCommunicationDate")) && last == null) throw new RuleException("Invalid time value");
            m.put("last", last == null ? null : ImonnitReader.iso(last));
            m.put("active", !Boolean.FALSE.equals(s.get("IsActive")));
            out.add(m);
        }
        return out;
    }

    static String message(Throwable e) {
        PSQLException pg = ApiExceptionHandler.find(e);
        if (pg != null && pg.getServerErrorMessage() != null && pg.getServerErrorMessage().getMessage() != null) return pg.getServerErrorMessage().getMessage();
        return String.valueOf(e.getMessage());
    }

    private static long ms(Object iso) { return iso == null ? 0 : Instant.parse(iso.toString()).toEpochMilli(); }

    /** One read of a lab: every Active link; {readings, entries, errors, links}, or {skipped, ...} when the connection is off. */
    public Map<String, Object> runSite(String siteId, long now, String runBy) {
        Map<String, Object> conn = db.one("SELECT * FROM sensor_connection WHERE site_id = ?::uuid", siteId);
        Map<String, Object> out = new LinkedHashMap<>();
        if (conn == null || !Boolean.TRUE.equals(conn.get("enabled"))) {
            out.put("skipped", true); out.put("readings", 0); out.put("entries", 0); out.put("errors", List.of());
            return out;
        }
        String feedUser = (String) db.one("SELECT id FROM app_user WHERE username = 'sensor.feed'").get("id");
        List<Map<String, Object>> links = db.rows("SELECT * FROM sensor_link WHERE site_id = ?::uuid AND status = 'Active' ORDER BY external_id, measures", siteId);
        String started = ImonnitReader.iso(System.currentTimeMillis());
        long readings = 0, entries = 0;
        List<String> errors = new ArrayList<>();
        ImonnitClient api = null;
        try { api = clientFor(conn); } catch (RuntimeException e) { errors.add(message(e)); }
        if (api != null) {
            for (Map<String, Object> l : links) {
                try {
                    Object last = db.one("SELECT max(read_at) AS t FROM sensor_reading WHERE link_id = ?::uuid", l.get("id")).get("t");
                    long approved = ms(l.get("feeds_from"));
                    long lastMs = last != null ? ms(last) : approved;
                    // each read takes the last lookback hours again: a gateway that was offline sends its readings late
                    long from = Math.max(approved, Math.min(lastMs, now - ((Number) conn.get("lookback_hours")).longValue() * 3600000L));
                    List<Map<String, Object>> rows = new ArrayList<>();
                    for (Map<String, Object> m : api.messages(l.get("external_id"), from, now)) {
                        for (ImonnitReader.Reading r : ImonnitReader.normalize(m)) {
                            if (!r.kind().equals(l.get("measures"))) continue;
                            if (r.at() == null) throw new RuleException("Invalid time value");
                            Map<String, Object> x = new LinkedHashMap<>();
                            x.put("guid", r.guid()); x.put("at", ImonnitReader.iso(r.at())); x.put("value", new java.math.BigDecimal(Js.number(r.value())));   // 34, not 34.0, as JSON.stringify writes it x.put("battery", r.battery()); x.put("signal", r.signal());
                            rows.add(x);
                        }
                    }
                    String json = JSON.writeValueAsString(rows);
                    RequestContext ctx = new RequestContext(feedUser, siteId, siteId, "Sensor feed: readings from iMonnit", "127.0.0.1");
                    long[] res = uow.run(ctx, t -> {
                        t.one("SELECT set_config('lims.sensor_feed', '1', true)");
                        t.one("SELECT sensor_feed_sign(?) AS x", "Readings of sensor " + l.get("external_id") + " (" + l.get("measures") + ")");
                        Object n = t.one("SELECT sensor_add_readings(?::uuid, ?::jsonb) AS n", l.get("id"), json).get("n");
                        Object x = t.one("SELECT sensor_feed_refresh(?::uuid, ?::timestamptz) AS x", l.get("id"), ImonnitReader.iso(now)).get("x");
                        Map<String, Object> xm = x instanceof com.fasterxml.jackson.databind.JsonNode j ? JSON.convertValue(j, Map.class) : Map.of();
                        return new long[] {(long) Js.toNumber(n), cnt(xm.get("new")) + cnt(xm.get("updated")) + cnt(xm.get("voided"))};
                    });
                    readings += res[0];
                    entries += res[1];
                } catch (Exception e) {
                    errors.add(l.get("external_id") + " (" + l.get("measures") + "): " + message(e));
                }
            }
        }
        String msg = !errors.isEmpty() ? String.join("; ", errors) : links.size() + " sensor" + (links.size() == 1 ? "" : "s") + " read";
        if (!errors.isEmpty() && msg.length() > 2000) msg = msg.substring(0, 2000);
        db.update("INSERT INTO sensor_sync_log (site_id, started_at, ok, readings, entries, message, run_by) VALUES (?::uuid, ?::timestamptz, ?::boolean, ?::int, ?::int, ?, ?::uuid)",
            siteId, started, errors.isEmpty(), readings, entries, msg, runBy);
        out.put("readings", readings); out.put("entries", entries); out.put("errors", errors); out.put("links", links.size());
        return out;
    }

    private static long cnt(Object v) { return Js.truthy(v) ? (long) Js.toNumber(v) : 0; }

    /** The job: every lab whose connection is on, with a sensor feeding, and whose last read is older than its interval. */
    public List<Map<String, Object>> runDueSites() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> d : db.rows("""
            SELECT c.site_id FROM sensor_connection c
             WHERE c.enabled AND EXISTS (SELECT 1 FROM sensor_link s WHERE s.site_id = c.site_id AND s.status = 'Active')
               AND COALESCE((SELECT max(l.finished_at) FROM sensor_sync_log l WHERE l.site_id = c.site_id), '-infinity'::timestamptz) < clock_timestamp() - make_interval(mins => c.read_every_minutes)"""))
            out.add(runSite((String) d.get("site_id"), System.currentTimeMillis(), null));
        return out;
    }

    @Override
    public void runDue() {
        try {
            for (Map<String, Object> r : runDueSites()) {
                @SuppressWarnings("unchecked")
                List<String> errs = (List<String>) r.get("errors");
                if (errs != null && !errs.isEmpty()) log.error("Sensor feed: {}", String.join("; ", errs));
            }
        } catch (RuntimeException e) { log.error("Sensor feed failed: {}", message(e)); }
    }

    @Override
    public void destroy() { if (pretend != null) pretend.close(); }
}
