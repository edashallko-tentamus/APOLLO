// Trending and control charts (T-1, migration 043; seed_034's demo charts) end to end in the browser, on a fresh
// database, plus the control counted 0 (migration 042): USP <51> version 2's verification now passes.
//  - Trend watch: one tile per chart (one per fridge, incubator and chamber on the temperature log), the signals to
//    review first, a filter for them; Trending is in the menu for the Lab Supervisor and the Analyst, not for the
//    Account Manager;
//  - a saved chart: a signal reviewed (outcome and what was found), the moving range, histogram and data views, and
//    the five downloads (PNG, SVG, CSV, Excel, PDF);
//  - the builder: every piece of equipment on the temperature log drawn at once; OOS per month saved as a new chart;
//  - frozen limits on a count chart (a reason asked, the baseline shown); freezing a chart with a panel per
//    equipment is refused; the Analyst cannot save charts;
//  - a report pack shown and downloaded as a PDF;
//  - QC Review shows the QC charts applied to the batch's test.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, call, login } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const session = async (who) => {
    const cookie = await login(BASE, who, PASSWORD);
    const users = (await call(BASE, '/users', { cookie })).data;
    const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
    return async (p, opts = {}) => {
      const res = await fetch(BASE + '/api' + p, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site }, body: opts.body ? JSON.stringify(opts.body) : undefined });
      return { ok: res.ok, data: await res.json().catch(() => ({})) };
    };
  };
  const reason = async () => { await page.waitForSelector('.sigmodal #f_rpick'); await page.locator('.sigmodal #f_rpick').selectOption({ index: 1 }); await page.click('.sigmodal [data-ok]'); };
  const download = async (sel) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click(sel)]); const f = path.join(OUT, 'dl_' + d.suggestedFilename()); await d.saveAs(f); return { name: d.suggestedFilename(), size: fs.statSync(f).size, file: f }; };

  // ---- the control counted 0 (042): USP <51> version 2's verification
  {
    const as = async (who) => { const s = await session(who); return { post: async (p, body) => s(p, { body: { ...body, signature: { username: who, password: PASSWORD } } }), get: s }; };
    const ana = await as('analyst'); const qa = await as('qa.reviewer');
    const t51 = (await ana.get('/trending/options')).data.tests.find((t) => /^USP <51>/.test(t.test_name));
    const vs = (await ana.get('/methods/tests/' + t51.id)).data.versions; const v2 = vs.find((v) => v.version_no === 2);
    const w = (await ana.post(`/verification/versions/${v2.id}/protocol`, {})).data; await qa.post(`/verification/${w.id}/approve-protocol`, {});
    const run = (await ana.post(`/verification/${w.id}/execute`, {})).data;
    check('USP <51> version 2: the verification passes (a negative control counted 0 is judged on its count; its log is not needed)', run.outcome === 'Pass', run.outcome || JSON.stringify(run).slice(0, 200));
  }

  const sup = await session('labsup');
  const charts = (await sup('/trending/charts')).data.rows;
  const byCode = (c) => charts.find((x) => x.chart_code === c);
  check('(seed_034: eight demo charts, TC-0001 the temperature log and TC-0005 the ICP-MS LCS recovery shown in QC Review)',
    charts.length === 8 && /temperatures/.test(byCode('TC-0001').chart_name) && byCode('TC-0005').show_in_review);

  // ---- Trend watch
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#/trending'); await page.waitForSelector('.trtile');
  const tiles = await page.locator('.trtile').allInnerTexts();
  check('Trending is in the Testing menu; Trend watch has a tile per fridge, incubator and chamber on the temperature log',
    (await page.locator('nav a[href="#/trending"]').count()) === 1 && tiles.filter((t) => /^EQ-\d+[\s\S]*Storage and incubation temperatures · TC-0001/.test(t)).length === 6, `${tiles.length} tiles`);
  check('The charts with signals to review come first, marked; a frozen or QC Review chart is labelled',
    /to review/.test(tiles[0]) && (await page.locator('.trtile.open').count()) >= 2 && tiles.some((t) => /In QC Review/.test(t)));
  await shot('t01_watch');
  await page.check('#onlyopen'); await page.waitForFunction(() => /show=open/.test(location.hash));
  // wait for the redraw (the old tiles are still there for a moment after ticking; Claude Code, 0.24.1)
  await page.waitForFunction(() => { const t = document.querySelectorAll('.trtile'); return t.length && [...t].every((x) => x.classList.contains('open')); }, null, { timeout: 15000 }).catch(() => {});
  check('"Only charts with signals to review" leaves only those', (await page.locator('.trtile').count()) === (await page.locator('.trtile.open').count()) && (await page.locator('.trtile').count()) >= 2);

  // ---- a saved chart: review a signal, the views, the downloads
  const tc1 = byCode('TC-0001');
  await page.goto(`${BASE}/#/trending/charts/${tc1.id}`); await page.waitForSelector('.trpanel svg');
  check('TC-0001 has one panel per piece of equipment; Freeze is not offered (a chart with a panel each)',
    (await page.locator('.trpanel').count()) === 6 && (await page.locator('#fz').count()) === 0 && /Reagent refrigerator 1/.test(await page.locator('main h3').first().innerText()));
  const p1 = page.locator('.trpanel').first();
  check('The fridge\'s 9.4 °C is a signal (outside its logbook limit of 8 °C) waiting for review', /LIM/.test(await p1.locator('.trsig').innerText()) && (await p1.locator('[data-rev]').count()) === 1);
  await p1.locator('[data-rev]').click(); await page.waitForSelector('.modal #f_outcome');
  await page.locator('.modal #f_outcome').selectOption('Action taken'); await page.fill('.modal #f_comment', 'Door left open during the restock; staff reminded and the door alarm checked');
  await page.click('.modal [data-ok]'); await page.waitForFunction(() => /Action taken/.test(document.querySelector('.trpanel .trsig')?.innerText || ''), null, { timeout: 15000 });
  check('The review is saved and shown with the signal (outcome, what was found, who)', /Review saved/.test(await toasts()) && /Door left open[\s\S]*Lab Supervisor/.test(await page.locator('.trpanel').first().locator('.trsig').innerText()));
  const p1b = page.locator('.trpanel').first();
  await p1b.locator('.views button', { hasText: 'Moving range' }).click();
  const mrShown = await p1b.locator('[data-w="mr"] svg').isVisible();
  await p1b.locator('.views button', { hasText: 'Histogram' }).click();
  const capTxt = await p1b.locator('[data-w="hist"]').innerText();
  await p1b.locator('.views button', { hasText: 'Data' }).click(); await page.waitForTimeout(300);
  const dataTxt = await p1b.locator('[data-w="data"]').innerText();
  check('Views: moving range, histogram with capability (Cpk), and the data with each point linked to its logbook entry',
    mrShown && /Cpk/.test(capTxt) && /LBE-\d+/.test(dataTxt) && (await p1b.locator('[data-w="data"] a[href^="#/logbooks/entries/"]').count()) >= 5);
  await shot('t02_chart');
  const png = await download('.trpanel >> nth=0 >> [data-dl="png"]'); const svg = await download('.trpanel >> nth=0 >> [data-dl="svg"]');
  const csv = await download('.trpanel >> nth=0 >> [data-dl="csv"]'); const xlsx = await download('.trpanel >> nth=0 >> [data-dl="xlsx"]');
  const pdf = await download('.trpanel >> nth=0 >> [data-dl="pdf"]');
  const pngHead = fs.readFileSync(png.file).slice(0, 4).toString('hex'); const csvText = fs.readFileSync(csv.file, 'utf8');
  const svgText = fs.readFileSync(svg.file, 'utf8');
  check('Downloads: PNG, SVG, CSV (one row per point, its signals), Excel and PDF',
    pngHead === '89504e47' && png.size > 5000 && /<svg[\s\S]*UCL/.test(svgText) && /^﻿?Point,Date recorded,Temperature \(°C\),/.test(csvText) && /LIM/.test(csvText)
    && fs.readFileSync(xlsx.file).slice(0, 2).toString() === 'PK' && fs.readFileSync(pdf.file).slice(0, 4).toString() === '%PDF',
    `${png.name} ${png.size} · ${svg.name} · ${csv.name} · ${xlsx.name} · ${pdf.name} ${pdf.size}`);
  check('(0.24.1) The chart\'s axes carry their units and the key shows each line as its symbol',
    /<text[^>]*transform="rotate\(-90[^>]*>[^<]*°C/.test(svgText) && /<text[^>]*>Date recorded<\/text>/.test(svgText)
    && /stroke-dasharray="6 4"[^>]*\/>(?:(?!<line)[\s\S])*?Control limits/.test(svgText) && !/dashed line|solid line/i.test(svgText),
    (svgText.match(/<text[^>]*rotate\(-90[^>]*>[^<]*/) || [''])[0].slice(-60));

  // ---- the builder
  await page.goto(`${BASE}/#/trending/build`); await page.waitForSelector('.trsrc');
  await page.click('[data-src="logbook"]');
  const pick = async (sel, re) => { const v = await page.evaluate(([s, src]) => { const o = [...document.querySelectorAll(s + ' option')].find((x) => new RegExp(src).test(x.textContent)); return o ? o.value : null; }, [sel, re.source]); await page.locator(sel).selectOption(v); await page.waitForTimeout(150); };
  await pick('#p_logbook_id', /LB-0003/); await pick('#p_field_key', /Temperature/); await pick('#p_equipment_id', /Each piece/);
  await page.click('#draw'); await page.waitForSelector('#out .trpanel');
  check('Builder: the temperature log drawn with a chart for each piece of equipment', (await page.locator('#out .trpanel').count()) === 6);
  await page.click('[data-src="counts"]'); await pick('#p_metric', /OOS investigations opened/); await page.click('#draw'); await page.waitForSelector('#out .trpanel svg');
  check('Builder: OOS investigations opened per month as a c chart', /c chart/.test(await page.locator('#out .trpanel').innerText()) || /events per period/.test(await page.locator('#out svg').first().innerHTML()));
  await shot('t03_builder');
  await page.click('#save'); await page.waitForSelector('.modal #f_chart_name');
  await page.fill('.modal #f_chart_name', 'OOS opened per month (QA review)'); await page.click('.modal [data-ok]');
  await page.waitForFunction(() => /#\/trending\/charts\/[\w-]+$/.test(location.hash), null, { timeout: 15000 }); await page.waitForSelector('.trpanel');
  check('Saved: the new chart TC-0009 opens on its own page', /TC-0009 OOS opened per month \(QA review\)/.test(await page.locator('h1').innerText()));

  // ---- frozen limits on a count chart
  await page.goto(`${BASE}/#/trending/charts/${byCode('TC-0007').id}`); await page.waitForSelector('#fz');
  await page.click('#fz'); await page.waitForSelector('.modal #f_from'); await page.click('.modal [data-ok]'); await reason();
  await page.waitForSelector('.trfrozen', { timeout: 15000 });
  check('Limits frozen from a baseline (a reason asked): the baseline and who froze it are shown; Recalculate is offered',
    /Limits frozen by Lab Supervisor \(demo\)[\s\S]*from 13 points/.test(await page.locator('.trfrozen').innerText()) && (await page.locator('#unfz').count()) === 1 && /\(frozen\)/.test(await page.locator('.trpanel .facts').first().innerText()));
  const ch7 = (await sup('/trending/charts/' + byCode('TC-0007').id)).data.chart;
  const change = await sup('/trending/charts', { body: { id: ch7.id, chart_name: ch7.chart_name, source: 'counts', params: { metric: 'excursions', period: 'Month' }, rules: ['R1'], reason: 'x' } });
  check('While its limits are frozen, a chart cannot be changed to chart something else', !change.ok && /frozen/.test(change.data.error || ''), change.data.error);
  await shot('t04_frozen');

  // ---- report packs
  await page.goto(`${BASE}/#/trending/reports?pack=equipment`); await page.waitForSelector('#ps .trpanel');
  check('Report pack "Equipment and environment": five charts (failures, excursions, lots rejected, by equipment and by logbook)', (await page.locator('#ps .trpanel').count()) === 5);
  const packPdf = await download('#pdf');
  check('The pack downloads as one PDF', /Equipment and environment\.pdf/.test(packPdf.name) && fs.readFileSync(packPdf.file).slice(0, 4).toString() === '%PDF' && packPdf.size > 20000, `${packPdf.size}`);
  await shot('t05_pack');
  await page.goto(`${BASE}/#/trending`); await page.waitForSelector('#dlall');
  const allPdf = await download('#dlall');
  check('(0.24.1) Trend watch downloads every saved chart as one PDF', /\.pdf$/.test(allPdf.name) && fs.readFileSync(allPdf.file).slice(0, 4).toString() === '%PDF' && allPdf.size > packPdf.size, `${allPdf.name} ${allPdf.size}`);

  // ---- QC Review: a QC chart applied to the Vitamin C test shows under the batch waiting for review
  const opt = (await sup('/trending/options')).data; const vc = opt.tests.find((t) => /^Vitamin C/.test(t.test_name));
  const qcChart = await sup('/trending/charts', { body: { chart_name: 'Vitamin C check standard', source: 'qc', params: { test_id: vc.id, qc_type: 'Check standard', limit_type: 'Recovery %' }, show_in_review: true } });
  // 0.24.1: a chart in QC Review is QA reviewable and shows there once QA has approved it (signed)
  const qaS = await session('qa.reviewer'); const qaSig = { signature: { username: 'qa.reviewer', password: PASSWORD } };
  const batches = (await sup('/testing/batches')).data;
  const hm0 = (batches.rows || batches).find((x) => x.batch_code === 'BAT-000001');
  check('(0.24.1) Before QA approves it, TC-0005 is not shown in QC Review', ((await sup('/trending/review/' + hm0.id)).data.panels || []).length === 0);
  const toApprove = async () => { const w = ((await qaS('/dashboard/home?only=signing')).data.widgets || []).find((x) => x.code === 'signing');
    const row = w && w.data && (w.data.list || []).find((x) => x.label === 'Control charts to approve'); return row ? `${row.value} ${row.href}` : 'no row'; };
  const before = await toApprove();
  const ap5 = await qaS(`/trending/charts/${byCode('TC-0005').id}/approve`, { body: qaSig });
  const apNew = await qaS(`/trending/charts/${qcChart.data.id}/approve`, { body: qaSig });
  check('(0.24.1) QA approves TC-0005 and the new QC chart', ap5.ok && apNew.ok, (ap5.data.error || '') + (apNew.data.error || ''));
  const after = await toApprove();
  check('(0.24.1) QA\'s to-do widget counts the charts to approve (2, then 0), linked to the list of them', before === '2 #/trending/charts?show=qa' && after === '0 #/trending/charts?show=qa', `${before} → ${after}`);
  const bat5 = (batches.rows || batches).find((x) => x.batch_code === 'BAT-000005');
  await page.goto(`${BASE}/#/testing/batches/${bat5.id}?step=review`); await page.waitForSelector('#rv_trend .trpanel', { timeout: 30000 });
  check('QC Review: the QC charts applied to the batch\'s test are shown under its QC', qcChart.ok && /Trends/.test(await page.locator('#rv_trend').innerText()) && /Vitamin C check standard/.test(await page.locator('#rv_trend').innerText()));
  const hm = (batches.rows || batches).find((x) => x.batch_code === 'BAT-000001');
  const rv = (await sup('/trending/review/' + hm.id)).data;
  check('(the ICP-MS batch gets TC-0005 with a panel per element)', rv.panels.length === 4 && rv.panels.every((p) => p.chart_code === 'TC-0005'));

  // ---- who can do what
  const ana = await session('analyst');
  const no = await ana('/trending/charts', { body: { chart_name: 'Mine', source: 'pareto', params: { metric: 'oos_by_test' } } });
  const noFreeze = await ana(`/trending/charts/${byCode('TC-0006').id}/freeze`, { body: { reason: 'x' } });
  check('The Analyst sees the charts but cannot save one or freeze limits (trending.manage)', (await ana('/trending/watch')).ok && !no.ok && /trending\.manage/.test(no.data.error) && !noFreeze.ok);
  await signIn(page, BASE, 'Analyst (demo)', '#/trending'); await page.waitForSelector('.trtile');
  await page.goto(`${BASE}/#/trending/build`); await page.waitForSelector('.trsrc');
  check('The Analyst can build and download a chart, with no Save', (await page.locator('#draw').count()) === 1 && (await page.locator('#save').count()) === 0);
  const acct = await session('acctmgr');
  check('The Account Manager has no trending (trending.view)', !(await acct('/trending/watch')).ok);

  check('No native browser dialogs', native === 0);
  check('No page errors', !errors.length, errors.slice(0, 3).join(' | '));
  await b.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
