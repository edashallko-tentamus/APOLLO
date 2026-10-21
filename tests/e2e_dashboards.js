// Dashboards, D-1 (migration 037), end to end in the browser. Home is the dashboard (the Lab Supervisor's widgets);
// a number opens its page, another the list behind it; a widget put away and brought back; moved by dragging its title
// bar and resized by dragging its corner, kept after a reload. The GM dashboard (General Manager), without the
// executive one; the executive dashboard (Executive): the labs side by side, one lab picked, the finance update. The
// finance figures typed by the Finance group by paste. Admin > Dashboard widgets: a widget taken from the Analyst group.
// An inventory item's department on its page. Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, call, login } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

async function as(who) {
  const cookie = await login(BASE, who, PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
  return async (p, body, method) => {
    const res = await fetch(BASE + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
}

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(900); };
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const cell = (host, r, c) => page.locator(`${host} .gwrap > table > tbody > tr:nth-child(${r}) > td:nth-child(${c})`);
  const codes = () => page.$$eval('#dgrid .dw', (els) => els.map((e) => e.dataset.code));
  const sup = await as('labsup');

  // ================================================================ Home is the dashboard
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#/'); await page.waitForSelector('#dgrid .dw');
  const home = await sup('/dashboard/home');
  const shown = await codes();
  check('Home is the Lab Supervisor\'s dashboard: the widgets of their groups (backlog, batches, signing, turnaround, low stock...)',
    ['my_work', 'backlog', 'batches', 'signing', 'tat', 'on_time', 'low_stock_risk'].every((c) => shown.includes(c)) && !shown.includes('revenue') && shown.length === home.widgets.length, shown.join(','));
  // D-1.1: on time at two levels; tests at QC Review approval (large) and at release (small, under it)
  const otw = home.widgets.find((w) => w.code === 'on_time');
  check('On time (tests): QC Review approval against the due date, with the release on a COA smaller under it; On time (samples) beside it',
    otw && otw.title === 'On time (tests)' && otw.data.kpis.length === 3 && otw.data.minor && otw.data.minor.kpis.length === 3 && shown.includes('on_time_samples')
    && (await page.locator('.dw[data-code="on_time"] .dminor .dk.small').count()) === 1, JSON.stringify(otw && otw.data.minor && otw.data.minor.title));
  const bw = home.widgets.find((w) => w.code === 'batches').data.kpis.find((k) => /QC Review/.test(k.label));
  check('Batches waiting for QC Review: the number matches the record', (await page.locator('.dw[data-code="batches"]').innerText()).includes(String(bw.value)));
  await shot('dash_01_home');
  await page.locator('.dw[data-code="batches"] a', { hasText: 'Waiting for QC Review' }).click(); await page.waitForTimeout(1200);
  check('A number opens its page (QC Review)', /show=review/.test(await page.evaluate(() => location.hash)));
  await go('#/'); await page.waitForSelector('#dgrid .dw');
  const od = home.widgets.find((w) => w.code === 'overdue').data.kpis[0];
  await page.locator('.dw[data-code="overdue"] [data-detail="overdue"]').click(); await page.waitForSelector('.ddet #ddg');
  await page.waitForTimeout(400);
  const rowsShown = await page.locator('.ddet #ddg tbody tr').count();
  check('Another opens the list behind it (overdue tests), one row per test', rowsShown === od.value || (od.value === 0 && rowsShown <= 1), `${rowsShown} vs ${od.value}`);
  await shot('dash_02_detail');
  await page.click('.ddet [data-x]'); await page.waitForTimeout(200);

  // put away, bring back
  await page.locator('.dw[data-code="stability"] header [data-x]').click(); await page.waitForTimeout(800);
  check('A widget is put away (×)', !(await codes()).includes('stability'));
  await go('#/'); await page.waitForSelector('#dgrid .dw');
  check('...and stays away after a reload', !(await codes()).includes('stability'));
  await page.click('#dadd'); await page.click('.dpop [data-c="stability"]'); await page.waitForSelector('.dw[data-code="stability"]');
  check('Bring back a widget shows it again', (await codes()).includes('stability'));

  // move by dragging the title bar, resize by dragging the corner
  const before = await codes();
  await page.locator(`.dw[data-code="${before[3]}"] header`).dragTo(page.locator(`.dw[data-code="${before[0]}"]`));
  await page.waitForTimeout(1000);
  const after = await codes();
  check('A widget is moved by dragging its title bar onto another', after.indexOf(before[3]) < after.indexOf(before[1]) && after.indexOf(before[3]) <= 1, after.slice(0, 4).join(','));
  const box = await page.locator('.dw[data-code="backlog"] .rz').boundingBox();
  const w0 = (await sup('/dashboard/home')).layout.find((x) => x.code === 'backlog');
  await page.mouse.move(box.x + 6, box.y + 6); await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 140, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(1000);
  const w1 = (await sup('/dashboard/home')).layout.find((x) => x.code === 'backlog');
  check('A widget is resized by dragging its corner (wider and taller), and kept', w1 && w0 && w1.w > w0.w && w1.h > w0.h, `${w0 && w0.w}x${w0 && w0.h} -> ${w1 && w1.w}x${w1 && w1.h}`);
  await go('#/'); await page.waitForSelector('#dgrid .dw');
  check('The arrangement is the same after a reload', (await codes())[0] === after[0] && (await page.locator('.dw[data-code="backlog"]').getAttribute('style')).includes(`span ${w1.w}`));
  check('Live: the page says when it was updated and that it refreshes every minute', /refreshes every minute/.test(await page.locator('#dupd').innerText()));
  await shot('dash_03_arranged');
  const nav = await page.locator('#nav').innerText();
  check('The Lab Supervisor sees neither the GM nor the executive dashboard', !/GM dashboard/.test(nav) && !/Executive dashboard/.test(nav));

  // ================================================================ GM dashboard
  await signIn(page, BASE, 'General Manager (demo)', '#/dashboard/gm'); await page.waitForSelector('#dgrid .dw');
  const gmc = await codes(); const gnav = await page.locator('#nav').innerText();
  check('The GM dashboard: revenue, projection, work in progress, samples, on time, the lab', ['revenue', 'projection', 'wip', 'samples', 'on_time', 'network'].every((c) => gmc.includes(c)) && /GM dashboard/.test(gnav), gmc.join(','));
  check('The GM dashboard has Lab finance: the line chart of revenue, costs and EBITDA for the GM\'s lab (tabs)',
    gmc.includes('lab_finance') && (await page.locator('.dw[data-code="lab_finance"] svg.dline').count()) === 1 && (await page.locator('.dw[data-code="lab_finance"] .dtabs button').count()) === 3);
  await page.locator('.dw[data-code="lab_finance"] .dtabs [data-tab="cost"]').click(); await page.waitForTimeout(300);
  check('...the Costs tab draws the costs', /Costs by month/.test(await page.locator('.dw[data-code="lab_finance"] svg.dline').getAttribute('aria-label')));
  check('A General Manager does not see the executive dashboard (menu)', !/Executive dashboard/.test(gnav));
  const gmApi = await as('gm');
  let refused = ''; try { await gmApi('/dashboard/executive'); } catch (e) { refused = e.message; }
  check('...nor through its address', /Executive and Finance groups/.test(refused), refused.slice(0, 80));
  await page.locator('.dw[data-code="wip"] [data-detail="wip:Not Started"]').click(); await page.waitForSelector('.ddet #ddg');
  check('Work in progress opens the work behind each stage', /Work in progress: Not Started/.test(await page.locator('.ddet h3').innerText()) && (await page.locator('.ddet #ddg tbody tr').count()) >= 1);
  await page.click('.ddet [data-x]');
  await shot('dash_04_gm');

  // ================================================================ executive dashboard
  await signIn(page, BASE, 'Executive (demo)', '#/dashboard/executive'); await page.waitForSelector('#dgrid .dw[data-code="network"] table');
  const ex = await page.locator('.dw[data-code="network"]').innerText();
  check('The executive dashboard: every lab side by side, with the total', /CFL/.test(ex) && /TPS/.test(ex) && /All/.test(ex));
  const finTxt = await page.locator('.dw[data-code="finance"]').innerText();
  const finHead = await page.locator('.dw[data-code="finance"] table th').allInnerTexts();
  check('The finance update: a line chart (Revenue, EBITDA, Costs tabs) against the Budget Forecast and the Monthly Forecast; LIMS invoiced first, the books last',
    /Budget forecast/.test(finTxt) && (await page.locator('.dw[data-code="finance"] svg.dline').count()) === 1 && (await page.locator('.dw[data-code="finance"] svg.dline text').count()) >= 12
    && finHead[2] === 'LIMS invoiced' && finHead[finHead.length - 1] === 'Revenue (books)', finHead.join('|'));
  const exApi = await as('exec');
  const exd = await exApi('/dashboard/executive');
  const fr = exd.widgets.find((w) => w.code === 'finance').data.finance;
  check('Weeks in = the weeks of the month (not one per lab): never more than 5', fr.every((x) => x.weeks <= 5) && fr.some((x) => x.weeks >= 4), fr.map((x) => x.weeks).join(','));
  await page.locator('.dw[data-code="network"] .dtabs [data-tab="ebitda"]').click(); await page.waitForTimeout(300);
  const nh = await page.locator('.dw[data-code="network"] table th').allInnerTexts();
  check('Labs side by side: an EBITDA tab, the three comparisons, and Potential revenue after Work in progress',
    nh[1] === 'EBITDA this month' && nh[3] === '% vs last month' && nh[5] === 'Last month vs 3-month avg' && nh[6] === '% vs last quarter' && nh[9] === 'Work in progress' && nh[10] === 'Potential revenue', nh.join('|'));
  const nw = exd.widgets.find((w) => w.code === 'network').data.network;
  check('Potential revenue = work in progress + revenue this month; on time this month at the sample level', nw.every((x) => Math.abs(x.potential - (x.wip + x.rev.m)) < 0.01) && exd.widgets.some((w) => w.code === 'on_time_samples'));
  await page.locator('.dw[data-code="network"] .dtabs [data-tab="rev"]').click(); await page.waitForTimeout(300);
  await shot('dash_05_exec');
  const tps = await page.$eval('#dlab', (s) => [...s.options].find((o) => /TPS/.test(o.textContent)).value);
  await page.selectOption('#dlab', tps); await page.waitForSelector('#dgrid .dw[data-code="network"] table'); await page.waitForTimeout(600);
  const one = await page.locator('.dw[data-code="network"] tbody tr').allInnerTexts();
  check('One lab picked: only TPS', one.length === 1 && /TPS/.test(one[0]), one.join(' | '));
  await page.selectOption('#dlab', ''); await page.waitForTimeout(800);

  // ================================================================ finance figures (the Finance group)
  await signIn(page, BASE, 'Finance (demo)', '#/dashboard/finance'); await page.waitForSelector('#wg .gwrap');
  const fin = await as('finance');
  const f0 = await fin('/finance');
  const lastThu = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 2) % 7) - 8); return d.toLocaleDateString('en-CA'); })(); // seeded weeks end on Fridays (the local date: toISOString gave the next day in the evening)
  // D-1.1: one lab at a time (tabs); the week's revenue comes from the LIMS and cannot be typed
  check('The finance figures: a tab per lab', (await page.locator('.ftabs [data-lab]').count()) === f0.labs.length && f0.labs.length >= 2);
  await page.click('.ftabs [data-lab="TPS"]'); await page.waitForSelector('.ftabs [data-lab="TPS"].on'); await page.waitForSelector('#wg .gwrap');
  const wh = await page.locator('#wg .gwrap th').allInnerTexts();
  check('...the weekly grid of the lab picked: Revenue (LIMS) locked, Costs, EBITDA, Revenue (books) last but the note', /Revenue \(LIMS\)/.test(wh.join('|')) && wh.some((h) => /Revenue \(books\)/.test(h)) && !wh.some((h) => h.trim() === 'Lab'), wh.join('|'));
  const nRows = await page.locator('#wg .gwrap > table > tbody > tr').count();
  await page.click('#wg [data-add="1"]');
  await cell('#wg', nRows + 1, 1).click(); await paste(lastThu); await page.waitForTimeout(300);
  await cell('#wg', nRows + 1, 3).click(); await paste('10000'); await page.waitForTimeout(300);
  await cell('#wg', nRows + 1, 5).click(); await paste('12345'); await page.waitForTimeout(300);
  await page.click('#wg .savebar [data-save]'); await sign(page, { reason: 'Weekly finance update' }); await page.waitForTimeout(1200);
  const f1 = await fin('/finance');
  const nw1 = f1.weeks.find((w) => w.site_code === 'TPS' && String(w.week_ending).slice(0, 10) === lastThu);
  check('The Finance group adds a TPS week by paste, saved with a reason: costs and the books\' revenue stored, the LIMS revenue worked out, EBITDA = LIMS revenue less costs',
    f1.weeks.length === f0.weeks.length + 1 && nw1 && Number(nw1.books_revenue) === 12345 && Number(nw1.costs) === 10000 && Math.abs(Number(nw1.ebitda) - (Number(nw1.lims_revenue) - 10000)) < 0.01, JSON.stringify(nw1));
  await fin('/finance/weeks', { reason: 'Rule check', rows: [{ site_code: 'TPS', week_ending: lastThu, costs: 10000, books_revenue: 12345, lims_revenue: 999999, revenue: 999999 }] });
  const f2 = (await fin('/finance')).weeks.find((w) => w.site_code === 'TPS' && String(w.week_ending).slice(0, 10) === lastThu);
  check('...the LIMS revenue cannot be typed (a value sent for it is ignored)', Number(f2.lims_revenue) === Number(nw1.lims_revenue) && Number(f2.books_revenue) === 12345);
  // the forecasts to and from Excel
  const dl = await page.evaluate(async (y) => { const r = await fetch(`/api/finance/plans.xlsx?year=${y}`); return { ok: r.ok, type: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength }; }, new Date().getFullYear());
  check('The forecasts download as an Excel file', dl.ok && /spreadsheetml/.test(dl.type) && dl.n > 1000, JSON.stringify(dl));
  const ym = `${new Date().getFullYear()}-12`;
  const csv = `Lab,Month (YYYY-MM),Plan,Revenue,Costs\nTPS,${ym},Monthly forecast,77777,66666\nTPS,${ym},Bad plan,1,1\n`;
  const pv = await fin('/finance/plans/preview', { file_name: 'forecasts.csv', content_base64: Buffer.from(csv).toString('base64') });
  check('An uploaded file shows each change and each error before saving', pv.rows.length === 2 && ['Update', 'Create'].includes(pv.rows[0].action) && pv.rows[1].action === 'Error', JSON.stringify(pv.rows.map((x) => x.action)));
  await page.click('#planul'); await page.waitForSelector('.modal #planf');
  await page.setInputFiles('.modal #planf', { name: 'forecasts.csv', mimeType: 'text/csv', buffer: Buffer.from(`Lab,Month (YYYY-MM),Plan,Revenue,Costs\nTPS,${ym},Monthly forecast,77777,66666\n`) });
  await page.waitForSelector('.modal [data-ok]:not([disabled])'); await page.click('.modal [data-ok]');
  await sign(page, { reason: 'Forecast update from Excel' }); await page.waitForTimeout(1200);
  const f3 = await fin('/finance');
  check('...saved from the upload with a reason', f3.plans.some((p) => p.site_code === 'TPS' && p.month === ym && p.plan === 'Monthly forecast' && Number(p.revenue) === 77777 && Number(p.costs) === 66666));
  await shot('dash_06_finance');
  const fnav = await page.locator('#nav').innerText();
  check('The Finance group sees the executive dashboard and the finance figures, not Billing', /Executive dashboard/.test(fnav) && /Finance figures/.test(fnav) && !/Ready to invoice/.test(fnav));

  // ================================================================ Admin > Dashboard widgets
  await signIn(page, BASE, 'Alex Kiddle', '#/admin/dashboard-widgets'); await page.waitForSelector('#g .gwrap');
  const heads = await page.locator('#g .gwrap th').allInnerTexts();
  const col = heads.findIndex((h) => h.trim() === 'Analyst') + 1;
  const rowsW = await page.locator('#g .gwrap > table > tbody > tr').allInnerTexts();
  const r = rowsW.findIndex((t) => t.startsWith('Low stock against demand')) + 1;
  check('Admin > Dashboard widgets: widgets by group, ticked as the standard groups have them', col > 0 && r > 0 && (await cell('#g', r, col).locator('.chk.on').count()) === 1);
  await cell('#g', r, col).click(); await page.keyboard.press('Space'); await page.waitForTimeout(200);
  await page.click('#g .savebar [data-save]'); await sign(page, { reason: 'Analysts use the supplies widget instead' }); await page.waitForTimeout(1200);
  const ana = await as('analyst');
  const ah = await ana('/dashboard/home');
  check('The Analyst group loses the widget (saved with a reason)', !ah.widgets.some((w) => w.code === 'low_stock_risk') && ah.widgets.some((w) => w.code === 'backlog'));
  await shot('dash_07_widgets');

  // ================================================================ an inventory item names its department
  const lot = (await sup('/dashboard/home')).widgets.find((w) => w.code === 'low_stock_risk').data.table.rows.find((x) => x[2].text !== 'No department set');
  if (lot) { await go(lot[0].href); check('An inventory item names its department (low stock against demand)', (await page.locator('main').innerText()).includes(lot[2].text)); }
  else check('An inventory item names its department (low stock against demand)', false, 'no lot with a department in the widget');

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
