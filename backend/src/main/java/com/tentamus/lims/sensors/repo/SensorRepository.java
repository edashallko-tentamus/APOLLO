package com.tentamus.lims.sensors.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.sensors.domain.SensorConnection;
import com.tentamus.lims.sensors.domain.SensorLink;
import java.time.Instant;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Loads and saves a lab's sensor connection and its sensor links (the rules are in the domain classes). */
@Repository
public class SensorRepository {
    public SensorConnection connection(Db d, String site) {
        Map<String, Object> r = d.one("SELECT * FROM sensor_connection WHERE site_id = ?::uuid FOR UPDATE", site);
        if (r == null) return null;
        SensorConnection c = new SensorConnection();
        c.mode = (String) r.get("mode"); c.baseUrl = (String) r.get("base_url"); c.enabled = Boolean.TRUE.equals(r.get("enabled"));
        c.readEveryMinutes = ((Number) r.get("read_every_minutes")).intValue(); c.lookbackHours = ((Number) r.get("lookback_hours")).intValue();
        return c;
    }

    public void save(Db d, String site, SensorConnection c) {
        d.update("UPDATE sensor_connection SET mode = ?, base_url = ?, enabled = ?::boolean, read_every_minutes = ?::int, lookback_hours = ?::int WHERE site_id = ?::uuid",
            c.mode, c.baseUrl, c.enabled, c.readEveryMinutes, c.lookbackHours, site);
    }

    public SensorLink link(Db d, Object id) {
        Map<String, Object> r = d.one("SELECT * FROM sensor_link WHERE id = ?::uuid FOR UPDATE", id);
        if (r == null) return null;
        SensorLink l = new SensorLink();
        l.id = (String) r.get("id"); l.siteId = (String) r.get("site_id"); l.externalId = (String) r.get("external_id"); l.sensorName = (String) r.get("sensor_name");
        l.measures = (String) r.get("measures"); l.status = (String) r.get("status"); l.createdBy = (String) r.get("created_by"); l.retiredReason = (String) r.get("retired_reason");
        l.gapMinutes = ((Number) r.get("gap_minutes")).intValue();
        l.logbookId = (String) r.get("logbook_id"); l.equipmentId = (String) r.get("equipment_id"); l.fieldKey = (String) r.get("field_key");
        return l;
    }

    /** Whether the logbook can take the sensor (the database's sensor_link_problem, which the Node feed's list uses too). */
    public String problem(Db d, SensorLink l) {
        Map<String, Object> r = d.one("SELECT sensor_link_problem(?::uuid, ?::uuid, ?) AS p", l.logbookId, l.equipmentId, l.fieldKey);
        return r == null ? null : (String) r.get("p");
    }

    public String siteOf(Db d, String table, Object id) {
        Map<String, Object> r = d.one("SELECT site_id FROM " + table + " WHERE id = ?::uuid", id);
        return r == null ? null : (String) r.get("site_id");
    }

    public Map<String, Object> insert(Db d, SensorLink l) {
        return d.one("""
            INSERT INTO sensor_link (site_id, external_id, sensor_name, measures, equipment_id, logbook_id, field_key, gap_minutes, status)
            VALUES (?::uuid, ?, ?, ?, ?::uuid, ?::uuid, ?, ?::int, ?) RETURNING id""",
            l.siteId, l.externalId, l.sensorName, l.measures, l.equipmentId, l.logbookId, l.fieldKey, l.gapMinutes, l.status);
    }

    public void approved(Db d, SensorLink l, String user, Instant from) {
        internal(d, "1");
        d.update("""
            UPDATE sensor_link SET status = ?, approved_by = ?::uuid, approved_at = clock_timestamp(),
                   approval_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid, feeds_from = ?::timestamptz WHERE id = ?::uuid""",
            l.status, user, from.toString(), l.id);
        internal(d, "");
    }

    public void retired(Db d, SensorLink l) {
        internal(d, "1");
        d.update("UPDATE sensor_link SET status = ?, retired_reason = ? WHERE id = ?::uuid", l.status, l.retiredReason, l.id);
        internal(d, "");
    }

    // the database still refuses other changes to a link (the Node feed and Re-judge rely on that guard): this is one of its actions
    private static void internal(Db d, String on) { d.one("SELECT set_config('lims.sensor_internal', ?, true) AS x", on); }
}
