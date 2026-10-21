// R-2 (migration 027): OOS investigations end to end in the browser, on the demo Vitamin C stability lots (client
// specification at least 90 %).
//  - VC-2403 (dietary supplement), batch waiting in QC Review at 88.0 %: the Lab Supervisor sees the result flagged
//    with "Open OOS…" (nothing opened by itself), opens the investigation (signed), sees the automatic data checks,
//    then cancels it (the specification was fine, but this is the opener's right) and the flag returns.
//  - VC-2402 (cGMP, 84.0 %, approved): the analyst opens it from the sample page; Full Phase I: the analyst answers
//    the checklist (fill down), the supervisor signs the second section, QA concludes "OOS confirmed" and the report
//    PDF is made. QA finalizes the COA; the Outbox has the "Out of specification result" email with the report and
//    the client's links. The client answers "Retest in duplicate" through the link (no sign-in); the Project Manager
//    orders the client retest from the answer (billing waits for QA's determination).
//  - VC-2401 (dietary supplement, 82.0 %, approved): Check and Acknowledge by the Lab Supervisor with "Assignable
//    cause found"; the lab investigation retest is ordered (not billed) and the invalid result leaves the queue.
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
  const session = async (who) => {
    const cookie = await login(BASE, who, PASSWORD);
    const users = (await call(BASE, '/users', { cookie })).data;
    const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
    return async (p, opts = {}) => {
      const res = await fetch(BASE + '/api' + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site }, body: opts.body ? JSON.stringify(opts.body) : undefined });
      return { ok: res.ok, data: await res.json().catch(() => ({})) };
    };
  };
  const toastText = async () => { await page.waitForSelector('.toast', { timeout: 30000 }); return page.locator('.toast').last().innerText(); };
  const main = () => page.locator('main').innerText();
  // answer a checklist grid: "Yes" in the first row, filled down to the last (Ctrl+D)
  const answerAll = async (host) => {
    const rows = await page.locator(`${host} tbody tr`).count();
    await page.locator(`${host} tbody tr:nth-child(1) td:nth-child(2)`).click(); await page.keyboard.type('Yes'); await page.waitForTimeout(120); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
    await page.locator(`${host} tbody tr:nth-child(1) td:nth-child(2)`).click(); await page.locator(`${host} tbody tr:nth-child(${rows}) td:nth-child(2)`).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Control+d'); await page.waitForTimeout(200);
    return rows;
  };

  const sup = await session('labsup');
  const orders = (await sup('/orders')).data; const all = orders.rows || orders;
  const o40 = all.find((o) => o.po_number === 'PO-45240'); const o41 = all.find((o) => o.po_number === 'PO-45241');
  const d40 = (await sup(`/orders/${o40.id}`)).data; const d41 = (await sup(`/orders/${o41.id}`)).data;
  const s01 = d40.samples.find((s) => s.client_sample_id === 'VC-2401'); const s02 = d40.samples.find((s) => s.client_sample_id === 'VC-2402');
  const s03 = d41.samples.find((s) => s.client_sample_id === 'VC-2403');
  const bat3 = (await sup(`/testing/samples/${s03.id}/results`)).data.batches[0];
  check('(demo: PO-45240 and PO-45241 with VC-2401, VC-2402, VC-2403; VC-2403\'s batch waits in QC Review)', s01 && s02 && s03 && bat3 && bat3.status === 'Awaiting Review');

  // ---- QC Review: flagged, opened by hand, cancelled
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/testing/batches/${bat3.id}?step=review`);
  await page.waitForSelector('#rv_res tbody tr', { timeout: 30000 });
  await page.waitForFunction(() => /Open OOS…/.test(document.querySelector('#rv_res')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
  const rv = await page.locator('#rv_res').innerText();
  const nav = await page.locator('#nav').innerText();
  check('QC Review flags VC-2403\'s 88.0 % as out of specification with "Open OOS…"; nothing was opened by itself', /88\.0/.test(rv) && /Does not conform/.test(rv) && /Open OOS…/.test(rv)
    && (await sup('/oos')).data.rows.length === 0);
  check('OOS investigations is in the Testing menu', /OOS investigations/.test(nav));
  await shot('r2_01_qc_review_flag');
  await page.locator('#rv_res button.mini:text-is("Open OOS…")').first().click();
  await page.waitForSelector('.modal #f_reason'); await page.fill('.modal #f_reason', 'Result 88.0 % against at least 90 %; sample details checked with intake');
  await page.click('.modal [data-ok]'); await sign(page);
  await page.waitForFunction(() => /^#\/oos\//.test(location.hash) && /Automatic data checks/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 30000 });
  await page.waitForSelector('#checks .oosck');
  const p3 = await main();
  const ck3 = await page.$$eval('#checks .oosck', (els) => els.map((e) => e.className.replace('oosck ', '') + ':' + e.querySelector('b').textContent));
  check('Opened (signed "Opened by"): Check and Acknowledge, the result, the specification and a target date', /OOS-\d{6}: Vitamin C in CFL/.test(p3) && /Check and Acknowledge/.test(p3) && /88\.0 %/.test(p3) && /≥ 90/.test(p3) && /Target date/.test(p3), p3.slice(0, 200));
  check('The automatic data checks ran: lots, instruments, QC, the result worked out again, training, raw data, specification, sample, history',
    ck3.length >= 9 && ck3.some((x) => /^Pass:Result worked out again/.test(x)) && ck3.some((x) => /Specification on the test/.test(x)), ck3.join(' | '));
  check('Before the batch is approved, the reviewer\'s conclusion is offered with its checklist', /The batch must be approved in QC Review first/.test(p3) && (await page.$('#cl_rev')) !== null);
  await shot('r2_02_oos_opened');
  const id3 = (await page.evaluate(() => location.hash)).split('/')[2];
  await page.click('#cancel'); await page.waitForSelector('.modal #f_reason');
  await page.fill('.modal #f_reason', 'Opened to show the flow; the client confirmed a different specification is not intended (kept for the record)');
  await page.click('.modal [data-ok]'); await sign(page);
  await page.waitForFunction(() => /Cancelled/.test(document.querySelector('main .sub')?.innerText || ''), null, { timeout: 15000 });
  check('Whoever opened it may cancel it (signed, with a reason); it is kept, marked Cancelled', /Cancelled/.test(await main()) && !(await page.$('#cancel')));
  await page.goto(`${BASE}/#/testing/batches/${bat3.id}?step=review`); await page.waitForSelector('#rv_res tbody tr', { timeout: 30000 }); await page.waitForTimeout(400);
  check('Back in QC Review the result is flagged "Open OOS…" again', /Open OOS…/.test(await page.locator('#rv_res').innerText()));

  // ---- VC-2402, cGMP: Full Phase I, opened by the analyst from the sample page
  await signIn(page, BASE, 'Analyst (demo)', `#/samples/${s02.id}`);
  await page.waitForFunction(() => /Open OOS…/.test(document.querySelector('#rg')?.innerText || ''), null, { timeout: 30000 });
  check('The sample page offers "Open OOS…" on the approved nonconforming result', /84\.0/.test(await page.locator('#rg').innerText()));
  await page.locator('#rg button.mini:text-is("Open OOS…")').click(); await page.waitForSelector('.modal #f_reason');
  await page.click('.modal [data-ok]'); await sign(page);
  await page.waitForFunction(() => /^#\/oos\//.test(location.hash) && document.querySelector('#cl_analyst tbody tr'), null, { timeout: 30000 });
  const id2 = (await page.evaluate(() => location.hash)).split('/')[2];
  const p2 = await main();
  check('cGMP: Full Phase I, the analyst section open to the analyst, the supervisor and QA steps waiting', /Full Phase I/.test(p2) && /1\. Analyst investigation/.test(p2) && /Follows the analyst/.test(p2) && /Follows the supervisor/.test(p2));
  await page.click('#sg_analyst');
  check('Signing with items unanswered is refused', /Answer every item/.test(await toastText()));
  const n2 = await answerAll('#cl_analyst');
  const answered = await page.locator('#cl_analyst').innerText();
  check(`The analyst answers the checklist: "Yes" filled down all ${n2} items (Ctrl+D)`, (answered.match(/\bYes\b/g) || []).length === n2, `${(answered.match(/\bYes\b/g) || []).length}/${n2}`);
  await page.fill('#hy_analyst', 'None: the preparation and readings were normal');
  await page.fill('#cm_analyst', 'Raw data, calculation and materials reviewed; no laboratory error found.');
  await shot('r2_03_analyst_section');
  await page.click('#sg_analyst'); await sign(page);
  await page.waitForFunction(() => /Signed \(Investigated by\)/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 15000 });
  check('The analyst section is signed ("Investigated by"); status Analyst signed', /Analyst signed/.test(await main()));

  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/oos/${id2}`); await page.waitForSelector('#cl_supervisor tbody tr');
  await answerAll('#cl_supervisor'); await page.fill('#cm_supervisor', 'Discussed with the analyst; QC and history in control.');
  await page.click('#sg_supervisor'); await sign(page);
  await page.waitForFunction(() => /Signed \(Reviewed by\)/.test(document.querySelector('main')?.innerText || ''), null, { timeout: 15000 });
  check('The supervisor signs the second section ("Reviewed by")', /Supervisor signed/.test(await main()) && !(await page.$('#cc_go')));

  await signIn(page, BASE, 'QA Reviewer (demo)', `#/oos/${id2}`); await page.waitForSelector('#cc_go');
  await page.selectOption('#cc_c', 'OOS confirmed');
  await page.fill('#cc_j', 'No assignable laboratory cause: the analyst and supervisor investigations and the data checks found none. The result is valid.');
  await page.click('#cc_go'); await sign(page);
  await page.waitForSelector('#rep', { timeout: 60000 });
  const p2c = await main();
  const rep = await page.evaluate(async (u) => { const r = await fetch(u); const t = new Uint8Array(await r.arrayBuffer()); return r.headers.get('content-type') + ' ' + String.fromCharCode(...t.slice(0, 5)); }, await page.getAttribute('#rep', 'href'));
  check('QA concludes "OOS confirmed" (signed "Approved by"): Closed, and the investigation report is a PDF', /Closed/.test(p2c) && /OOS confirmed/.test(p2c) && /application\/pdf %PDF-/.test(rep), rep);
  await shot('r2_04_phase1_closed');

  // ---- release: QA finalizes VC-2402; the OOS email with the report and the links
  const qa = await session('qa.reviewer');
  const q = (await qa('/reports/queue')).data.rows;
  const r2 = q.find((r) => r.sample_id === s02.id); const r1 = q.find((r) => r.sample_id === s01.id);
  check('The queue: VC-2402 is no longer held (confirmed OOS), VC-2401 is held until its investigation', r2 && !r2.oos_problem && /OOS confirmed/.test(r2.oos_codes || '') && r1 && /open the OOS investigation/.test(r1.oos_problem || ''), `${r2 && r2.oos_problem} / ${r1 && r1.oos_problem}`);
  const pv = (await qa('/reports/preview', { method: 'POST', body: { sample_id: s02.id, tests: [r2.requested_test_id] } })).data;
  const acks = Object.fromEntries((pv.checks || []).filter((k) => k.level === 'Warning').map((k) => [k.code, 'Reviewed with the OOS investigation']));
  const fin = await qa('/reports/finalize', { method: 'POST', body: { signature: { username: 'qa.reviewer', password: PASSWORD }, items: [{ sample_id: s02.id, tests: [r2.requested_test_id], acks }] } });
  check('QA finalizes VC-2402 with the confirmed out-of-specification result', fin.ok, fin.data.error || '');
  await page.goto(`${BASE}/#/outbox`); await page.waitForSelector('#g tbody tr');
  await page.locator('#g tbody tr td:has-text("Out of specification")').first().click(); await page.waitForSelector('.modal .email');
  const em = await page.locator('.modal .email').innerText();
  const link = (em.match(/https?:\/\/\S+oos-response\.html\?t=[\w-]+&a=duplicate/) || [])[0];
  const att = await page.locator('.modal .email a:has-text("investigation report")').getAttribute('href').catch(() => null);
  const attHead = att ? await page.evaluate(async (u) => { const r = await fetch(u); const t = new Uint8Array(await r.arrayBuffer()); return String.fromCharCode(...t.slice(0, 5)); }, att) : '';
  check('The Outbox has the "Out of specification result" email: Phase II re-testing explained, a link per answer, the Phase I report attached',
    /Phase II/.test(em) && /84\.0/.test(em) && !!link && /a=retest/.test(em) && /a=ack/.test(em) && attHead === '%PDF-', `${link || 'no link'} ${attHead}`);
  await shot('r2_05_oos_email');
  await page.click('.modal [data-ok]');

  // ---- the client answers through the link (no sign-in)
  const cp = await ctx.browser().newContext(); const client = await cp.newPage();
  await client.goto(link.replace(/^https?:\/\/[^/]+/, BASE)); await client.waitForSelector('input[name=c]');
  const ctext = await client.locator('main').innerText();
  const pre = await client.$eval('input[name=c]:checked', (e) => e.value).catch(() => '');
  check('The client\'s page (no sign-in) shows the result and preselects the answer from the link', /84\.0 %/.test(ctext) && /VC-2402/.test(ctext) && pre === 'Retest in duplicate', pre);
  await client.fill('#nm', 'Sam Nguyen'); await client.fill('#nt', 'Please retest in duplicate before we decide on the lot.');
  await client.click('#go'); await client.waitForSelector('.ok');
  check('The answer is sent', /Thank you/.test(await client.locator('main').innerText()));
  await client.screenshot({ path: path.join(OUT, 'r2_06_client_answer.png'), fullPage: true });
  await cp.close();

  // ---- the Project Manager orders the client retest from the answer
  await signIn(page, BASE, 'projmgr', '#/oos'); await page.waitForSelector('#g tbody tr');
  const lst = await page.locator('#g').innerText();
  check('The OOS list (Project Manager): the investigation with "1 to handle"', /OOS-\d{6}/.test(lst) && /1 to handle/.test(lst));
  await page.goto(`${BASE}/#/oos/${id2}`); await page.waitForSelector('#cr_g tbody tr');
  check('The client\'s answer waits on the investigation', /Retest in duplicate/.test(await page.locator('#cr_g').innerText()) && /Not yet/.test(await page.locator('#cr_g').innerText()));
  await page.locator('#cr_g button.mini:text-is("Order the client retest…")').click(); await page.waitForSelector('.modal #f_replicates');
  check('The retest dialog takes the duplicate from the client\'s answer', (await page.$eval('.modal #f_replicates', (e) => e.value)) === '2');
  await page.click('.modal [data-ok]'); await sign(page);
  await page.waitForSelector('#rt_g tbody tr', { timeout: 15000 });
  const rtx = await page.locator('#rt_g').innerText();
  check('The client retest is ordered (signed "Ordered by"): a re-prep in duplicate, billing pending QA\'s determination; the answer is handled',
    /Client OOS Retest/.test(rtx) && /Pending QA determination/.test(rtx) && /\b2\b/.test(rtx) && !/Not yet/.test(await page.locator('#cr_g').innerText()));
  await shot('r2_07_client_retest');
  const od40 = (await sup(`/orders/${o40.id}`)).data;
  check('The order has work again (no longer Reported/Approved)', !['Reported', 'Approved'].includes(od40.order.status), od40.order.status);

  // ---- VC-2401: Check and Acknowledge with an assignable cause, then the lab investigation retest
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/samples/${s01.id}`);
  await page.waitForFunction(() => /Open OOS…/.test(document.querySelector('#rg')?.innerText || ''), null, { timeout: 30000 });
  await page.locator('#rg button.mini:text-is("Open OOS…")').click(); await page.waitForSelector('.modal #f_reason');
  await page.click('.modal [data-ok]'); await sign(page);
  await page.waitForSelector('#cl_rev tbody tr', { timeout: 30000 });
  const id1 = (await page.evaluate(() => location.hash)).split('/')[2];
  await answerAll('#cl_rev');
  await page.selectOption('#cc_c', 'Assignable cause found');
  await page.fill('#cc_j', 'The day 14 dilution used the wrong volumetric flask (100 mL instead of 50 mL).');
  await page.click('#cc_go');
  check('"Assignable cause found" needs the cause described', /Describe the assignable cause/.test(await toastText()));
  await page.fill('#cc_a', 'Dilution error at day 14: wrong flask volume, recorded in the bench notes');
  await page.click('#cc_go'); await sign(page);
  await page.waitForSelector('#rt_lab', { timeout: 60000 });
  check('The reviewer concludes Check and Acknowledge: Closed with the cause; the lab investigation retest is offered', /Assignable cause found/.test(await main()) && /Dilution error/.test(await main()));
  await page.click('#rt_lab'); await page.waitForSelector('.modal #f_replicates'); await page.click('.modal [data-ok]'); await sign(page);
  await page.waitForSelector('#rt_g tbody tr', { timeout: 15000 });
  check('The lab investigation retest is ordered, not billed', /Lab Investigation Retest/.test(await page.locator('#rt_g').innerText()) && /Non-billable/.test(await page.locator('#rt_g').innerText()));
  await shot('r2_08_lab_retest');
  const q3 = (await qa('/reports/queue')).data.rows;
  const res1 = (await sup(`/testing/samples/${s01.id}/results`)).data.results;
  check('The invalid result is superseded (kept, not shown as approved) and VC-2401 leaves the queue; the retest waits in the backlog',
    !q3.some((r) => r.sample_id === s01.id) && !res1.some((x) => x.result_key === null && x.stage === 'Final'), `${q3.filter((r) => r.sample_id === s01.id).length} queued, ${res1.length} results`);

  // ---- QA: the checklists and target times; the audit icon
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/oos/config'); await page.waitForSelector('#ci tbody tr');
  const cfg = await main();
  check('QA keeps the checklists and target times (Admin > QA > OOS checklists)', /Close within/.test(cfg) && /Full Phase I/.test(cfg) && /Check and Acknowledge/.test(cfg) && /OOS checklists/.test(await page.locator('#nav').innerText()));
  await page.goto(`${BASE}/#/oos/${id1}`); await page.waitForSelector('main .auditbtn'); await page.click('main .auditbtn'); await page.waitForTimeout(1500);
  check('The investigation has an audit trail (the audit icon)', /oos|OOS-/i.test(await page.locator('.modal, .drawer, body').last().innerText()));

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
