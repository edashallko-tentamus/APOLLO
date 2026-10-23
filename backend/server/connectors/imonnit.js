// iMonnit sensor feed: reading and summarizing (Claude Code, 2026-10-19; vault: Proposal - iMonnit Sensor Feed for
// Logbooks and Workflows). Not used by the app yet: it reads sensors and works out what the logbook would record
// (one entry per hour, one per spell outside the limits, one per period with no data). Writing those entries into the
// logbooks is the next step, on Alex's go. Tested against the pretend service (imonnit_mock.js): npm run test:imonnit.
// The message format is ASSUMED where the mock's header says so; everything that depends on it is in normalize().
'use strict';

const MIN = 60000; const HOUR = 60 * MIN;

// ---------------------------------------------------------------- calling iMonnit
// client({ base, token, maxRangeHours, retries, fetchImpl }): listSensors(), messages(sensorId, from, to)
function client({ base, token, maxRangeHours = 24, retries = 3, waitMs = 1000, fetchImpl = fetch }) {
  if (!base || !token) throw new Error('The iMonnit address and key are not set');
  const call = async (method, params = {}) => {
    const q = new URLSearchParams(params).toString();
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${base}/json/${method}/${encodeURIComponent(token)}${q ? '?' + q : ''}`);
      if (res.status === 429 && attempt < retries) { await new Promise((r) => setTimeout(r, waitMs * (attempt + 1))); continue; }
      const body = await res.json().catch(() => null);
      if (res.status === 401) throw new Error('iMonnit refused the key (401)');
      if (!res.ok) throw new Error(`iMonnit answered ${res.status} to ${method}`);
      if (!body || !Array.isArray(body.Result)) throw new Error(`iMonnit ${method}: ${body && body.Result ? body.Result : 'no result'}`);
      return body.Result;
    }
  };
  return {
    calls: 0,
    listSensors() { this.calls++; return call('SensorList'); },
    // one call per maxRangeHours, oldest first
    async messages(sensorId, from, to) {
      const out = [];
      for (let a = from; a < to; a += maxRangeHours * HOUR) {
        const b = Math.min(to, a + maxRangeHours * HOUR);
        this.calls++;
        out.push(...await call('SensorDataMessages', { sensorID: sensorId, fromDate: new Date(a).toISOString(), toDate: new Date(b).toISOString() }));
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- one message to readings
function parseDate(v) {
  if (typeof v === 'number') return v;
  const m = /\/Date\((-?\d+)/.exec(String(v)); if (m) return Number(m[1]);
  const s = String(v);
  return Date.parse(/Z|[+-]\d\d:?\d\d$/.test(s) || !/\d:\d/.test(s) ? s : s + ' UTC');   // no zone given: UTC (to confirm)
}
// a message gives one reading per measured value, in the sensor's own unit (°C, % RH), never the display unit
function normalize(msg) {
  const at = parseDate(msg.MessageDate);
  const types = String(msg.DataTypes || '').split('|'); const vals = String(msg.DataValues ?? msg.Data ?? '').split('|');
  const out = [];
  types.forEach((ty, i) => {
    const v = Number(vals[i]); if (!Number.isFinite(v)) return;
    if (/Temperature/i.test(ty)) out.push({ kind: 'temperature', unit: '°C', value: v });
    else if (/Percentage|Humidity/i.test(ty)) out.push({ kind: 'humidity', unit: '% RH', value: v });
  });
  return out.map((x) => ({ ...x, guid: String(msg.DataMessageGUID), sensorId: Number(msg.SensorID), at, battery: msg.Battery ?? null, signal: msg.SignalStrength ?? null }));
}

// ---------------------------------------------------------------- the lab's hours
// The hour a moment falls in at the lab: key "2026-11-01 01:00 GMT-8" (the offset tells the two 01:00 hours apart when
// daylight saving time ends), and the hour's start and end in UTC.
function hourOf(t, tz) {
  const start = Math.floor(t / HOUR) * HOUR;   // every zone the labs use is a whole number of hours from UTC
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(start)).map((x) => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day} ${p.hour}:00 ${p.timeZoneName}`, start, end: start + HOUR };
}

