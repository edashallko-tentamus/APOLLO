package com.tentamus.lims.sensors.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.sensors.domain.SensorConnection;
import com.tentamus.lims.sensors.domain.SensorLink;
import com.tentamus.lims.sensors.repo.SensorRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import org.springframework.stereotype.Service;

/**
 * Sensors: the lab's connection (system administrators), links of sensors to logbooks and equipment (signed), QA's
 * approval, retiring, the Sensors page (with the sensors iMonnit lists), Read now, Re-judge (request_sensor_rejudge,
 * then a read), the reason for a sensor entry's excursion or silence, a piece of equipment's sensors. The feed itself is
 * SensorFeedService.
 */
@Service
public class SensorsService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final SensorRepository sensors;
    private final SensorFeedService feed;

    public SensorsService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, SensorRepository sensors, SensorFeedService feed) {
        this.feed = feed;
        this.sensors = sensors;
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
    }

    private <T> T signed(RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return signatures.signed(ctx, body, new SignatureService.Meaning(meaning, action, "Logbooks"), work);
    }

    private Map<String, Object> linkOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Sensor link not found");
        Map<String, Object> l = db.one("SELECT * FROM sensor_link WHERE id = ?::uuid", id);
        if (l == null) throw new RuleException("Sensor link not found");
        access.checkSite(ctx, (String) l.get("site_id"));
        return l;
    }

    /** Number(v) when v is truthy, else null (the routes' b.x ? Number(b.x) : null). */
    private static Object numOrNull(Object v) { return Js.truthy(v) ? Js.toNumber(v) : null; }

    /** The connection (system administrators). */
    public Map<String, Object> saveConnection(RequestContext ctx, Map<String, Object> body) {
        access.requireSystemAdmin(ctx);
        String site = access.currentSite(ctx);
        return uow.run(ctx.withSite(site).orReason("Sensor connection changed"), d -> {
            SensorConnection c = sensors.connection(d, site);
            if (c == null) return ok();
            if (Js.truthy(body.get("mode"))) c.mode = Js.string(body.get("mode"));
            c.baseUrl = (String) Js.orNull(body.get("base_url"));
            if (body.get("enabled") instanceof Boolean b) c.enabled = b;
            if (numOrNull(body.get("read_every_minutes")) instanceof Double n) c.readEveryMinutes = (int) (double) n;
            if (numOrNull(body.get("lookback_hours")) instanceof Double n) c.lookbackHours = (int) (double) n;
            c.check();
            sensors.save(d, site, c);
            return ok();
        });
    }

    /** A link (signed "Created by"). */
    public Map<String, Object> link(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        String what = "Sensor " + Js.string(body.get("external_id")) + " (" + Js.string(body.get("measures")) + ") linked to a logbook";
        RequestContext c = ctx.withSite(site).orReason("Sensor linked");
        return signed(c, body, "Created by", what, d -> {
            access.require(c, "sensors.configure", "link sensors");
            SensorLink l = new SensorLink();
            l.siteId = site; l.externalId = Js.string(body.get("external_id")).trim(); l.sensorName = (String) Js.orNull(body.get("sensor_name"));
            l.measures = (String) body.get("measures"); l.equipmentId = (String) uuidOrNull(body.get("equipment_id")); l.logbookId = (String) uuidOrNull(body.get("logbook_id"));
            l.fieldKey = body.get("field_key") == null ? null : Js.string(body.get("field_key"));
            if (numOrNull(body.get("gap_minutes")) instanceof Double n) l.gapMinutes = (int) (double) n;
            l.checkNew(sensors.siteOf(d, "logbook", l.logbookId), sensors.siteOf(d, "equipment", l.equipmentId), sensors.problem(d, l));
            return sensors.insert(d, l);
        });
    }

    /** QA's approval (signed), filling in the sensor's readings from 0 to 168 hours back. */
    public Map<String, Object> approve(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> l = linkOf(ctx, id);
        double asked = Js.toNumber(body.get("hours_back"));
        long back = (long) Math.max(0, Math.min(168, Double.isNaN(asked) || !body.containsKey("hours_back") ? 0 : asked));
        return signed(ctx.withSite((String) l.get("site_id")).withReason("Sensor link approved by QA"), body, "Approved by",
            "Sensor " + l.get("external_id") + " (" + l.get("measures") + ") feeding a logbook" + (back != 0 ? ", from " + back + " hours back" : ""),
            d -> {
                SensorLink s = sensors.link(d, l.get("id"));
                access.require(ctx.withSite(s.siteId), "logbook.review", "approve sensor links");
                Instant now = Instant.now();
                Instant from = s.approve(ctx.userId(), sensors.problem(d, s), now.minus(Duration.ofHours(back)), now);
                sensors.approved(d, s, ctx.userId(), from);
                return ok();
            });
    }

    public Map<String, Object> retire(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> l = linkOf(ctx, id);
        String why = Js.string(body.get("why")).trim();
        return signed(ctx.withSite((String) l.get("site_id")).orReason("Sensor link retired"), body, "Changed by", "Retire sensor " + l.get("external_id") + " (" + l.get("measures") + ")",
            d -> {
                SensorLink s = sensors.link(d, l.get("id"));
                access.require(ctx.withSite(s.siteId), "sensors.configure", "retire sensor links");
                s.retire(why);
                sensors.retired(d, s);
                return ok();
            });
    }

    /** The Sensors page: the connection, links, recent reads, what a sensor can feed (and what it cannot yet), iMonnit's sensors. */
    public Map<String, Object> page(RequestContext ctx) {
        String site = access.currentSite(ctx);
        Map<String, Object> conn = db.one("SELECT c.*, u.full_name AS modified_by_name FROM sensor_connection c JOIN app_user u ON u.id = c.modified_by WHERE c.site_id = ?::uuid", site);
        List<Map<String, Object>> links = db.rows("""
            SELECT s.id, s.external_id, s.sensor_name, s.measures, s.equipment_id, e.equipment_code, e.equipment_name, s.logbook_id, l.logbook_code, l.logbook_name,
                  s.field_key, s.gap_minutes, s.status, s.created_by, cu.full_name AS created_by_name, s.created_at, au.full_name AS approved_by_name, s.approved_at, s.feeds_from, s.retired_reason,
                  (SELECT jsonb_build_object('at', r.read_at, 'value', r.value, 'battery', r.battery, 'signal', r.signal) FROM sensor_reading r WHERE r.link_id = s.id ORDER BY r.read_at DESC LIMIT 1) AS last,
                  (SELECT count(*)::int FROM logbook_entry x WHERE x.sensor_link_id = s.id AND x.status <> 'Voided' AND x.result = 'Fail' AND x.failure_reason IS NULL) AS reasons_needed
                FROM sensor_link s JOIN equipment e ON e.id = s.equipment_id JOIN logbook l ON l.id = s.logbook_id JOIN app_user cu ON cu.id = s.created_by
                LEFT JOIN app_user au ON au.id = s.approved_by WHERE s.site_id = ?::uuid ORDER BY s.status = 'Retired', s.external_id, s.measures""", site);
        List<Map<String, Object>> syncs = db.rows("SELECT g.*, u.full_name AS run_by_name FROM sensor_sync_log g LEFT JOIN app_user u ON u.id = g.run_by WHERE g.site_id = ?::uuid ORDER BY g.finished_at DESC LIMIT 12", site);
        // what a sensor can feed: each number field of an approved Equipment logbook, for each piece of equipment it covers
        List<Map<String, Object>> targets = db.rows("""
            SELECT l.id AS logbook_id, l.logbook_code, l.logbook_name, f.field_key, f.label, f.unit, le.equipment_id, e.equipment_code, e.equipment_name,
                  sensor_link_problem(l.id, le.equipment_id, f.field_key) AS problem
                FROM logbook l JOIN logbook_field f ON f.version_id = logbook_effective_version(l.id) AND f.status = 'Active' AND f.field_type = 'Number'
                JOIN logbook_equipment le ON le.logbook_id = l.id AND le.status = 'Active' JOIN equipment e ON e.id = le.equipment_id
               WHERE l.site_id = ?::uuid AND l.status = 'Active' AND l.subject = 'Equipment' ORDER BY l.logbook_code, e.equipment_name, f.sort_order""", site);
        Map<String, Object> me = db.one("SELECT is_admin FROM app_user WHERE id = ?::uuid", ctx.userId());
        // the lab's equipment logbooks a sensor cannot feed yet, and why (0.25.1: the link dialog left them out silently)
        List<Map<String, Object>> blocked = db.rows("""
            SELECT l.logbook_code, l.logbook_name, e.equipment_code, e.equipment_name,
                  CASE WHEN logbook_effective_version(l.id) IS NULL THEN l.logbook_code || ' has no approved design yet (QA approves it on its Design tab)'
                       WHEN NOT EXISTS (SELECT 1 FROM logbook_field f WHERE f.version_id = logbook_effective_version(l.id) AND f.status = 'Active' AND f.field_type = 'Number')
                         THEN l.logbook_code || ' has no number field for a reading'
                       ELSE (SELECT string_agg(DISTINCT sensor_link_problem(l.id, le.equipment_id, f.field_key), '; ') FROM logbook_field f
                              WHERE f.version_id = logbook_effective_version(l.id) AND f.status = 'Active' AND f.field_type = 'Number') END AS problem
                FROM logbook l JOIN logbook_equipment le ON le.logbook_id = l.id AND le.status = 'Active' JOIN equipment e ON e.id = le.equipment_id
               WHERE l.site_id = ?::uuid AND l.status = 'Active' AND l.subject = 'Equipment' AND e.admin_status <> 'Retired' ORDER BY l.logbook_code, e.equipment_name""", site);
        Set<String> linkable = new HashSet<>();
        for (Map<String, Object> x : targets) if (!Js.truthy(x.get("problem"))) linkable.add(x.get("logbook_code") + "|" + x.get("equipment_code"));
        List<Map<String, Object>> sensorList = List.of();
        String sensorsError = null;
        if (conn != null && Boolean.TRUE.equals(conn.get("enabled"))) {
            try { sensorList = feed.listSensors(conn); } catch (RuntimeException e) { sensorsError = SensorFeedService.message(e); }
        }
        UserAccess u = access.load(ctx.userId());
        return map("connection", conn, "links", links, "syncs", syncs, "targets", targets.stream().filter(x -> !Js.truthy(x.get("problem"))).toList(), "sensors", sensorList,
            "blocked", blocked.stream().filter(x -> Js.truthy(x.get("problem")) && !linkable.contains(x.get("logbook_code") + "|" + x.get("equipment_code"))).toList(),
            "sensors_error", sensorsError, "key_set", feed.keySet(), "can_configure", u.can("sensors.configure", site), "can_approve", u.can("logbook.review", site),
            "is_admin", me != null && Js.truthy(me.get("is_admin")), "me", ctx.userId());
    }

    /** Judge a sensor's entries again against the current limits (signed, a reason), then read at once. */
    public Map<String, Object> rejudge(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> l = linkOf(ctx, id);
        String why = Js.string(body.get("why")).trim();
        Object hb = body.get("hours_back");
        Double back = "all".equals(hb) || !Js.truthy(hb) ? null : Math.max(1, Math.min(24 * 90, numOrZero(hb)));
        signed(ctx.withSite((String) l.get("site_id")).orReason("Sensor entries to be judged again"), body, "Changed by",
            "Judge again the entries of sensor " + l.get("external_id") + " (" + l.get("measures") + ")",
            d -> d.one("""
                WITH p AS (SELECT ?::uuid AS link, ?::int AS back)
                SELECT request_sensor_rejudge(p.link, CASE WHEN p.back IS NULL THEN (SELECT feeds_from FROM sensor_link WHERE id = p.link) ELSE clock_timestamp() - make_interval(hours => p.back) END, ?) FROM p""",
                l.get("id"), back, why));
        Map<String, Object> out = new LinkedHashMap<>(feed.runSite((String) l.get("site_id"), System.currentTimeMillis(), ctx.userId()));
        out.put("requested", true);
        return out;
    }

    private static double numOrZero(Object v) { double n = Js.toNumber(v); return Double.isNaN(n) ? 0 : n; }

    /** Read the lab's sensors now (sensors.configure). */
    public Map<String, Object> readNow(RequestContext ctx) {
        String site = access.currentSite(ctx);
        if (!access.load(ctx.userId()).can("sensors.configure", site)) throw new RuleException("You do not have permission to do this: read the sensors now (sensors.configure)");
        Map<String, Object> out = feed.runSite(site, System.currentTimeMillis(), ctx.userId());
        if (Boolean.TRUE.equals(out.get("skipped"))) throw new RuleException("The sensor connection is switched off (a system administrator switches it on)");
        return out;
    }

    /** The reason for a sensor entry's excursion or silence (signed when the logbook signs). */
    public Map<String, Object> entryReason(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Entry not found");
        Map<String, Object> e = db.one("SELECT e.id, e.entry_code, e.site_id, l.signing, l.logbook_code FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id WHERE e.id = ?::uuid", id);
        if (e == null) throw new RuleException("Entry not found");
        access.checkSite(ctx, (String) e.get("site_id"));
        String why = Js.string(body.get("failure_reason")).trim();
        if (why.isEmpty()) throw new RuleException("Give the reason (what happened, what was done about it)");
        RequestContext c = ctx.withSite((String) e.get("site_id")).orReason("Reason given for a sensor excursion");
        Function<Db, Map<String, Object>> go = d -> { d.update("UPDATE logbook_entry SET failure_reason = ? WHERE id = ?::uuid", why, e.get("id")); return ok(); };
        if ("Signature".equals(e.get("signing"))) return signed(c, body, "Changed by", "Reason for " + e.get("entry_code") + " (" + e.get("logbook_code") + ")", go);
        return uow.run(c, go);
    }

    /** A piece of equipment's sensors (the equipment page, the bench's incubator loads). */
    public Map<String, Object> forEquipment(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Equipment not found");
        Map<String, Object> eq = db.one("SELECT id, site_id FROM equipment WHERE id = ?::uuid", id);
        if (eq == null) throw new RuleException("Equipment not found");
        access.checkSite(ctx, (String) eq.get("site_id"));
        return map("rows", db.rows("""
            SELECT s.id, s.external_id, s.sensor_name, s.measures, s.status, s.logbook_id, l.logbook_code, f.unit,
                (SELECT jsonb_build_object('at', r.read_at, 'value', r.value, 'battery', r.battery, 'signal', r.signal) FROM sensor_reading r WHERE r.link_id = s.id ORDER BY r.read_at DESC LIMIT 1) AS last,
                (SELECT jsonb_build_object('n', count(*), 'lo', min(r.value), 'hi', max(r.value)) FROM sensor_reading r WHERE r.link_id = s.id AND r.read_at > clock_timestamp() - interval '24 hours') AS day
              FROM sensor_link s JOIN logbook l ON l.id = s.logbook_id
              LEFT JOIN logbook_field f ON f.version_id = logbook_effective_version(l.id) AND f.field_key = s.field_key AND f.status = 'Active'
             WHERE s.equipment_id = ?::uuid AND s.status <> 'Retired' ORDER BY s.measures""", eq.get("id")));
    }
}
