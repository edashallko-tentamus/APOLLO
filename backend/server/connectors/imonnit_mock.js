// A pretend iMonnit service (Claude Code, 2026-10-19; vault: Proposal - iMonnit Sensor Feed for Logbooks and Workflows).
// Serves known, repeatable sensor readings the way the iMonnit REST API is expected to, so the sensor feed can be built,
// tested and validated without a licence. Nothing in the app starts it; tests do (tests/imonnit_feed_test.js), or run it
// on its own: node server/connectors/imonnit_mock.js [port]
//
// ASSUMED, not confirmed (Monnit's method reference needs an iMonnit sign-in; check before production):
//  - URL form /json/<Method>/<token>?..., the token in the path;
//  - SensorList and SensorDataMessages (sensorID, fromDate, toDate) as the method names, answering {Method, Result};
//  - message fields DataMessageGUID, SensorID, MessageDate "/Date(ms)/" in UTC, Data (°C for temperature),
//    DataValues / DataTypes separated by "|" for a humidity sensor, PlotValues in the account's display unit;
//  - a limit on the range of one call (here 24 hours) and an occasional "too many requests" (HTTP 429).
'use strict';
const http = require('http');

const MIN = 60000;
const TOKEN = 'mock-token';

// repeatable noise
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r1 = (v) => Math.round(v * 10) / 10;
const cToF = (c) => r1(c * 9 / 5 + 32);

// The scenario: 49 hours from 2026-10-31 00:00 to 2026-11-02 00:00 at the lab (America/Los_Angeles), across the end of
// daylight saving time on 2026-11-01 (that day has 25 hours). A reading every 5 minutes from each sensor.
const START = Date.parse('2026-10-31T07:00:00Z');   // 2026-10-31 00:00 PDT
const END = Date.parse('2026-11-02T08:00:00Z');     // 2026-11-02 00:00 PST
const at = (iso) => Date.parse(iso);
const SCENARIO = {
  start: START, end: END, heartbeatMinutes: 5,
  sensors: [
    { id: 501001, name: 'Reagent refrigerator 1', applicationID: 2, kind: 'temperature', base: 4.6, noise: 0.3, seed: 11 },
    { id: 501002, name: 'Incubator 35 C', applicationID: 2, kind: 'temperature', base: 34.0, noise: 0.15, seed: 22 },
    { id: 501003, name: 'Balance room', applicationID: 43, kind: 'humidity', base: 41, noise: 1.5, baseT: 21.0, noiseT: 0.3, seed: 33 },
  ],
  // the fridge door left open: 10:20 to 10:45 on 2026-10-31 (PDT = UTC-7), up to 9.4 °C
  excursion: { sensor: 501001, from: at('2026-10-31T17:20:00Z'), to: at('2026-10-31T17:45:00Z'), values: [8.6, 9.1, 9.4, 9.2, 8.7, 8.2] },
  // the incubator's sensor silent for 45 minutes (14:00 to 14:40 readings missing) and for 15 minutes (18:05, 18:10 missing)
  silent: [{ sensor: 501002, from: at('2026-10-31T21:00:00Z'), to: at('2026-10-31T21:40:00Z') },
    { sensor: 501002, from: at('2026-11-01T01:05:00Z'), to: at('2026-11-01T01:10:00Z') }],
  // the balance room's humidity at 63 % for 10 minutes in the repeated 01:00 hour (01:30 and 01:35 PST)
  humid: { sensor: 501003, from: at('2026-11-01T09:30:00Z'), to: at('2026-11-01T09:35:00Z'), value: 63.0 },
  // the fridge's gateway offline 02:30 to 04:55 on 2026-11-01 (PST): its readings are held and arrive at 09:00
  late: { sensor: 501001, from: at('2026-11-01T10:30:00Z'), to: at('2026-11-01T12:55:00Z'), arrives: at('2026-11-01T17:00:00Z') },
};

function readingsOf(s, sc = SCENARIO) {
  const rand = rng(s.seed); const out = [];
  for (let t = sc.start; t < sc.end; t += sc.heartbeatMinutes * MIN) {
    const n1 = rand() - 0.5; const n2 = rand() - 0.5;
    if (sc.silent.some((g) => g.sensor === s.id && t >= g.from && t <= g.to)) continue;
    let v = r1(s.base + n1 * 2 * s.noise);
    const ex = sc.excursion;
    if (ex.sensor === s.id && t >= ex.from && t <= ex.to) v = ex.values[Math.round((t - ex.from) / (5 * MIN))];
    if (sc.humid.sensor === s.id && t >= sc.humid.from && t <= sc.humid.to) v = sc.humid.value;
    const late = sc.late.sensor === s.id && t >= sc.late.from && t <= sc.late.to;
    const m = { sensorId: s.id, t, value: v, temp: s.kind === 'humidity' ? r1(s.baseT + n2 * 2 * s.noiseT) : null, availableAt: late ? sc.late.arrives : t + 30000 };
    m.guid = `${s.id}-${t}`;
    out.push(m);
  }
  return out;
}

