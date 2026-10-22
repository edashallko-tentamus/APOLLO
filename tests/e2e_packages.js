// Migration 047 (0.26.0): P-1 test packages and dated price changes. In the Test catalogue: a package made from the
// Packages tab (three CFL tests, 10 % off), its shares, an analyte left out, saved with a reason; on a quote: "Add a
// package", the price negotiated, the totals; the quote issued and accepted; on an order: "Add a package to ticked
// samples", the Package column, and cancelling one of its tests after the confirmation that shows what comes off (only
// that test's share: option B); the dated "Update prices…" (today, rounded to the dollar) and a scheduled one cancelled
// on the Price changes tab; the analyst sees packages but cannot make them. Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, login, call } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
const TESTS = ['Moisture', 'Water Activity', 'Heavy Metals Panel (ICP-MS)'];

async function as(who) {
  const cookie = await login(BASE, who, PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
  return async (p, body, method) => {
    const res = await fetch(BASE + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site },
      body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
}

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto('about:blank'); await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(900); };
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const setSel = (sel, value) => page.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, value]);
  const colIndex = (sel, title) => page.evaluate(([s, t]) => [...document.querySelectorAll(s + ' thead th')].findIndex((th) => th.textContent.trim().startsWith(t)), [sel, title]);
  const alex = await as('akiddle');

  // ---- 1. Test catalogue > Packages: a new package
  await signIn(page, BASE, 'Alex Kiddle', '#/catalog');
  await go('#/catalog?tab=packages');
  check('The catalogue has Tests, Packages and Price changes tabs (and, since 0.36.0, Charges and Service lines)', (await page.locator('main .tabs .tab').allInnerTexts()).join('|') === 'Tests|Packages|Price changes|Charges|Service lines');
  await page.click('#newpkg'); await page.waitForSelector('.modal');
  await page.fill('#f_package_name', 'E2E supplement basics');
  check('The new package asks no pricing mode or discount (049)', (await page.locator('.modal #f_discount_pct, .modal #f_pricing_mode').count()) === 0);
  await page.click('.modal [data-ok]');
  await page.waitForFunction(() => /#\/catalog\/packages\/[0-9a-f-]{36}$/.test(location.hash)); await page.waitForSelector('#addT');
  const pkgId = (await page.evaluate(() => location.hash)).split('/').pop();
  check('"+ New package" makes the package and opens it (PKG- code, no tests yet: a problem shown)',
    /PKG-\d{4}/.test(await page.locator('main .sub, main header, main').first().innerText()) && /no tests|tests yet/i.test(await page.locator('main').innerText()));
  await page.click('#addT'); await page.waitForSelector('.modal .picklist');
  for (const t of TESTS) await page.locator('.modal .picklist label', { hasText: t }).first().locator('input').check();
  await page.click('.modal [data-ok]'); await page.waitForTimeout(300);
  check('Three tests added to the grid at their catalogue prices, waiting to be saved', (await page.locator('#ig tbody tr').count()) === 3 && /Save to keep/.test(await toasts())
    && /0 % off/.test(await page.locator('#pksum').innerText()));
  await page.click('#save'); await sign(page, { reason: 'E2E: new package' });
  await page.waitForFunction(() => /Saved/.test(document.body.innerText)); await page.waitForTimeout(800);
  let pk = await alex('/packages/' + pkgId);
  const listSum = pk.lines.reduce((s, l) => s + Number(l.list_price), 0);
  check('Saved: each test at its catalogue price, the package their sum, no discount',
    pk.lines.length === 3 && pk.lines.every((l) => Number(l.typed_price) === Number(l.list_price)) && Math.abs(Number(pk.package.package_price) - listSum) < 0.005, `price ${pk.package.package_price}, list ${listSum}`);

  // each test repriced in the package by paste (10 % off each, to the cent): the discount is worked out
  const pcolI = await colIndex('#ig', 'Price in the package');
  const typed = [];
  for (const [i, l] of pk.lines.entries()) {
    const want = Math.round(Number(l.list_price) * 90) / 100; typed.push(want);
    await page.locator('#ig tbody tr').nth(i).locator('td').nth(pcolI).click(); await page.keyboard.type(String(want)); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  }
  const want = typed.reduce((s, x) => s + x, 0);
  const sumTxt = await page.locator('#pksum').innerText();
  check('Typing the prices updates the package price and the discount before saving', sumTxt.includes('$' + want.toFixed(2)) && /10(\.0)? % off/.test(sumTxt), sumTxt.replace(/\s+/g, ' '));
  check('Each line shows its own discount', /\(10(\.0)? %\)/.test(await page.locator('#ig tbody tr').first().innerText()));
  await page.click('#save'); await sign(page, { reason: 'E2E: package prices' });
  await page.waitForTimeout(1200);
  pk = await alex('/packages/' + pkgId);
  check('Saved: the package price is the typed prices added up; the discount is worked out',
    Math.abs(Number(pk.package.package_price) - want) < 0.005 && Math.abs(Number(pk.package.discount) - (listSum - want)) < 0.005 && Number(pk.package.discount_pct) === 10,
    `${pk.package.package_price} / ${pk.package.discount} / ${pk.package.discount_pct}`);

  // an analyte left out of the analyte-priced test: its catalogue price drops, its price in the package stays as typed
  await page.waitForSelector('#ag tbody tr');
  const before = Number(pk.package.package_price); const beforeList = Number(pk.package.list_value);
  const inc = await colIndex('#ag', 'In the package');
  await page.locator('#ag tbody tr').first().locator('td').nth(inc).click(); await page.keyboard.press(' '); await page.waitForTimeout(200);
  await page.click('#save'); await sign(page, { reason: 'E2E: one analyte out' });
  await page.waitForTimeout(1200);
  pk = await alex('/packages/' + pkgId);
  check('Leaving an analyte out lowers the catalogue value (and so the discount); the package price stays as typed', Number(pk.package.package_price) === before
    && Number(pk.package.list_value) < beforeList && /\d+ of \d+/.test(await page.locator('#ig tbody').innerText()), `${beforeList} -> ${pk.package.list_value}`);
  await shot('packages_01_editor');
  await go('#/catalog?tab=packages');
  check('The Packages tab lists it with its tests and price', /E2E supplement basics/.test(await page.locator('#g').innerText()) && /Moisture/.test(await page.locator('#g').innerText()));

  // ---- 2. A quote: "Add a package", the price negotiated, totals
  const clients = await alex('/clients'); const irv = (clients.rows || clients).find((c) => /Irvine/.test(c.legal_name));
  const q = await alex('/quotes', { client_id: irv.id, project_name: 'E2E package quote' });
  await go('#/quote/' + q.version_id);
  await setSel('#pkpick', pkgId); await page.fill('#pkqty', '3'); await page.click('#pkadd');
  await page.waitForSelector('#pg tbody tr'); await page.waitForTimeout(500);
  check('"Add a package" puts it on the quote with its tests and shares, quantity 3', /E2E supplement basics/.test(await page.locator('#pg').innerText()) && /Moisture: \$/.test(await page.locator('#pg').innerText()));
  const pcol = await colIndex('#pg', 'Package price');
  const cell = page.locator('#pg tbody tr').first().locator('td').nth(pcol);
  await cell.click(); await page.keyboard.type('300'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  check('Typing a new package price shows the save bar and moves the quote total', await page.locator('#psb.show').count() === 1 && /\$900\.00/.test(await page.locator('#tot').innerText()));
  await page.click('#psave'); await page.waitForTimeout(1200);
  let pks = await alex(`/versions/${q.version_id}/packages`);
  check('Saved: $300 per sample, the shares add up to $300', Number(pks.rows[0].package_price) === 300 && Math.abs(pks.rows[0].tests.reduce((s, t) => s + Number(t.final_price), 0) - 300) < 0.005);
  await shot('packages_02_quote');
  const v = await alex('/versions/' + q.version_id);
  const maria = v.contacts.find((c) => (c.roles || []).includes('ORDERING'));
  await alex(`/versions/${q.version_id}/status`, { status: 'Quoted' });
  await alex(`/versions/${q.version_id}/status`, { status: 'Accepted', accepted_by_contact_id: maria.id });

  // ---- 3. An order: add the package to two samples, cancel a test in one
  const o = await alex('/orders', { row: { client_id: irv.id, ordering_contact_id: maria.id, submission_channel: 'Walk-in', po_number: 'PO-E2E-PKG' } });
  await alex(`/orders/${o.id}/samples`, { rows: [{ client_sample_id: 'PKG-E2E-1' }, { client_sample_id: 'PKG-E2E-2' }] });
  await go('#/orders/' + o.id);
  await page.waitForSelector('#addPk');
  // samples not logged yet are ticked by default
  await page.click('#addPk'); await page.waitForSelector('.modal');
  await page.click('.modal [data-ok]');
  await page.waitForFunction(() => /Package added to 2 samples/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  let od = await alex('/orders/' + o.id);
  const s1 = od.tests.filter((t) => t.client_sample_id === 'PKG-E2E-1');
  check('"Add a package to ticked samples" orders the three tests on both samples, each at its share ($300 a sample)',
    od.tests.length === 6 && Math.abs(s1.reduce((s, t) => s + Number(t.price), 0) - 300) < 0.005 && s1.every((t) => t.package_code), await toasts());
  await page.waitForTimeout(800);
  check('The Package column names the package', /PKG-\d{4} E2E supplement basics/.test(await page.locator('#sg').innerText()));
  // cancel Moisture on the first sample
  const moist = s1.find((t) => t.test_name === 'Moisture');
  const share = Number(moist.price);
  const grid = page.locator('.stests').first();
  const st = await page.evaluate(() => [...document.querySelector('.stests thead').querySelectorAll('th')].findIndex((th) => th.textContent.trim() === 'Status'));
  const row = grid.locator('tbody tr').filter({ hasText: 'Moisture' }).first();
  await row.locator('td').nth(st).click(); await page.keyboard.type('Cancelled'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  await page.click('#tsave'); await page.waitForSelector('.modal');
  const conf = await page.locator('.modal').innerText();
  check('Before saving, the confirmation shows only Moisture\'s share comes off and the other two keep theirs',
    conf.includes('$' + share.toFixed(2)) && /comes off package PKG-/.test(conf) && /The 2 tests left keep their shares: \$/.test(conf), conf.replace(/\s+/g, ' ').slice(0, 220));
  await shot('packages_03_cancel_confirm');
  await page.click('.modal [data-ok]');
  if (await page.locator('.sigmodal').count()) await sign(page, { reason: 'E2E: client dropped moisture' });
  await page.waitForTimeout(1500);
  od = await alex('/orders/' + o.id);
  const a1 = od.tests.filter((t) => t.client_sample_id === 'PKG-E2E-1');
  check('Cancelled: the two tests left keep their shares, the package is Partly cancelled; the other sample is untouched',
    a1.find((t) => t.test_name === 'Moisture').status === 'Cancelled'
    && Math.abs(a1.filter((t) => t.status !== 'Cancelled').reduce((s, t) => s + Number(t.price), 0) - (300 - share)) < 0.005
    && a1.every((t) => t.package_status === 'Partly cancelled')
    && od.tests.filter((t) => t.client_sample_id === 'PKG-E2E-2').every((t) => t.package_status === 'Intact'));
  check('The order value is two packages less that one share', Math.abs(Number(od.order.order_value) - (600 - share)) < 0.005, String(od.order.order_value));

  // ---- 4. Dated price changes
  await go('#/catalog?find=pH');
  const cat = await alex('/catalog'); const ph = cat.find((t) => t.test_name === 'pH');
  await page.locator('#g tbody tr').filter({ hasText: 'pH' }).first().locator('td').nth(3).click();
  await page.click('#reprice'); await page.waitForSelector('.modal #f_effective_on');
  check('"Update prices…" asks the start date (today by default), the rounding and the packages', (await page.inputValue('#f_effective_on')).length === 10 && (await page.locator('#f_rounding').count()) === 1 && (await page.locator('#f_include_packages').count()) === 1);
  await page.fill('#f_pct', '4'); await setSel('#f_rounding', 'Dollar');
  await page.click('.modal [data-ok]'); await page.waitForSelector('.modal'); await page.click('.modal [data-ok]');
  await sign(page, { reason: 'E2E: price change' }); await page.waitForTimeout(1500);
  const ph2 = (await alex('/catalog')).find((t) => t.test_name === 'pH');
  check('Today\'s change applies at once, rounded to the dollar', Number(ph2.list_price) === Math.round(Number(ph.list_price) * 1.04), `${ph.list_price} -> ${ph2.list_price}`);
  const fut = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  await alex('/price-changes', { pct: 3, tests: null, effective_on: fut, rounding: 'Cent', include_packages: true, reason: 'E2E: next month' });
  await go('#/catalog?tab=prices');
  check('The Price changes tab lists the applied and the scheduled change', /Applied/.test(await page.locator('#g').innerText()) && /Scheduled/.test(await page.locator('#g').innerText()));
  await page.locator('#g tbody tr').filter({ hasText: 'Scheduled' }).first().locator('td').first().click();
  await page.click('#cancelpc'); await page.waitForSelector('.modal'); await page.click('.modal [data-ok]');
  await sign(page, { reason: 'E2E: not this year' }); await page.waitForTimeout(1200);
  check('A scheduled change is cancelled with a reason', /Cancelled by/.test(await page.locator('#g').innerText()));
  await shot('packages_04_prices');

  // ---- 5. The analyst sees packages but cannot make them; audit
  await signIn(page, BASE, 'Analyst (demo)', '#/catalog?tab=packages'); await go('#/catalog?tab=packages');
  check('The analyst sees the packages, without "+ New package"', /E2E supplement basics/.test(await page.locator('#g').innerText()) && (await page.locator('#newpkg').count()) === 0);
  await go('#/catalog/packages/' + pkgId);
  check('The package page has its audit icon and no Save for the analyst', (await page.locator('main h1 .auditbtn').count()) === 1 && (await page.locator('#save').count()) === 0);
  check('No page errors, no native dialogs', errors.length === 0 && native === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
