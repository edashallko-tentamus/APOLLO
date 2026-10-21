// The iMonnit sensor feed against the pretend iMonnit service (Claude Code, 2026-10-19): npm run test:imonnit.
// No app and no database: the pretend service serves 49 hours of known readings from three sensors (a fridge with an
// excursion and a gateway that sends readings late, an incubator whose sensor goes silent, a humidity sensor across the
// end of daylight saving time), the connector reads them, and every hourly entry, excursion and no-data period is
// checked against figures worked out here independently from the scenario.
'use strict';
const path = require('path');
const mock = require(path.join(__dirname, '..', 'server', 'connectors', 'imonnit_mock.js'));
const F = require(path.join(__dirname, '..', 'server', 'connectors', 'imonnit.js'));

const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
const TZ = 'America/Los_Angeles'; const MIN = 60000;
const S = mock.SCENARIO;
const FRIDGE = 501001; const INC = 501002; const ROOM = 501003;
const NOW1 = Date.parse('2026-11-01T16:00:00Z');   // 08:00 PST on 2026-11-01
const links = [{ sensorId: FRIDGE, kind: 'temperature', lo: 2, hi: 8 }, { sensorId: INC, kind: 'temperature', lo: 33, hi: 35 },
  { sensorId: ROOM, kind: 'humidity', lo: 30, hi: 60 }, { sensorId: ROOM, kind: 'temperature', lo: 18, hi: 25 }];
const of = (store, l) => (store[l.sensorId] || []).filter((r) => r.kind === l.kind);
const sum = (store, l, now) => F.summarize(of(store, l), { lo: l.lo, hi: l.hi, tz: TZ, now, from: S.start, to: Math.min(now, S.end) });

// the expected figures, worked out from the scenario without the connector
function expected(sensorId, kind, now) {
  const s = S.sensors.find((x) => x.id === sensorId);
  const rs = mock.readingsOf(s).filter((m) => m.t <= now && m.availableAt <= now).map((m) => ({ t: m.t, v: kind === 'temperature' && s.kind === 'humidity' ? m.temp : m.value }));
  const hours = new Map();
  for (const r of rs) {
    const local = new Date(r.t).toLocaleString('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', timeZoneName: 'shortOffset' });
    const h = hours.get(local) || hours.set(local, []).get(local); h.push(r.v);
  }
  return { n: rs.length, hours: [...hours.values()].map((v) => ({ n: v.length, min: Math.min(...v), max: Math.max(...v), mean: Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 })) };
}

