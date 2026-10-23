// Sensors (Claude Code, 2026-10-19; migration 045, version 0.25.0): Admin > Lab setup > Sensors. The lab's connection
// to iMonnit (system administrators), the sensors iMonnit lists, the links of sensors to logbooks and equipment
// (sensors.configure links and retires, signed; QA approves, signed), each read of the sensors, "Read now"; the reason
// for a sensor entry's excursion or silence; a piece of equipment's sensors. Thin: every rule lives in the database.
'use strict';
const feed = require('./sensor_feed');

module.exports = function registerSensors({ route, tx, signedTx, currentSite, checkSite, hasPermission, requireSystemAdmin, isUuid, AUDIT_LISTS }) {
  const r = route;
  AUDIT_LISTS.sensors = ['sensor_connection', 'sensor_link'];
  const linkOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Sensor link not found');
    const l = await c.db.one('SELECT * FROM sensor_link WHERE id = $1', [id]);
    if (!l) throw new Error('Sensor link not found');
    await checkSite(c, l.site_id);
    return l;
  };

  r('GET', '/api/sensors', async (c) => {
    const site = await currentSite(c);
    const conn = await c.db.one('SELECT c.*, u.full_name AS modified_by_name FROM sensor_connection c JOIN app_user u ON u.id = c.modified_by WHERE c.site_id = $1', [site]);
    const [links, syncs, targets, me] = await Promise.all([
      c.db.rows(`SELECT s.id, s.external_id, s.sensor_name, s.measures, s.equipment_id, e.equipment_code, e.equipment_name, s.logbook_id, l.logbook_code, l.logbook_name,
            s.field_key, s.gap_minutes, s.status, s.created_by, cu.full_name AS created_by_name, s.created_at, au.full_name AS approved_by_name, s.approved_at, s.feeds_from, s.retired_reason,
            (SELECT jsonb_build_object('at', r.read_at, 'value', r.value, 'battery', r.battery, 'signal', r.signal) FROM sensor_reading r WHERE r.link_id = s.id ORDER BY r.read_at DESC LIMIT 1) AS last,
            (SELECT count(*)::int FROM logbook_entry x WHERE x.sensor_link_id = s.id AND x.status <> 'Voided' AND x.result = 'Fail' AND x.failure_reason IS NULL) AS reasons_needed
          FROM sensor_link s JOIN equipment e ON e.id = s.equipment_id JOIN logbook l ON l.id = s.logbook_id JOIN app_user cu ON cu.id = s.created_by
          LEFT JOIN app_user au ON au.id = s.approved_by WHERE s.site_id = $1 ORDER BY s.status = 'Retired', s.external_id, s.measures`, [site]),
      c.db.rows(`SELECT g.*, u.full_name AS run_by_name FROM sensor_sync_log g LEFT JOIN app_user u ON u.id = g.run_by WHERE g.site_id = $1 ORDER BY g.finished_at DESC LIMIT 12`, [site]),
      // what a sensor can feed: each number field of an approved Equipment logbook, for each piece of equipment it covers
      c.db.rows(`SELECT l.id AS logbook_id, l.logbook_code, l.logbook_name, f.field_key, f.label, f.unit, le.equipment_id, e.equipment_code, e.equipment_name,
            sensor_link_problem(l.id, le.equipment_id, f.field_key) AS problem
          FROM logbook l JOIN logbook_field f ON f.version_id = logbook_effective_version(l.id) AND f.status = 'Active' AND f.field_type = 'Number'
          JOIN logbook_equipment le ON le.logbook_id = l.id AND le.status = 'Active' JOIN equipment e ON e.id = le.equipment_id
         WHERE l.site_id = $1 AND l.status = 'Active' AND l.subject = 'Equipment' ORDER BY l.logbook_code, e.equipment_name, f.sort_order`, [site]),
      c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]),
    ]);
    // the lab's equipment logbooks a sensor cannot feed yet, and why (0.25.1: the link dialog left them out silently)
    const blocked = await c.db.rows(`SELECT l.logbook_code, l.logbook_name, e.equipment_code, e.equipment_name,
          CASE WHEN logbook_effective_version(l.id) IS NULL THEN l.logbook_code || ' has no approved design yet (QA approves it on its Design tab)'
               WHEN NOT EXISTS (SELECT 1 FROM logbook_field f WHERE f.version_id = logbook_effective_version(l.id) AND f.status = 'Active' AND f.field_type = 'Number')
                 THEN l.logbook_code || ' has no number field for a reading'
               ELSE (SELECT string_agg(DISTINCT sensor_link_problem(l.id, le.equipment_id, f.field_key), '; ') FROM logbook_field f
                      WHERE f.version_id = logbook_effective_version(l.id) AND f.status = 'Active' AND f.field_type = 'Number') END AS problem
        FROM logbook l JOIN logbook_equipment le ON le.logbook_id = l.id AND le.status = 'Active' JOIN equipment e ON e.id = le.equipment_id
       WHERE l.site_id = $1 AND l.status = 'Active' AND l.subject = 'Equipment' AND e.admin_status <> 'Retired' ORDER BY l.logbook_code, e.equipment_name`, [site]);
    const linkable = new Set(targets.filter((x) => !x.problem).map((x) => `${x.logbook_code}|${x.equipment_code}`));
    let sensors = []; let sensorsError = null;
    if (conn && conn.enabled) { try { sensors = await feed.listSensors(conn); } catch (e) { sensorsError = e.message; } }
    return { connection: conn, links, syncs, targets: targets.filter((x) => !x.problem), sensors,
      blocked: blocked.filter((x) => x.problem && !linkable.has(`${x.logbook_code}|${x.equipment_code}`)), sensors_error: sensorsError, key_set: !!process.env.LIMS_IMONNIT_KEY,
      can_configure: await hasPermission(c, 'sensors.configure', site), can_approve: await hasPermission(c, 'logbook.review', site), is_admin: !!(me && me.is_admin), me: c.userId };
  });

  // the connection (system administrators)
  r('POST', '/api/sensors/connection', async (c) => {
    await requireSystemAdmin(c);
    const site = await currentSite(c);
    const b = c.body || {};
    return tx({ ...c, siteId: site, reason: b.reason || 'Sensor connection changed' }, async (t) => {
      await t.query(`UPDATE sensor_connection SET mode = COALESCE($2, mode), base_url = $3, enabled = COALESCE($4, enabled),
          read_every_minutes = COALESCE($5, read_every_minutes), lookback_hours = COALESCE($6, lookback_hours) WHERE site_id = $1`,
      [site, b.mode || null, b.base_url || null, typeof b.enabled === 'boolean' ? b.enabled : null, b.read_every_minutes ? Number(b.read_every_minutes) : null, b.lookback_hours ? Number(b.lookback_hours) : null]);
      return { ok: true };
    });
  });

  // a link (signed "Created by"); QA's approval (signed "Approved by"); retiring it (signed, with a reason)
  r('POST', '/api/sensors/links', async (c) => {
    const site = await currentSite(c);
    const b = c.body || {};
    const what = `Sensor ${b.external_id || ''} (${b.measures || ''}) linked to a logbook`;
    return signedTx({ ...c, siteId: site, reason: b.reason || 'Sensor linked' }, { meaning: 'Created by', action: what, module: 'Logbooks' }, async (t) =>
      t.one(`INSERT INTO sensor_link (site_id, external_id, sensor_name, measures, equipment_id, logbook_id, field_key, gap_minutes) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 30)) RETURNING id`,
        [site, String(b.external_id || '').trim(), b.sensor_name || null, b.measures, isUuid(b.equipment_id) ? b.equipment_id : null, isUuid(b.logbook_id) ? b.logbook_id : null, b.field_key, b.gap_minutes ? Number(b.gap_minutes) : null]));
  });
  r('POST', '/api/sensors/links/:id/approve', async (c) => {
    const l = await linkOf(c, c.params.id);
    // fill in the sensor's recent readings: 0 (from now) to 168 hours back
    const back = Math.max(0, Math.min(168, Number((c.body || {}).hours_back) || 0));
    return signedTx({ ...c, siteId: l.site_id, reason: 'Sensor link approved by QA' }, { meaning: 'Approved by', action: `Sensor ${l.external_id} (${l.measures}) feeding a logbook${back ? `, from ${back} hours back` : ''}`, module: 'Logbooks' },
      async (t) => { await t.query("SELECT approve_sensor_link($1, clock_timestamp() - make_interval(hours => $2::int))", [l.id, back]); return { ok: true }; });
  });
  r('POST', '/api/sensors/links/:id/retire', async (c) => {
    const l = await linkOf(c, c.params.id);
    const why = String((c.body || {}).why || '').trim();
    return signedTx({ ...c, siteId: l.site_id, reason: (c.body || {}).reason || 'Sensor link retired' }, { meaning: 'Changed by', action: `Retire sensor ${l.external_id} (${l.measures})`, module: 'Logbooks' },
      async (t) => { await t.query('SELECT retire_sensor_link($1, $2)', [l.id, why]); return { ok: true }; });
  });

  // judge a sensor's entries again against the current limits (0.25.1): asked for (signed, a reason), then read at once
  r('POST', '/api/sensors/links/:id/rejudge', async (c) => {
    const l = await linkOf(c, c.params.id);
    const b = c.body || {};
    const why = String(b.why || '').trim();
    const back = b.hours_back === 'all' || !b.hours_back ? null : Math.max(1, Math.min(24 * 90, Number(b.hours_back) || 0));
    await signedTx({ ...c, siteId: l.site_id, reason: b.reason || 'Sensor entries to be judged again' }, { meaning: 'Changed by', action: `Judge again the entries of sensor ${l.external_id} (${l.measures})`, module: 'Logbooks' },
      (t) => t.query(`SELECT request_sensor_rejudge($1, CASE WHEN $2::int IS NULL THEN (SELECT feeds_from FROM sensor_link WHERE id = $1) ELSE clock_timestamp() - make_interval(hours => $2::int) END, $3)`, [l.id, back, why]));
    const out = await feed.runSite(c.db, l.site_id, { runBy: c.userId });
    return { ...out, requested: true };
  });

  // read the lab's sensors now (sensors.configure)
  r('POST', '/api/sensors/read-now', async (c) => {
    const site = await currentSite(c);
    if (!(await hasPermission(c, 'sensors.configure', site))) throw new Error('You do not have permission to do this: read the sensors now (sensors.configure)');
    const out = await feed.runSite(c.db, site, { runBy: c.userId });
    if (out.skipped) throw new Error('The sensor connection is switched off (a system administrator switches it on)');
    return out;
  });

  // the reason for a sensor entry's excursion or silence (signed when the logbook signs)
  r('POST', '/api/logbooks/entries/:id/reason', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Entry not found');
    const e = await c.db.one('SELECT e.id, e.entry_code, e.site_id, l.signing, l.logbook_code FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id WHERE e.id = $1', [c.params.id]);
    if (!e) throw new Error('Entry not found');
    await checkSite(c, e.site_id);
    const why = String((c.body || {}).failure_reason || '').trim();
    if (!why) throw new Error('Give the reason (what happened, what was done about it)');
    const go = async (t) => { await t.query('UPDATE logbook_entry SET failure_reason = $2 WHERE id = $1', [e.id, why]); return { ok: true }; };
    const ctx = { ...c, siteId: e.site_id, reason: (c.body || {}).reason || 'Reason given for a sensor excursion' };
    if (e.signing === 'Signature') return signedTx(ctx, { meaning: 'Changed by', action: `Reason for ${e.entry_code} (${e.logbook_code})`, module: 'Logbooks' }, go);
    return tx(ctx, go);
  });

  // a piece of equipment's sensors (the equipment page, the bench's incubator loads)
  r('GET', '/api/sensors/equipment/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Equipment not found');
    const eq = await c.db.one('SELECT id, site_id FROM equipment WHERE id = $1', [c.params.id]);
    if (!eq) throw new Error('Equipment not found');
    await checkSite(c, eq.site_id);
    const rows = await c.db.rows(`SELECT s.id, s.external_id, s.sensor_name, s.measures, s.status, s.logbook_id, l.logbook_code, f.unit,
          (SELECT jsonb_build_object('at', r.read_at, 'value', r.value, 'battery', r.battery, 'signal', r.signal) FROM sensor_reading r WHERE r.link_id = s.id ORDER BY r.read_at DESC LIMIT 1) AS last,
          (SELECT jsonb_build_object('n', count(*), 'lo', min(r.value), 'hi', max(r.value)) FROM sensor_reading r WHERE r.link_id = s.id AND r.read_at > clock_timestamp() - interval '24 hours') AS day
        FROM sensor_link s JOIN logbook l ON l.id = s.logbook_id
        LEFT JOIN logbook_field f ON f.version_id = logbook_effective_version(l.id) AND f.field_key = s.field_key AND f.status = 'Active'
       WHERE s.equipment_id = $1 AND s.status <> 'Retired' ORDER BY s.measures`, [eq.id]);
    return { rows };
  });
};
