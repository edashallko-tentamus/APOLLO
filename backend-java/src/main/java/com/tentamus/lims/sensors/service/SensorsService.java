package com.tentamus.lims.sensors.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.tentamus.lims.core.access.AccessPolicy;
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
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Service;

/**
 * Sensors: the lab's connection (system administrators), links of sensors to logbooks and equipment (signed), QA's
 * approval, retiring, the reason for a sensor entry's excursion or silence, a piece of equipment's sensors. The feed
 * itself (reading iMonnit or the pretend service: the Sensors page's sensor list, Read now, Re-judge, the minute job)
 * stays in the Node backend for now.
 */
@Service
public class SensorsService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final SensorRepository sensors;

    public SensorsService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, SensorRepository sensors) {
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