// what the API is expected to answer for one reading
function message(s, m) {
  const base = { DataMessageGUID: '00000000-0000-4000-8000-' + String(m.guid).replace(/\D/g, '').slice(-12).padStart(12, '0'),
    SensorID: s.id, MessageDate: `/Date(${m.t})/`, State: 0, SignalStrength: 84, Voltage: 3.01, Battery: s.id === 501002 ? 18 : 92, GatewayID: 900001 };
  if (s.kind === 'humidity') {
    return { ...base, Data: `${m.value}`, DisplayData: `${m.value}% @ ${cToF(m.temp)}° F`, DataValues: `${m.value}|${m.temp}`, DataTypes: 'Percentage|TemperatureData',
      PlotValues: `${m.value}|${cToF(m.temp)}`, PlotLabels: 'Humidity|Fahrenheit', MetNotificationRequirements: m.value > 60 };
  }
  return { ...base, Data: `${m.value}`, DisplayData: `${cToF(m.value)}° F`, DataValues: `${m.value}`, DataTypes: 'TemperatureData',
    PlotValues: `${cToF(m.value)}`, PlotLabels: 'Fahrenheit', MetNotificationRequirements: m.value > 8 };
}

function parseQueryDate(v) {
  if (!v) return NaN;
  if (/^\d+$/.test(v)) return Number(v);
  return Date.parse(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z');   // no zone given: UTC (assumed)
}

// The same scenario moved so that it ends at `end`, and carried on for `extraDays` (readings as usual after it)
function shifted(end, extraDays = 0) {
  const d = end - SCENARIO.end; const mv = (x) => ({ ...x, from: x.from + d, to: x.to + d, ...(x.arrives ? { arrives: x.arrives + d } : {}) });
  return { ...SCENARIO, start: SCENARIO.start + d, end: end + extraDays * 24 * 60 * MIN, excursion: mv(SCENARIO.excursion), silent: SCENARIO.silent.map(mv), humid: mv(SCENARIO.humid), late: mv(SCENARIO.late) };
}

// start(): { url, close(), setNow(ms), calls[], failNext(n) }
//  - fixed (default): the scenario of 2026-10-31 to 2026-11-02, read as at `now`;
//  - live: the scenario's 49 hours end when the service starts (on the 5 minutes), readings carry on every 5 minutes
//    after that for 30 days, and "now" is the clock (the Sandbox's pretend connection);
//  - endAt: the scenario's 49 hours end then, "now" given by setNow() (tests against the database, which refuses the future).
function start({ port = 0, now = END, token = TOKEN, maxRangeHours = 24, duplicates = true, live = false, endAt = null } = {}) {
  const sc = live ? shifted(Math.floor(Date.now() / (5 * MIN)) * 5 * MIN, 30) : endAt ? shifted(endAt) : SCENARIO;
  const all = new Map(sc.sensors.map((s) => [s.id, readingsOf(s, sc)]));
  const state = { now: live ? null : endAt && now === END ? endAt : now, fail: 0, calls: [] };
  const nowMs = () => (state.now === null ? Date.now() : state.now);
  const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const [, fmt, method, tok] = u.pathname.split('/');
    state.calls.push({ method, query: Object.fromEntries(u.searchParams) });
    if (fmt !== 'json') return send(res, 404, { Method: method, Result: 'Only /json/ is served by the mock' });
    if (tok !== token) return send(res, 401, { Method: method, Result: 'Invalid Authorization Token' });
    if (state.fail > 0) { state.fail--; return send(res, 429, { Method: method, Result: 'Too many requests' }); }
    if (method === 'SensorList') {
      return send(res, 200, { Method: method, Result: sc.sensors.map((s) => ({ SensorID: s.id, SensorName: s.name, MonnitApplicationID: s.applicationID,
        CSNetID: 4001, LastCommunicationDate: `/Date(${Math.min(nowMs(), sc.end)})/`, ReportInterval: sc.heartbeatMinutes, Status: 0, BatteryLevel: s.id === 501002 ? 18 : 92, SignalStrength: 84, IsActive: true })) });
    }
    if (method === 'SensorDataMessages') {
      const s = sc.sensors.find((x) => String(x.id) === u.searchParams.get('sensorID'));
      if (!s) return send(res, 200, { Method: method, Result: 'Invalid SensorID' });
      const from = parseQueryDate(u.searchParams.get('fromDate')); const to = parseQueryDate(u.searchParams.get('toDate'));
      if (!(from < to)) return send(res, 200, { Method: method, Result: 'Invalid date range' });
      if (to - from > maxRangeHours * 60 * MIN) return send(res, 200, { Method: method, Result: `Date range cannot exceed ${maxRangeHours} hours` });
      const rows = all.get(s.id).filter((m) => m.t >= from && m.t <= to && m.t <= nowMs() && m.availableAt <= nowMs()).sort((a, b) => b.t - a.t).map((m) => message(s, m));
      if (duplicates && rows.length > 3) rows.splice(2, 0, rows[1]);   // the same message twice, as a retried upload can give
      return send(res, 200, { Method: method, Result: rows });
    }
    return send(res, 200, { Method: method, Result: 'Unknown method in the mock' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, token,
    setNow: (ms) => { state.now = ms; }, failNext: (n) => { state.fail = n; }, calls: state.calls,
    close: () => new Promise((r) => server.close(r)),
  })));
}

module.exports = { start, SCENARIO, shifted, readingsOf, TOKEN };

if (require.main === module) {
  start({ port: Number(process.argv[2] || 3390) }).then((m) => console.log(`Pretend iMonnit service on ${m.url} (token "${m.token}")`));
}
