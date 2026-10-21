// The sensor feed (0.25.0, migration 045) end to end in the browser, on a fresh test database (seed_035 switches the
// pretend iMonnit connection on at CFL there). Admin > Lab setup > Sensors: the sensors the pretend service lists; the
// Lab Supervisor links the fridge and the 35 °C incubator to the temperature log (signed); QA approves both, feeding
// from 2 days back (signed); Read now; the logbook's hourly entries; the fridge's door-open excursion (its readings,
// REASON NEEDED, the reason given, signed); the incubator's 50-minute silence; QA's Logbook review (an entry without its
// reason cannot be ticked); the equipment page's sensors; who sees and does what.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, call, login, PASSWORD } = require('./auth');
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const session = async (who) => {
    const cookie = await login(BASE, who, PASSWORD);
    const site = (await call(BASE, '/users', { cookie })).data.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
    return async (p, body) => { const res = await fetch(BASE + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site }, body: body ? JSON.stringify(body) : undefined });
      return { ok: res.ok, data: await res.json().catch(() => ({})) }; };
  };
  const pick = async (sel, re) => { const v = await page.evaluate(([s, src]) => { const o = [...document.querySelectorAll(s + ' option')].find((x) => new RegExp(src).test(x.textContent)); return o ? o.value : null; }, [sel, re.source]);
    if (v === null) throw new Error(`no option ${re} in ${sel}`); await page.locator(sel).selectOption(v); };

  // ---- the Lab Supervisor: the page, the sensors, two links
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#/sensors'); await page.waitForSelector('#links');
  check('Admin > Lab setup > Sensors is in the menu; the pretend connection is On', (await page.locator('nav a[href="#/sensors"]').count()) === 1 && /Pretend \(sandbox\)/.test(await page.locator('main').innerText()) && /\bOn\b/.test(await page.locator('main .card').first().innerText()));
  const sensTxt = await page.locator('#sens').innerText();
  check('The sensors iMonnit lists: the fridge, the incubator (battery 18 %, flagged) and the balance room', /501001[\s\S]*Reagent refrigerator 1/.test(sensTxt) && /501002[\s\S]*18 %/.test(sensTxt) && /501003[\s\S]*Balance room/.test(sensTxt) && (await page.locator('#sens .tbfail').count()) >= 1);
  const linkOne = async (sensor, target) => {
    await page.click('#link'); await page.waitForSelector('.modal #f_target');
    await page.locator('.modal #f_external_id').selectOption(sensor); await page.locator('.modal #f_measures').selectOption('temperature');
    await pick('.modal #f_target', target); await page.click('.modal [data-ok]'); await sign(page);
    await page.waitForFunction((s) => /Awaiting QA/.test([...document.querySelectorAll('#links .gtable tr, #links tr')].map((r) => r.innerText).filter((t) => t.includes(s)).join(' ')), sensor, { timeout: 15000 });
  };
  await linkOne('501001', /Reagent refrigerator 1 · LB-\d+ Temperature log · Temperature/);
  await linkOne('501002', /Incubator 35 °C · LB-\d+ Temperature log · Temperature/);
  const linksTxt = await page.locator('#links').innerText();
  check('Links (signed): the fridge and the incubator to the temperature log, awaiting QA, no Approve for the person who linked them',
    (linksTxt.match(/Awaiting QA \(linked by Lab Supervisor/g) || []).length === 2 && !/Approve…/.test(linksTxt));
  const sup = await session('labsup');
  const fridgeTarget = (await sup('/sensors')).data.links.find((x) => x.external_id === '501001');
  const before = await sup('/sensors/read-now', {});
  check('Read now reads nothing for links QA has not approved', before.ok && before.data.readings === 0 && before.data.links === 0, JSON.stringify(before.data));
  const ana = await session('analyst');
  const anaLink = await ana('/sensors/links', { external_id: '501003', measures: 'temperature', logbook_id: fridgeTarget.logbook_id, equipment_id: fridgeTarget.equipment_id, field_key: 'humidity',
    signature: { username: 'analyst', password: PASSWORD } });
  check('The Analyst cannot link a sensor (sensors.configure)', !anaLink.ok && /sensors\.configure/.test(anaLink.data.error || ''), anaLink.data.error);
  await shot('s01_linked');

  // ---- QA approves, feeding from 2 days back
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/sensors'); await page.waitForSelector('#links');
  for (let i = 0; i < 2; i++) {
    await page.locator('#links button', { hasText: 'Approve…' }).first().click();
    await page.waitForSelector('.modal #f_hours_back'); await page.locator('.modal #f_hours_back').selectOption('48'); await page.click('.modal [data-ok]');
    await sign(page); await page.waitForTimeout(1200); await page.waitForSelector('#links');
  }
  const links2 = await page.locator('#links').innerText();
  check('QA approves both (signed): feeding, approved by QA Reviewer', (links2.match(/Feeding · QA: QA Reviewer/g) || []).length === 2, links2.replace(/\s+/g, ' ').slice(0, 300));

  // ---- Read now
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#/sensors'); await page.waitForSelector('#readnow');
  await page.click('#readnow'); await page.waitForFunction(() => /Read: \d+ new readings/.test([...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' ')), null, { timeout: 60000 });
  const t1 = await toasts(); const nRead = Number((/Read: (\d+) new readings, (\d+) entries/.exec(t1) || [])[1]); const nEnt = Number((/Read: (\d+) new readings, (\d+) entries/.exec(t1) || [])[2]);
  check('Read now: two days of readings from both sensors (every 5 minutes), turned into entries', nRead > 1000 && nEnt > 90, t1);
  await page.waitForSelector('#syncs'); await page.waitForTimeout(500);
  check('The read is logged (OK, its readings and entries, who)', /OK[\s\S]*Lab Supervisor \(demo\)/.test(await page.locator('#syncs').innerText()));
  await shot('s02_read');
  const again = await sup('/sensors/read-now', {});
  // (a new 5-minute reading or a newly ended hour may arrive between the two reads)
  check('Reading again adds nothing already kept (no reading twice, no entry twice)', again.ok && again.data.readings <= 2 && again.data.entries <= 2, JSON.stringify(again.data));

  // ---- the logbook
  const d = (await sup('/sensors')).data;
  const fridge = d.links.find((x) => x.external_id === '501001'); const inc = d.links.find((x) => x.external_id === '501002');
  await page.goto(`${BASE}/#/logbooks/${fridge.logbook_id}?tab=entries&equipment=${fridge.equipment_id}`); await page.waitForSelector('#g');
  const entriesTxt = await page.locator('#g').innerText();
  check('The temperature log: the fridge\'s hourly entries ("HH:00 to HH:00"), recorded by the sensor feed', /\d\d:00 to \d\d:00/.test(entriesTxt) && /Sensor feed \(automated\)/.test(entriesTxt));
  check('... and its excursion: outside 2 to 8 °C, peak 9.4 °C, 6 readings, REASON NEEDED', /Temperature outside 2 to 8 °C from [^\n]*peak 9\.4 °C, 6 readings; REASON NEEDED/.test(entriesTxt), (entriesTxt.match(/Temperature outside[^\n]*/) || [''])[0]);
  check('... the hour holding it fails and points to it', /Temperature rose to 9\.4 °C \(above 8\); Reason: See the excursion LBE-\d+/.test(entriesTxt));
  check('... the gateway\'s late readings are in: no silence recorded for the fridge', !/No reading from the sensor/.test(entriesTxt));
  await shot('s03_logbook');
  const exRow = await sup(`/logbooks/${fridge.logbook_id}?equipment=${fridge.equipment_id}`);
  const ex = exRow.data.entries.find((x) => x.sensor && x.sensor.kind === 'Excursion');
  await page.goto(`${BASE}/#/logbooks/entries/${ex.id}`); await page.waitForSelector('main h1');
  const exTxt = await page.locator('main').innerText();
  check('The excursion\'s page: from the sensor, its 6 readings, no Correct (readings are not changed by hand), Give the reason…',
    /From the sensor[\s\S]*Sensor 501001/.test(exTxt) && (await page.locator('main .lb-vals tr').count()) >= 7 && (await page.locator('#correct').count()) === 0 && (await page.locator('#reason').count()) === 1);
  await page.click('#reason'); await page.waitForSelector('.modal #f_why'); await page.fill('.modal #f_why', 'Door left open during the restock; closed at 10:45, stock checked: no product above 8 °C for long'); await page.click('.modal [data-ok]');
  await sign(page); await page.waitForTimeout(1500); await page.waitForSelector('main h1');
  check('The reason is given (signed) and shown; the button is gone', /Reason:\s*Door left open/.test(await page.locator('main').innerText()) && (await page.locator('#reason').count()) === 0);
  await shot('s04_excursion');

  // ---- the incubator's silence and QC Review's window
  const incRows = (await sup(`/logbooks/${inc.logbook_id}?equipment=${inc.equipment_id}`)).data.entries;
  const gap = incRows.find((x) => x.sensor && x.sensor.kind === 'No data');
  check('The incubator\'s sensor silent for 50 minutes: a no-data entry, failing, reason needed', gap && gap.sensor.summary.minutes === 50 && gap.result === 'Fail' && !gap.failure_reason, gap ? JSON.stringify(gap.sensor.summary) : 'none');
  const gapPage = (await sup(`/logbooks/entries/${gap.id}`)).data;
  const same = (a, c) => a && c && new Date(a).getTime() === new Date(c).getTime();
  check('... QC Review would flag any step that used the incubator exactly in that period', gapPage.failure && same(gapPage.failure.window_start, gap.sensor.start) && same(gapPage.failure.window_end, gap.sensor.end),
    gapPage.failure ? `${gapPage.failure.window_start} - ${gapPage.failure.window_end}` : 'no window');
  check('The incubator hours pass (33 to 35 °C against its 30 to 35)', incRows.filter((x) => x.sensor && x.sensor.kind === 'Hour').every((x) => x.result === 'Pass'));

  // ---- QA's Logbook review
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/logbooks/review'); await page.waitForSelector('#g');
  const rv = await page.locator('#g').innerText();
  check('QA\'s Logbook review: the silence shows "Reason needed first" and cannot be ticked', /Reason needed first/.test(rv));
  await page.click('#all'); await page.waitForTimeout(300);
  const ticked = await page.evaluate(() => [...document.querySelectorAll('#g tr')].filter((r) => /Reason needed first/.test(r.innerText) && r.querySelector('.chk.on, input:checked')).length);
  check('"Tick all I may approve" leaves it out', ticked === 0);
  const qa = await session('qa.reviewer');
  const tryGap = await qa('/logbooks/review/approve', { ids: [gap.id], signature: { username: 'qa.reviewer', password: PASSWORD } });
  check('The database refuses QA\'s approval of it too', !tryGap.ok && /needs its reason/.test(tryGap.data.error || ''), tryGap.data.error);
  const okEx = await qa('/logbooks/review/approve', { ids: [ex.id], signature: { username: 'qa.reviewer', password: PASSWORD } });
  check('QA approves the excursion with its reason (signed)', okEx.ok, okEx.data.error);
  await shot('s05_review');

  // ---- 0.25.1: a logbook that cannot take a sensor yet is listed with why
  const draft = await sup('/logbooks', { logbook_name: 'Sensor test draft', kind: 'Temperature', subject: 'Equipment', entry_frequency: 'Daily', review_frequency: 'Weekly', signing: 'Signature' });
  await sup(`/logbooks/${draft.data.id}/equipment`, { rows: [{ equipment_id: fridge.equipment_id }] });
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#/sensors'); await page.waitForSelector('#links');
  check('(0.25.1) "Cannot be linked yet": the draft logbook, with why', new RegExp(`${draft.data.logbook_code} Sensor test draft: ${draft.data.logbook_code} has no approved design yet`).test(await page.locator('#blocked').textContent().catch(() => '')));

  // ---- 0.25.1: limits typed wrongly, then corrected, then the entries judged again
  const lb3 = (await sup(`/logbooks/${inc.logbook_id}`)).data;
  const incRow = lb3.equipment.find((x) => x.equipment_id === inc.equipment_id);
  const setLimits = (lo, hi) => sup(`/logbooks/${inc.logbook_id}/equipment`, { rows: [{ id: incRow.id, limits: { temperature: { min: lo, max: hi } } }], reason: 'Test: incubator limits' });
  await setLimits(10, 30);
  const wrong = await sup(`/sensors/links/${inc.id}/rejudge`, { hours_back: 'all', why: 'Test: judge against 10 to 30', signature: { username: 'labsup', password: PASSWORD } });
  const incE = async () => (await sup(`/logbooks/${inc.logbook_id}?equipment=${inc.equipment_id}`)).data.entries.filter((x) => x.sensor);
  let ie = await incE();
  check('(0.25.1) Against limits typed as 10 to 30: one excursion, still open, and every hour fails', wrong.ok && ie.filter((x) => x.sensor.kind === 'Excursion').length === 1 && !ie.find((x) => x.sensor.kind === 'Excursion').sensor.end
    && ie.filter((x) => x.sensor.kind === 'Hour').every((x) => x.result === 'Fail'), wrong.data.error || '');
  await setLimits(30, 35);
  await sup('/sensors/read-now', {});
  ie = await incE();
  check('(0.25.1) Limits corrected to 30 to 35 and read again: the excursion ends; the hours keep the judgement they were recorded with',
    !!ie.find((x) => x.sensor.kind === 'Excursion').sensor.end && ie.filter((x) => x.sensor.kind === 'Hour').every((x) => x.result === 'Fail'));
  await page.goto(`${BASE}/#/sensors`); await page.waitForSelector('#links');
  const row = page.locator('#links tr', { hasText: '501002' });
  await row.locator('button', { hasText: 'Re-judge…' }).click(); await page.waitForSelector('.modal #f_why');
  await page.locator('.modal #f_hours_back').selectOption('all'); await page.fill('.modal #f_why', 'Limits typed as 10 to 30; corrected to 30 to 35'); await page.click('.modal [data-ok]');
  await sign(page); await page.waitForFunction(() => /Judged again: \d+ entries changed/.test([...document.querySelectorAll('.toast')].map((t) => t.innerText).join(' ')), null, { timeout: 30000 });
  await shot('s06_rejudge');
  ie = await incE();
  const exVoid = (await sup(`/logbooks/${inc.logbook_id}?equipment=${inc.equipment_id}&status=Voided`)).data.entries.find((x) => x.sensor && x.sensor.kind === 'Excursion');
  check('(0.25.1) Re-judge… (signed, a reason): every hour passes again, the excursion is voided saying why and who asked',
    ie.filter((x) => x.sensor.kind === 'Hour').every((x) => x.result === 'Pass') && !ie.some((x) => x.sensor.kind === 'Excursion')
    && exVoid && /^Re-judged against the corrected limits: Limits typed as 10 to 30; corrected to 30 to 35 \(asked by Lab Supervisor \(demo\)\)/.test(exVoid.void_reason || ''), exVoid ? exVoid.void_reason : 'no voided excursion');
  const ch = await sup('/trending/build', { source: 'logbook', params: { logbook_id: inc.logbook_id, field_key: 'temperature', equipment_id: inc.equipment_id } });
  const pnl = ch.data.panels[0];
  check('(0.25.1) Its trend chart: the hours only (no excursion point), none outside its limits', pnl.points.length > 40 && pnl.points.every((p) => /^LBE-/.test(p.label) && !p.out)
    && !(pnl.signals || []).some((s) => s.rule === 'LIM'), `${pnl.points.length} points, ${(pnl.signals || []).filter((s) => s.rule === 'LIM').length} LIM`);

  // ---- the equipment page; who may do what
  await page.goto(`${BASE}/#/equipment/${fridge.equipment_id}`); await page.waitForSelector('#eqsn .card', { timeout: 15000 });
  check('The fridge\'s page shows its sensor: the last reading and the last 24 hours', /501001[\s\S]*\(temperature\): [\d.]+ °C at [\s\S]*last 24 h/.test(await page.locator('#eqsn').innerText()));
  const anaConn = await ana('/sensors/connection', { enabled: false });
  const supConn = await sup('/sensors/connection', { enabled: false });
  check('Only a system administrator changes the connection (not the Analyst, not the Lab Supervisor)', !anaConn.ok && !supConn.ok);
  const supApprove = await sup(`/sensors/links/${fridge.id}/approve`, { signature: { username: 'labsup', password: PASSWORD } });
  check('The Lab Supervisor cannot approve a link (logbook.review)', !supApprove.ok);
  await signIn(page, BASE, 'Analyst (demo)', '#/'); await page.waitForSelector('nav');
  check('The Analyst has no Sensors menu', (await page.locator('nav a[href="#/sensors"]').count()) === 0);

  check('No native browser dialogs', native === 0);
  check('No page errors', !errors.length, errors.slice(0, 3).join(' | '));
  await b.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
