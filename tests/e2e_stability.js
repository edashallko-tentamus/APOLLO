// Stability studies (migration 032) end to end in the browser, as Alex Kiddle (system administrator):
//  - Admin > Lab setup > Stability chambers: the ICH conditions, the demo chambers, a rack added by paste;
//  - Pricing > Stability quotes: a new quote for Beta Foods, the tests pasted, the matrix ticked by paste, saved;
//    issued and sent (PDF and Outbox email), then accepted: it becomes a study with its T0 order;
//  - the study: placed in the chambers (racks offered per condition), the T0 sample logged, the pulls scheduled;
//  - STB-00001 (demo): the 3-month pull recorded from "Pulls due"; the summary report PDF;
//  - Pricing > Quotes lists stability quotes and opens them on their own page.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, call, login } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(800); };
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const cell = (host, r, c) => page.locator(`${host} .gwrap > table > tbody > tr:nth-child(${r}) > td:nth-child(${c})`);
  const cookie = await login(BASE, 'akiddle', PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const cfl = users.find((u) => u.username === 'akiddle').sites.find((s) => s.site_code === 'CFL').id;
  const api = async (p, opts = {}) => { const res = await fetch(BASE + '/api' + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': cfl },
    body: opts.body ? JSON.stringify(opts.body) : undefined }); return { ok: res.ok, data: await res.json().catch(() => ({})) }; };

  // ---- setup
  await signIn(page, BASE, 'Alex Kiddle', '#/stability/setup'); await page.waitForSelector('#cg tbody tr');
  const conds = await page.locator('#cg tbody tr').allInnerTexts();
  const chambers = await page.locator('#chg tbody tr').allInnerTexts();
  check('Stability chambers: the six ICH conditions for every lab, and CFL\'s four demo chambers', conds.length === 6 && conds.some((t) => /40 °C \/ 75% RH/.test(t) && /Accelerated/.test(t))
    && chambers.length === 4 && chambers.some((t) => /Stability chamber 3/.test(t) && /40 °C/.test(t)), `${conds.length} / ${chambers.length}`);
  const nav = await page.locator('#nav').innerText();
  check('The menu has Stability studies (Testing), Stability quotes (Pricing), Stability chambers (Lab setup)', /Stability studies/.test(nav) && /Stability quotes/.test(nav) && /Stability chambers/.test(nav));
  const nRacks = await page.locator('#rg tbody tr').count();
  await page.click('#rg [data-add="1"]'); await cell('#rg', nRacks + 1, 1).click();
  await paste('Stability chamber 3 (40 °C / 75% RH) (40 °C / 75% RH)\tD\tTop shelf\t12'); await page.waitForTimeout(200);
  await page.click('#rg .savebar [data-save]'); await sign(page, { reason: 'New rack' }); await page.waitForTimeout(900);
  const racks = (await api('/stability/setup')).data.racks;
  check('A rack is added by paste (chamber picked by its name)', racks.some((r) => r.rack_code === 'D' && /Stability chamber 3/.test(r.equipment_name) && Number(r.positions) === 12), String(racks.length));
  check('Upcoming pulls by chamber list the demo study\'s pulls', (await page.locator('#ug tbody tr').count()) >= 4);
  await shot('stb_01_setup');

  // ---- a new stability quote
  await go('#/stability/quotes'); await page.waitForSelector('#g tbody tr');
  const q0 = await page.locator('#g tbody tr').allInnerTexts();
  check('Stability quotes: the three demo quotes (SQ-00001 Draft, SQ-00002 with study STB-00001)', q0.length === 3 && q0.some((t) => /SQ-00002/.test(t) && /STB-00001/.test(t) && /Accepted/.test(t)) && q0.some((t) => /SQ-00001/.test(t) && /Draft/.test(t)));
  await page.click('#new'); await page.waitForSelector('.modal #f_client_id');
  await page.selectOption('.modal #f_client_id', { label: 'Beta Foods LLC' });
  await page.selectOption('.modal #f_site_id', cfl);
  await page.fill('.modal #f_project_name', 'Granola shelf life'); await page.fill('.modal #f_product', 'Honey oat granola'); await page.fill('.modal #f_lot', 'GR-1'); await page.fill('.modal #f_unit_name', 'bags');
  await page.click('.modal [data-ok]'); await page.waitForSelector('.modal #f_quote_contact_id'); await page.click('.modal [data-ok]');
  await page.waitForSelector('#lines'); await page.waitForTimeout(800);
  const h1 = await page.locator('main h1').innerText();
  check('New stability quote: SQ- code, Draft, starting with 25/60 and 40/75 and T0 to 24 M', /SQ-00004: Granola shelf life/.test(h1) && (await page.locator('#conds label.on').count()) === 2
    && (await page.locator('#tps tbody tr').count()) === 7, h1);
  // tests by paste: test, then price and units
  await page.click('#lines [data-add="1"]'); await cell('#lines', 1, 1).click(); await paste('Moisture (T-00002)\nWater Activity (T-00003)'); await page.waitForTimeout(300);
  await cell('#lines', 1, 3).click(); await paste('35\t2\tYes\n40\t1\tYes'); await page.waitForTimeout(300);
  // drop 40/75 and keep only 25/60 by clicking its chip
  await page.click('#conds input[data-c] >> nth=3'); await page.waitForTimeout(300);
  const onConds = await page.locator('#conds label.on').innerText().catch(() => '');
  // matrix: two rows (moisture, water activity at 25/60); pulls 3, 6, 9, 12, 18, 24 M: tick 3, 6, 12, 24 for both
  const mxRows = await page.locator('#mx tbody tr').count();
  await cell('#mx', 1, 3).click(); await paste('Yes\tYes\tNo\tYes\tNo\tYes\nYes\tNo\tNo\tYes\tNo\tYes'); await page.waitForTimeout(300);
  check('The matrix has a row per test and condition (2 tests x 1 condition)', mxRows === 2 && /25 °C/.test(onConds), `${mxRows} rows, ${onConds}`);
  await page.click('#save'); await page.waitForTimeout(1500);
  await page.waitForSelector('#lines tbody tr');
  const pid = (await page.evaluate(() => location.hash)).split('/').pop();
  const sq = (await api('/stability/quotes/' + pid)).data;
  check('Saved: 2 tests (moisture 5 times, water activity 4), 1 condition, the total from the cells',
    sq.design.lines.length === 2 && sq.design.lines.find((l) => l.test_code === 'T-00002').quantity === 5 && sq.design.lines.find((l) => l.test_code === 'T-00003').quantity === 4
    && sq.design.conditions.length === 1 && Math.abs(sq.years.reduce((s, y) => s + y.total, 0) - (35 * 5 + 40 * 4)) < 0.01,
    JSON.stringify(sq.design.lines.map((l) => [l.test_code, l.quantity, l.final_price])));
  check('Nothing stops it being issued but the warning about no planned date', !sq.problems.some((x) => x.severity === 'Error'), JSON.stringify(sq.problems));
  await shot('stb_02_quote');
  // issue and send
  await page.click('#send'); await page.waitForSelector('.modal #f_contact_id'); await page.click('.modal [data-ok]'); await page.waitForTimeout(2500);
  const sent = (await api('/stability/quotes/' + pid)).data;
  const outbox = (await api('/outbox')).data;
  const mail = (Array.isArray(outbox) ? outbox : outbox.rows || []).find((m) => /SQ-00004/.test(m.subject || '') || /SQ-00004/.test(m.order_code || ''));
  check('Issued and sent: Quoted, the email with the PDF in the Outbox', sent.version.status === 'Quoted' && !!sent.version.sent_at && !!mail, sent.version.status);
  const pdf = await fetch(`${BASE}/api/quotes/versions/${sent.version.id}/pdf`, { headers: { Cookie: cookie } });
  check('The quotation PDF is the stability layout', pdf.ok && (pdf.headers.get('content-type') || '').includes('pdf'));
  // accept
  await page.waitForSelector('#acc'); await page.click('#acc'); await page.waitForSelector('.modal #f_contact_id'); await page.click('.modal [data-ok]'); await page.waitForTimeout(1500);
  await page.waitForSelector('main .notice');
  const note = await page.locator('main .notice').first().innerText();
  check('Accepted: the quote is now study STB-00003, awaiting material', /study STB-00003 \(Awaiting material\)/.test(note), note);

  // ---- the new study: placement
  await page.click('main .notice a'); await page.waitForSelector('#place #pl_g tbody tr');
  const pl = await page.locator('#place #pl_g tbody tr').allInnerTexts();
  check('Place in chambers: one row per condition, the 25/60 rack offered, the need with reserve (moisture 4 x 2 + water activity 3 x 1 = 11, +10% = 13)',
    pl.length === 1 && /Stability chamber 1/.test(pl[0]) && /\b13\b/.test(pl[0]), pl.join(' / '));
  await page.click('#pl_go'); await sign(page, { reason: 'Material received' }); await page.waitForTimeout(1500);
  await page.waitForSelector('#pulls tbody tr');
  const sid = (await page.evaluate(() => location.hash)).split('/').pop();
  const st = (await api('/stability/studies/' + sid)).data;
  check('Placed: Active, T0 sample logged, 4 pulls scheduled (3, 6, 12, 24 M), all in the future', st.study.status === 'Active' && st.study.t0_sample_status === 'Logged'
    && st.pulls.length === 4 && st.pulls.every((p) => p.status === 'Scheduled'), `${st.study.status} ${st.study.t0_sample_status} ${st.pulls.length}`);
  check('The stored material is labelled and in rack A of chamber 1', st.storage.length === 1 && /STB-00003-1/.test(st.storage[0].storage_code) && st.storage[0].rack_code === 'A');
  await shot('stb_03_study');

  // ---- STB-00001: record the 3-month pull
  await go('#/stability/studies?tab=pulls'); await page.waitForSelector('#g tbody tr');
  const due = await page.locator('#g tbody tr').allInnerTexts();
  check('Pulls due lists STB-00001\'s 3-month pulls, ordered', due.filter((t) => /STB-00001/.test(t) && /3 M/.test(t) && /Ordered/.test(t)).length === 2, due.length + ' rows');
  const row = page.locator('#g tbody tr', { hasText: '25 °C / 60% RH' }).filter({ hasText: 'STB-00001' }).filter({ hasText: '3 M' });
  await row.locator('button', { hasText: 'Record pull' }).click(); await page.waitForSelector('.modal #f_units'); await page.click('.modal [data-ok]'); await page.waitForTimeout(1500);
  check('Recording the pull: units out of storage, sample logged', /Pulled: \d+ units left/.test(await toasts()), await toasts());
  const s1 = (await api('/stability/studies')).data.rows.find((r) => r.study_code === 'STB-00001');
  const s1d = (await api('/stability/studies/' + s1.id)).data;
  const p3 = s1d.pulls.find((p) => p.timepoint_label === '3 M' && /25 °C/.test(p.condition_name));
  check('The pull is Pulled, inside its window, and its sample has a sample ID', p3.status === 'Pulled' && p3.within_window === true && /^CFL\d+/.test(p3.sample_code || ''), JSON.stringify([p3.status, p3.within_window, p3.sample_code]));
  const rep = await fetch(`${BASE}/api/stability/studies/${s1.id}/report.pdf`, { headers: { Cookie: cookie } });
  check('The summary report PDF opens', rep.ok && (rep.headers.get('content-type') || '').includes('pdf'));

  // ---- the quote list
  await go('#/quotes?tab=all'); await page.click('#st button[data-k="all"]'); await page.selectOption('#ty', 'Stability'); await page.waitForTimeout(500);
  const ql = await page.locator('#g tbody tr').allInnerTexts();
  check('Pricing > Quotes lists the stability quotes (type filter)', ql.length === 4 && ql.every((t) => /SQ-/.test(t)), String(ql.length));
  await page.locator('#g tbody tr a', { hasText: 'SQ-00002' }).click(); await page.waitForTimeout(1200);
  check('and opens them on the stability quote page', /#\/stability\/quotes\//.test(await page.evaluate(() => location.hash)));

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