(async () => {
  const m = await mock.start({ now: NOW1 });
  try {
    // ---- the connection
    const bad = F.client({ base: m.url, token: 'wrong-key' });
    let err = ''; try { await bad.listSensors(); } catch (e) { err = e.message; }
    check('A wrong key is refused', /refused the key/.test(err), err);
    const api = F.client({ base: m.url, token: m.token, maxRangeHours: 24, waitMs: 10 });
    const sensors = await api.listSensors();
    check('The sensor list: three sensors, the incubator\'s battery low (18 %)', sensors.length === 3 && sensors.find((x) => x.SensorID === INC).BatteryLevel === 18);

    // ---- first read, 08:00 on 2026-11-01
    m.failNext(1);
    const before429 = m.calls.length;
    const store = {};
    const added1 = await F.sync({ api, links, store, now: NOW1, since: S.start });
    const calls = m.calls.slice(before429);
    check('"Too many requests" is waited out and the call tried again', calls.filter((c) => c.method === 'SensorDataMessages').length === 7, `${calls.length} calls`);
    check('Each call asks for 24 hours at most (33 hours = 2 calls per sensor)', calls.filter((c) => c.method === 'SensorDataMessages').every((c) => Date.parse(c.query.toDate) - Date.parse(c.query.fromDate) <= 24 * 60 * MIN));
    const e1 = expected(FRIDGE, 'temperature', NOW1);
    check('A message received twice is kept once (fridge: exactly the readings sent)', of(store, links[0]).length === e1.n && added1[FRIDGE] === e1.n, `${of(store, links[0]).length} of ${e1.n}`);
    const msgs = await api.messages(ROOM, S.start, S.start + 10 * MIN);
    const one = F.normalize(msgs[0]);
    check('Values are taken in the sensor\'s own unit (°C, % RH), not iMonnit\'s display unit (°F)',
      one.length === 2 && one[0].unit === '% RH' && one[1].unit === '°C' && one[1].value < 30 && Number(msgs[0].PlotValues.split('|')[1]) > 60, JSON.stringify(one.map((x) => x.value + ' ' + x.unit)));

    // ---- the fridge: hours and the excursion
    const f1 = sum(store, links[0], NOW1);
    const ex = f1.excursions;
    check('The fridge\'s door left open is one excursion: 10:20 to 10:50, 6 readings, peak 9.4 °C',
      ex.length === 1 && ex[0].n === 6 && ex[0].peak === 9.4 && ex[0].start === Date.parse('2026-10-31T17:20:00Z') && ex[0].end === Date.parse('2026-10-31T17:50:00Z') && !ex[0].open,
      ex.map((x) => `${new Date(x.start).toISOString()} n${x.n} peak ${x.peak}`).join(', '));
    const h10 = f1.hours.find((h) => h.key === '2026-10-31 10:00 GMT-7');
    check('Its hourly entry (10:00) fails and points to the excursion; every other hour passes',
      h10 && h10.result === 'Fail' && h10.excursions[0] === 0 && h10.max === 9.4 && f1.hours.filter((h) => h.result === 'Fail').length === 1);
    const e1h = expected(FRIDGE, 'temperature', NOW1).hours;
    check('Every hourly figure (readings, minimum, maximum, average) matches the scenario',
      f1.hours.length === e1h.length && f1.hours.every((h, i) => h.n === e1h[i].n && h.min === e1h[i].min && h.max === e1h[i].max && h.mean === e1h[i].mean), `${f1.hours.length} hours`);
    check('Hours end-of-hour plus 2 hours in the past are closed; the last two are still open',
      f1.hours.filter((h) => !h.closed).length === 2 && f1.hours.find((h) => h.key === '2026-11-01 05:00 GMT-8').closed);
    const g1 = f1.gaps;
    check('The fridge\'s gateway offline from 02:25: a period with no data (155 minutes)', g1.length === 1 && g1[0].minutes === 155 && !g1[0].open, JSON.stringify(g1.map((g) => g.minutes)));

    // ---- the incubator: silences
    const inc = sum(store, links[1], NOW1);
    check('The incubator silent for 50 minutes is a no-data period; silent for 15 minutes is not (limit 30)',
      inc.gaps.length === 1 && inc.gaps[0].minutes === 50 && inc.gaps[0].from === Date.parse('2026-10-31T20:55:00Z'), JSON.stringify(inc.gaps.map((g) => g.minutes)));

    // ---- the balance room across the end of daylight saving time
    const hum = sum(store, links[2], NOW1);
    const one00 = hum.hours.filter((h) => h.key.startsWith('2026-11-01 01:00'));
    check('Daylight saving time ends: two 01:00 hours (GMT-7 and GMT-8), 12 readings each', one00.length === 2 && one00.every((h) => h.n === 12), one00.map((h) => h.key + ' n' + h.n).join(', '));
    check('The humidity at 63 % for 10 minutes: an excursion in the second 01:00 hour only',
      hum.excursions.length === 1 && hum.excursions[0].n === 2 && hum.excursions[0].peak === 63 && one00[1].result === 'Fail' && one00[0].result === 'Pass');
    const rt = sum(store, links[3], NOW1);
    check('The same sensor\'s temperature has its own hourly entries, all passing', rt.hours.length === hum.hours.length && rt.hours.every((h) => h.result === 'Pass'));

    // ---- second read, midnight: the fridge's late readings arrive
    const NOW2 = S.end;
    m.setNow(NOW2);
    const short = JSON.parse(JSON.stringify(store));
    await F.sync({ api, links: [links[0]], store: short, now: NOW2, since: S.start, lookbackHours: 2 });
    check('(design finding) Reading back only 2 hours misses the late readings', of(short, links[0]).length < expected(FRIDGE, 'temperature', NOW2).n);
    await F.sync({ api, links, store, now: NOW2, since: S.start });
    const f2 = sum(store, links[0], NOW2);
    const ch = F.changes(f1, f2);
    check('Reading back 24 hours catches them: the fridge now has every reading', of(store, links[0]).length === expected(FRIDGE, 'temperature', NOW2).n);
    check('The closed 02:00 hour is corrected (6 readings, now 12): "late readings from the sensor"',
      ch.corrections.length === 1 && ch.corrections[0].key === '2026-11-01 02:00 GMT-8' && ch.corrections[0].before.n === 6 && ch.corrections[0].after.n === 12, ch.corrections.map((c) => c.key).join(', '));
    check('The 03:00 and 04:00 hours are added late, and the no-data period is filled', ch.lateHours.map((h) => h.key).join() === '2026-11-01 03:00 GMT-8,2026-11-01 04:00 GMT-8'
      && ch.filled.length === 1 && f2.gaps.length === 0);
    const all = links.map((l) => sum(store, l, NOW2));
    check('49 hourly entries per sensor and value (2026-11-01 has 25 hours)', all.every((x) => x.hours.length === 49), all.map((x) => x.hours.length).join(','));
    const e2 = [expected(FRIDGE, 'temperature', NOW2), expected(INC, 'temperature', NOW2), expected(ROOM, 'humidity', NOW2), expected(ROOM, 'temperature', NOW2)];
    check('Every hourly figure of every sensor matches the scenario', all.every((x, i) => x.hours.every((h, j) => h.n === e2[i].hours[j].n && h.min === e2[i].hours[j].min && h.max === e2[i].hours[j].max && h.mean === e2[i].hours[j].mean)));
    check('Nothing open at midnight: no open excursion, no open no-data period', all.every((x) => !x.excursions.some((e) => e.open) && !x.gaps.some((g) => g.open)));

    // ---- a sensor that stops
    const stopNow = S.end + 50 * MIN;
    const st = F.summarize(of(store, links[1]), { lo: 33, hi: 35, tz: TZ, now: stopNow, from: S.start });
    check('A sensor that stops sending shows an open no-data period from its last reading', st.gaps.some((g) => g.open && g.from === S.end - 5 * MIN && g.minutes === 55));
  } finally { await m.close(); }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