// ---------------------------------------------------------------- what the logbook would record
// summarize(readings, { lo, hi, gapMinutes, closeAfterHours, tz, now, from, to }) for ONE sensor and measured value:
//  hours: [{ key, start, end, n, min, max, mean, first, last, result 'Pass'|'Fail', excursions: [index], closed }]
//  excursions: [{ start, end, peak, n, readings: [{at, value}], open }]   (consecutive readings outside lo..hi)
//  gaps: [{ from, to, minutes, open }]   (no reading for longer than gapMinutes)
function summarize(readings, { lo = null, hi = null, gapMinutes = 30, closeAfterHours = 2, tz, now, from = null, to = null }) {
  const seen = new Set(); const rs = [];
  for (const r of [...readings].sort((a, b) => a.at - b.at)) { if (seen.has(r.guid)) continue; seen.add(r.guid); rs.push(r); }
  const out = (v) => (lo !== null && v < lo) || (hi !== null && v > hi);
  const excursions = []; let cur = null;
  for (const r of rs) {
    if (out(r.value)) {
      if (!cur) { cur = { start: r.at, end: null, peak: r.value, n: 0, readings: [], open: true }; excursions.push(cur); }
      cur.n++; cur.readings.push({ at: r.at, value: r.value });
      if (Math.abs(r.value - (r.value > (hi ?? Infinity) ? hi : lo)) > Math.abs(cur.peak - (cur.peak > (hi ?? Infinity) ? hi : lo))) cur.peak = r.value;
    } else if (cur) { cur.end = r.at; cur.open = false; cur = null; }   // ends at the first reading back inside
  }
  const gaps = [];
  const limit = gapMinutes * MIN;
  for (let i = 1; i < rs.length; i++) if (rs[i].at - rs[i - 1].at > limit) gaps.push({ from: rs[i - 1].at, to: rs[i].at, minutes: Math.round((rs[i].at - rs[i - 1].at) / MIN), open: false });
  if (from !== null && rs.length && rs[0].at - from > limit) gaps.unshift({ from, to: rs[0].at, minutes: Math.round((rs[0].at - from) / MIN), open: false });
  const tail = rs.length ? rs[rs.length - 1].at : from;
  const upTo = to ?? now;
  if (tail !== null && upTo - tail > limit) gaps.push({ from: tail, to: null, minutes: Math.round((upTo - tail) / MIN), open: true });
  const byHour = new Map();
  for (const r of rs) {
    const h = hourOf(r.at, tz);
    if (!byHour.has(h.key)) byHour.set(h.key, { ...h, n: 0, sum: 0, min: Infinity, max: -Infinity, first: r.at, last: r.at, excursions: [] });
    const x = byHour.get(h.key);
    x.n++; x.sum += r.value; x.min = Math.min(x.min, r.value); x.max = Math.max(x.max, r.value); x.last = r.at;
  }
  const hours = [...byHour.values()].sort((a, b) => a.start - b.start).map((x) => {
    const ex = excursions.map((e, i) => ({ e, i })).filter(({ e }) => e.start < x.end && (e.open ? Infinity : e.end) >= x.start).map(({ i }) => i);
    const { sum, ...h } = x;
    return { ...h, mean: Math.round((sum / x.n) * 100) / 100, result: out(x.min) || out(x.max) ? 'Fail' : 'Pass', excursions: ex, closed: x.end + closeAfterHours * HOUR <= now };
  });
  return { hours, excursions, gaps, readings: rs.length };
}

// what changed since an earlier summary: closed hours whose figures changed (a correction with the reason "late readings
// from the sensor"), hours added after closing, and no-data periods that later readings filled
function changes(before, after) {
  const was = new Map(before.hours.map((h) => [h.key, h]));
  const corrections = []; const lateHours = [];
  for (const h of after.hours) {
    const o = was.get(h.key);
    if (!o) { if (h.closed && before.hours.length && h.start < before.hours[before.hours.length - 1].start) lateHours.push(h); continue; }
    if (o.closed && (o.n !== h.n || o.min !== h.min || o.max !== h.max || o.mean !== h.mean)) corrections.push({ key: h.key, before: o, after: h });
  }
  const filled = before.gaps.filter((g) => !after.gaps.some((x) => x.from === g.from && x.to === g.to && x.open === g.open)
    && !after.gaps.some((x) => x.open && g.open));
  return { corrections, lateHours, filled };
}

// ---------------------------------------------------------------- one read of every linked sensor
// links: [{ sensorId, kind, lo, hi, gapMinutes }]; store: { [sensorId]: readings[] } kept between reads.
// Each read takes the last lookbackHours again, because a gateway that was offline sends its readings later and they
// carry their own (earlier) time.
async function sync({ api, links, store, now, since, lookbackHours = 24 }) {
  const added = {};
  for (const sensorId of [...new Set(links.map((l) => l.sensorId))]) {
    const have = store[sensorId] || (store[sensorId] = []);
    const known = new Set(have.map((r) => r.guid + r.kind));
    const last = have.length ? Math.max(...have.map((r) => r.at)) : since;
    const from = Math.max(since, Math.min(last, now - lookbackHours * HOUR));
    const msgs = await api.messages(sensorId, from, now);
    let n = 0;
    for (const m of msgs) for (const r of normalize(m)) if (!known.has(r.guid + r.kind)) { known.add(r.guid + r.kind); have.push(r); n++; }
    added[sensorId] = n;
  }
  return added;
}

module.exports = { client, normalize, parseDate, hourOf, summarize, changes, sync };
