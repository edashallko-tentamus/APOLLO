// The sensor feed (Claude Code, 2026-10-19; migration 045, version 0.25.0): reads each lab's linked sensors from
// iMonnit (or the pretend service in the Sandbox) and hands the readings to the database, which turns them into
// logbook entries (sensor_feed_refresh). Runs as the automated account "sensor.feed", signing as the feed, once per
// link and read; every read of a lab is logged (sensor_sync_log). The iMonnit key is read from the server's
// environment (LIMS_IMONNIT_KEY), never stored in the database.
'use strict';
const F = require('./connectors/imonnit');
const mock = require('./connectors/imonnit_mock');

let pretend = null;   // the Sandbox's pretend service, started on first use, in this process
async function pretendService() { if (!pretend) pretend = await mock.start({ live: true }); return pretend; }

async function clientFor(conn) {
  if (conn.mode === 'Pretend (sandbox)') { const m = await pretendService(); return F.client({ base: m.url, token: m.token, waitMs: 500 }); }
  const key = process.env.LIMS_IMONNIT_KEY;
  if (!key) throw new Error('The iMonnit key is not set on the server (LIMS_IMONNIT_KEY)');
  if (!conn.base_url) throw new Error('iMonnit\'s address is not set');
  return F.client({ base: conn.base_url.replace(/\/+$/, ''), token: key });
}

// the sensors iMonnit lists for the lab's connection (name, battery, signal, last message)
async function listSensors(conn) {
  const api = await clientFor(conn);
  return (await api.listSensors()).map((s) => ({ id: String(s.SensorID), name: s.SensorName, battery: s.BatteryLevel ?? null, signal: s.SignalStrength ?? null,
    last: s.LastCommunicationDate ? new Date(F.parseDate(s.LastCommunicationDate)).toISOString() : null, active: s.IsActive !== false }));
}

// one read of a lab: every Active link; returns { readings, entries, errors }
async function runSite(db, siteId, { now = Date.now(), runBy = null } = {}) {
  const conn = await db.one('SELECT * FROM sensor_connection WHERE site_id = $1', [siteId]);
  if (!conn || !conn.enabled) return { skipped: true, readings: 0, entries: 0, errors: [] };
  const feedUser = (await db.one("SELECT id FROM app_user WHERE username = 'sensor.feed'")).id;
  const links = await db.rows("SELECT * FROM sensor_link WHERE site_id = $1 AND status = 'Active' ORDER BY external_id, measures", [siteId]);
  const started = new Date(); let readings = 0; let entries = 0; const errors = [];
  let api = null;
  try { api = await clientFor(conn); } catch (e) { errors.push(e.message); }
  if (api) {
    for (const l of links) {
      try {
        const last = (await db.one('SELECT max(read_at) AS t FROM sensor_reading WHERE link_id = $1', [l.id])).t;
        const approved = new Date(l.feeds_from).getTime();
        const lastMs = last ? new Date(last).getTime() : approved;
        // each read takes the last lookback hours again: a gateway that was offline sends its readings late
        const from = Math.max(approved, Math.min(lastMs, now - conn.lookback_hours * 3600000));
        const rows = [];
        for (const m of await api.messages(l.external_id, from, now)) {
          for (const r of F.normalize(m)) if (r.kind === l.measures) rows.push({ guid: r.guid, at: new Date(r.at).toISOString(), value: r.value, battery: r.battery, signal: r.signal });
        }
        const res = await db.tx({ userId: feedUser, siteId, reason: 'Sensor feed: readings from iMonnit' }, async (t) => {
          await t.query("SELECT set_config('lims.sensor_feed', '1', true)");
          await t.query('SELECT sensor_feed_sign($1)', [`Readings of sensor ${l.external_id} (${l.measures})`]);
          const n = (await t.one('SELECT sensor_add_readings($1, $2::jsonb) AS n', [l.id, JSON.stringify(rows)])).n;
          const x = (await t.one('SELECT sensor_feed_refresh($1, $2::timestamptz) AS x', [l.id, new Date(now).toISOString()])).x;
          return { n: Number(n), x: typeof x === 'string' ? JSON.parse(x) : x };
        });
        readings += res.n; entries += (res.x.new || 0) + (res.x.updated || 0) + (res.x.voided || 0);
      } catch (e) { errors.push(`${l.external_id} (${l.measures}): ${e.message}`); }
    }
  }
  await db.query('INSERT INTO sensor_sync_log (site_id, started_at, ok, readings, entries, message, run_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [siteId, started.toISOString(), !errors.length, readings, entries, errors.length ? errors.join('; ').slice(0, 2000) : `${links.length} sensor${links.length === 1 ? '' : 's'} read`, runBy]);
  return { readings, entries, errors, links: links.length };
}

// the job: every lab whose connection is on, with a sensor feeding, and whose last read is older than its interval
async function runDue(db) {
  const due = await db.rows(`SELECT c.site_id FROM sensor_connection c
      WHERE c.enabled AND EXISTS (SELECT 1 FROM sensor_link s WHERE s.site_id = c.site_id AND s.status = 'Active') AND COALESCE((SELECT max(l.finished_at) FROM sensor_sync_log l WHERE l.site_id = c.site_id), '-infinity'::timestamptz)
            < clock_timestamp() - make_interval(mins => c.read_every_minutes)`);
  const out = [];
  for (const d of due) out.push(await runSite(db, d.site_id));
  return out;
}

module.exports = { runSite, runDue, listSensors, clientFor };
