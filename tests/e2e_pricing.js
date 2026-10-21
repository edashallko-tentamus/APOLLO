// 0.16.1 (migration 031): Alex's notes on quotes, the catalogue and serving sizes, in the browser, as Alex Kiddle.
//  - no "Any lab": every test has its lab; a quote made at CFL prices a TPS test as subcontracted (the 20-30 rule)
//    and shows it as such, with the in-network cost; the trash button takes a line off the quote;
//  - the catalogue's "Update prices…" raises the selected tests by a percentage (with a Reason for Change);
//  - the Sites grid has the in-network discount and markup; the Units list marks serving units;
//  - the sample grid: Containers apart from the amount received, serving count, serving unit, serving weight, servings
//    per package; the sample page shows the serving; the specifications dialog has "Limit is" (per serving / package).
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, call, login } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(700); };
  const toastLike = async (re) => { let all = []; for (let i = 0; i < 60; i++) { all = await page.locator('.toast').allInnerTexts(); const h = all.filter((x) => re.test(x)).pop(); if (h) return h; await page.waitForTimeout(250); } return all.join(' / '); };
  const cookie = await login(BASE, 'akiddle', PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const cfl = users.find((u) => u.username === 'akiddle').sites.find((s) => s.site_code === 'CFL').id;
  const api = async (p, opts = {}) => { const res = await fetch(BASE + '/api' + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': cfl },
    body: opts.body ? JSON.stringify(opts.body) : undefined }); return { ok: res.ok, data: await res.json().catch(() => ({})) }; };

  // ---- every test has its lab
  const cat = (await api('/quotes/catalog')).data;
  check('No test is "Any lab" any more: the shared tests have CFL as their home lab', cat.length > 0 && cat.every((t) => t.site_id) && cat.find((t) => /Salmonella/.test(t.test_name)).site_code === 'CFL');

  // ---- a quote made at CFL: in-house and subcontracted lines
  const clients = (await api('/clients')).data; const beta = clients.find((c) => c.legal_name === 'Beta Foods LLC');
  const q = (await api('/quotes', { method: 'POST', body: { client_id: beta.id, project_name: 'Pricing check' } })).data;
  const diss = cat.find((t) => /Dissolution/.test(t.test_name)); const ph = cat.find((t) => t.test_name === 'pH');
  const add = await api(`/versions/${q.version_id}/lines`, { method: 'POST', body: { rows: [{ test_id: diss.test_id, quantity: 1 }, { test_id: ph.test_id, quantity: 1 }], prefill: true } });
  check('(two tests added to a new CFL quote)', add.ok, add.data.error || '');
  await signIn(page, BASE, 'Alex Kiddle', `#/quote/${q.version_id}`); await page.waitForSelector('#lg tbody tr');
  const meta = await page.locator('.meta3').first().innerText();
  const rows = await page.locator('#lg tbody tr').allInnerTexts();
  const dRow = rows.find((t) => /Dissolution/.test(t)) || ''; const pRow = rows.find((t) => /\bpH\b/.test(t)) || '';
  check('The quote shows its lab (CFL); the TPS test is "TPS (subcontracted)" at $676 ($650 less 20 %, plus 30 %), the in-network cost $520, and starts at that price',
    /Quoting lab\s*CFL/.test(meta) && /TPS \(subcontracted\)/.test(dRow) && (dRow.match(/\$676\.00/g) || []).length >= 2 && /\$520\.00/.test(dRow), dRow);
  check('The CFL test is in-house: its catalogue price, no in-network cost', /CFL/.test(pRow) && !/subcontracted/.test(pRow));
  await page.locator('#qpick .tabs button', { hasText: 'TPS' }).click(); await page.waitForTimeout(300);
  const pick = await page.locator('#qcat').innerText();
  const assay = (await page.locator('#qcat tbody tr', { hasText: 'Assay by HPLC' }).allInnerTexts())[0] || '';
  check('The picker\'s TPS tab marks its tests subcontracted, at the client\'s price beside the catalogue price (Assay: $425 to $442); no "Any lab" anywhere',
    /TPS \(subcontracted\)/.test(pick) && /\$442\.00[\s\S]*\$425\.00/.test(assay) && !/Any lab/.test(await page.locator('main').innerText()), assay);
  await shot('p_01_quote_subcontracted');
  // the trash button
  const pIdx = rows.findIndex((t) => /\bpH\b/.test(t)) + 1;
  await page.locator(`#lg tbody tr:nth-child(${pIdx}) button`, { hasText: '🗑' }).click();
  await page.waitForSelector('.modal [data-ok]'); await page.click('.modal [data-ok]');
  const tt = await toastLike(/removed/);
  await page.waitForTimeout(800);
  const after = await page.locator('#lg tbody tr').allInnerTexts();
  check('The trash button takes a line off the quote (after a confirmation)', /pH removed/.test(tt) && after.length === rows.length - 1 && !after.some((t) => /\bpH\b/.test(t)), tt);

  // ---- the catalogue: update the selected test's prices by 10 %
  const cat0 = (await api('/catalog')).data; const before = cat0.find((t) => t.test_name === 'Moisture'); const wa0 = cat0.find((t) => t.test_name === 'Water Activity');
  await go('#/catalog'); await page.waitForSelector('#g tbody tr');
  await page.locator('#g tbody tr', { hasText: 'Moisture' }).locator('td').nth(2).click();
  await page.click('#reprice'); await page.waitForSelector('.modal #f_pct');
  const scope = await page.locator('.modal #f_scope').innerText();
  await page.fill('.modal #f_pct', '10'); await page.click('.modal [data-ok]');
  await page.waitForTimeout(400); await page.waitForSelector('.modal [data-ok]'); await page.click('.modal [data-ok]');   // the confirmation
  await sign(page, { reason: 'Annual price review 2027' });
  const t2 = await toastLike(/changed by/);   // since 0.26.0 a dated price change (PC-0001), applied at once when it starts today
  const now = (await api('/catalog')).data.find((t) => t.test_name === 'Moisture');
  const other = (await api('/catalog')).data.find((t) => t.test_name === 'Water Activity');
  check('"Update prices…" offers the selected test or every test; 10 % on Moisture: its list price goes up 10 %, the others stay',
    /1 selected test/.test(scope) && /Every active test/.test(scope) && /PC-\d{4}: \d+ prices? changed by 10 %/.test(t2) && Math.abs(Number(now.list_price) - Number(before.list_price) * 1.1) < 0.02
    && Number(other.list_price) === Number(wa0.list_price), `${before.list_price} -> ${now.list_price} · ${t2}`);
  await shot('p_02_catalogue');

  // ---- lab settings and units
  await go('#/admin/sites'); await page.waitForSelector('#sg tbody tr');
  const sg = await page.locator('#sg').innerText();
  check('Sites and holidays: each lab\'s in-network discount (20 %) and subcontract markup (30 %)', /In-network discount %/.test(sg) && /Subcontract markup %/.test(sg));
  const units = (await api('/units')).data;
  check('The Units list has serving units (capsule, scoop, packet...), marked "Serving unit"', ['capsule', 'scoop', 'packet', 'softgel'].every((c) => units.some((u) => u.unit_code === c && u.is_serving_unit)));
  await go('#/admin/units'); await page.waitForSelector('#g tbody tr');
  check('(the Units page has the Serving unit column)', /Serving unit/.test(await page.locator('#g thead').innerText()));

  // ---- the sample grid and the sample page
  const orders = (await api('/orders')).data; const ord = (orders.rows || orders).find((o) => o.po_number === 'PO-45231');
  await go(`#/orders/${ord.id}`); await page.waitForSelector('#sg tbody tr');
  const head = await page.locator('#sg thead').first().innerText();
  check('The sample grid: "Containers" apart from "Amount received" and its unit; Serving, Serving unit, Serving weight/vol, Servings / package; no "Units" beside "Unit"',
    /Containers/.test(head) && /Amount received/.test(head) && /Amount unit/.test(head) && /Serving unit/.test(head) && /Serving weight\/vol/.test(head) && /Servings \/ package/.test(head)
    && !/\bUnits\b/.test(head), head.replace(/\s+/g, ' ').slice(0, 300));
  const od = (await api(`/orders/${ord.id}`)).data; const s1 = od.samples[0];
  const sv = await api(`/orders/${ord.id}/samples`, { method: 'POST', body: { rows: [{ id: s1.id, serving_count: 2, serving_count_unit: 'capsule', serving_size: 1.2, serving_unit: 'g', servings_per_package: 30 }], reason: 'Serving from the label' } });
  const bad = await api(`/orders/${ord.id}/samples`, { method: 'POST', body: { rows: [{ id: s1.id, serving_count_unit: 'kg' }], reason: 'x' } });
  check('A serving is saved (2 capsules of 1.2 g, 30 per package); a serving unit not on the list is refused', sv.ok && !bad.ok && /serving units/.test(bad.data.error || ''), bad.data.error || sv.data.error || '');
  await go(`#/samples/${s1.id}`);
  check('The sample page shows the serving', /2 capsule, 1\.2 g; 30 per package/.test(await page.locator('main').innerText()));
  // the specifications dialog: "Limit is"
  await go(`#/orders/${ord.id}`); await page.waitForSelector('#sg tbody tr');
  const specBtn = page.locator('button', { hasText: /limit|Unspecified/ }).first();
  if (await specBtn.count()) {
    await specBtn.click(); await page.waitForSelector('.modal #sp_g');
    const spec = await page.locator('.modal #sp_g thead').innerText();
    check('The specifications dialog asks what the limit is per: as reported, per serving or per package', /Limit is/.test(spec));
    await page.click('.modal [data-x]');
  } else check('The specifications dialog asks what the limit is per: as reported, per serving or per package', false, 'no Specs button on the order');
  await shot('p_03_order_serving');

  check('No page errors and no native browser dialogs', errors.length === 0 && native === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exit(1); });
