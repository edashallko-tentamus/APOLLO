// 0.17.1 (migration 033): serving size, Part B, end to end. CFL's demo serving tests (seed_026) are verified and
// approved; a quote shows the per-serving calculation as a priced line; ticking "Per serving" on a sample orders the
// Serving weight test at its catalogue price; the COA release check blocks the per-serving results until it is
// measured; the analyst records 10 weighings (pasted in one row) and their average; QC Review approves it and the
// unit weight goes back to the sample; the COA then carries the amount per serving. The unplanned case: a limit per
// serving nobody asked the serving for, the request on the sample page and the client's consent ordering the test.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, call, login, verifyVersion } = require('./auth');
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
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(800); };
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const toastLike = async (re) => { let all = []; for (let i = 0; i < 60; i++) { all = await page.locator('.toast').allInnerTexts(); const h = all.filter((x) => re.test(x)).pop(); if (h) return h; await page.waitForTimeout(250); } return all.join(' / '); };
  const as = async (who) => {
    const cookie = await login(BASE, who, PASSWORD);
    const users = (await call(BASE, '/users', { cookie })).data;
    const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
    return async (p, opts = {}) => { const res = await fetch(BASE + '/api' + p, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site },
      body: opts.body ? JSON.stringify(opts.body) : undefined }); return { ok: res.ok, data: await res.json().catch(() => ({})) }; };
  };
  const ak = await as('akiddle'); const ana = await as('analyst'); const sup = await as('labsup'); const pm = await as('projmgr');
  const sig = (who) => ({ username: who, password: PASSWORD });

  // ---- the serving tests: catalogue role, verified and approved
  const cat = (await ak('/catalog')).data;
  const tw = cat.find((t) => t.test_name === 'Serving weight (10 units)'); const td = cat.find((t) => t.test_name === 'Density (g/mL)');
  const ew = (await ak('/catalog/' + tw.test_id)).data; const ed = (await ak('/catalog/' + td.test_id)).data;
  check('The catalogue has CFL\'s Serving weight test ($45) and Density test ($60), marked as serving tests',
    ew.test.serving_role === 'Serving weight' && ed.test.serving_role === 'Density' && Number(tw.list_price) === 45 && Number(td.list_price) === 60);
  const verOf = async (tid) => { const d = (await ak('/methods/tests/' + tid)).data; return (d.versions || []).find((v) => v.status === 'Draft' || v.status === 'Effective'); };
  const vw = await verOf(tw.test_id); const vd = await verOf(td.test_id);
  if (vw.status === 'Draft') {
    const ow = await verifyVersion(BASE, vw.id); const od = await verifyVersion(BASE, vd.id);
    check('Both pass their workflow verification (the automated run records the 10 weighings)', /^Pass/.test(ow) && /^Pass/.test(od), `${ow} / ${od}`);
    const aw = await sup(`/methods/versions/${vw.id}/approve`, { body: { signature: sig('labsup') } }); const ad = await sup(`/methods/versions/${vd.id}/approve`, { body: { signature: sig('labsup') } });
    check('Approved by the Lab Supervisor', aw.ok && ad.ok, (aw.data.error || '') + (ad.data.error || ''));
  } else check('(already approved)', true);
  await signIn(page, BASE, 'Alex Kiddle', `#/catalog/${tw.test_id}`); await page.waitForSelector('#f_serving_role');
  check('The catalogue editor shows "Serving test: Serving weight"', (await page.inputValue('#f_serving_role')) === 'Serving weight');

  // ---- a quote: the per-serving calculation as a priced line
  const beta = (await ak('/clients')).data.find((c) => c.legal_name === 'Beta Foods LLC');
  const q = (await ak('/quotes', { body: { client_id: beta.id, project_name: 'Gummies, results per serving' } })).data;
  await go(`#/quote/${q.version_id}`); await page.waitForSelector('#servline');
  await page.click('#servline'); await page.waitForSelector('.modal #f_role'); await page.click('.modal [data-ok]');
  await toastLike(/added to the quote/); await page.waitForSelector('#lg tbody tr');
  const ql = await page.locator('#lg tbody tr').allInnerTexts(); const tot = await page.locator('#tot').innerText();
  check('"+ Per-serving calculation…" adds the Serving weight test at $45; the quote total shows it', ql.some((t) => /Serving weight \(10 units\)[\s\S]*\$45\.00/.test(t)) && /\$45\.00/.test(tot), ql.join(' | '));
  await shot('sv_01_quote');

  // ---- a sample ticked "Per serving": the Serving weight test is ordered, the COA is held
  const queue = (await pm('/reports/queue')).data.rows || [];
  const qr = queue.find((r) => !r.is_gmp && !r.oos_problem);
  const smp = (await ak('/samples/' + qr.sample_id)).data;
  const sv = await ak(`/orders/${smp.order.id}/samples`, { body: { rows: [{ id: qr.sample_id, serving_count: 2, serving_count_unit: 'capsule', serving_size: 1.2, serving_unit: 'g', report_per_serving: true }], reason: 'Serving from the label; results per serving asked' } });
  const s1 = (await ak('/samples/' + qr.sample_id)).data;
  const swt = s1.tests.find((t) => t.test_name === 'Serving weight (10 units)');
  check('"Per serving" on the sample orders the Serving weight test at its catalogue price ($45: not on the client\'s quote)', sv.ok && swt && swt.serving_order && Number(swt.price) === 45, sv.data.error || '');
  await go(`#/orders/${smp.order.id}`); await page.waitForSelector('#sg tbody tr');
  check('(the order grid has the Per serving column)', /Per serving/.test(await page.locator('#sg thead').first().innerText()));
  await go(`#/samples/${qr.sample_id}`); await page.waitForSelector('#servcard');
  const card1 = await page.locator('#servcard').innerText();
  check('The sample page: results per serving asked; unit weight not measured; held, waiting for the Serving weight test', /Asked for on the order/.test(card1) && /Not measured/.test(card1) && /waiting for Serving weight \(10 units\)/.test(card1), card1.slice(0, 300));
  const pv1 = (await pm('/reports/preview', { body: { sample_id: qr.sample_id, tests: [qr.requested_test_id] } })).data;
  const blk = (pv1.checks || []).find((k) => k.code === 'serving_measured');
  check('The COA release check blocks the per-serving results until the serving weight is measured (with a link to the sample)', blk && blk.level === 'Block' && /waiting for Serving weight/.test(blk.detail) && (blk.links || []).length === 1, JSON.stringify(blk || pv1.error || ''));

  // ---- the bench: 10 weighings in one row, their average
  const nb = await ana('/testing/batches', { body: { test_version_id: vw.id } });
  check('(a batch of the Serving weight test)', nb.ok, nb.data.error || '');
  let bd = (await ana('/testing/batches/' + nb.data.id)).data;
  const run = (k) => bd.steps.find((s) => s.step_key === k).id;
  const done1 = await ana(`/testing/step-runs/${run('batch')}/complete`, { body: { signature: sig('analyst') } });
  await signIn(page, BASE, 'Analyst (demo)', `#/testing/batches/${nb.data.id}?step=weigh`); await page.waitForSelector('main table thead');
  await page.waitForTimeout(800);
  const head = await page.locator('main .gwrap thead').first().innerText();
  check('The Weighing step shows 10 weighing columns and the average', done1.ok && /\b1\b[\s\S]*\b10\b/.test(head) && /Average \(g\)/.test(head), head.replace(/\s+/g, ' ').slice(0, 200));
  await page.locator('main .gwrap tbody tr:nth-child(1) td:nth-child(4)').first().click();
  await paste('0.592\t0.594\t0.596\t0.598\t0.600\t0.602\t0.604\t0.606\t0.608\t0.610');
  await page.waitForTimeout(300);
  const rowTxt = await page.locator('main .gwrap tbody tr:nth-child(1)').first().innerText();
  check('Ten weights pasted from the balance printout in one row: the average is 0.601 g', /0\.601/.test(rowTxt), rowTxt.replace(/\s+/g, ' '));
  await shot('sv_02_weighings');
  await page.locator('.savebar.show button.primary').first().click(); await page.waitForTimeout(1200);
  bd = (await ana('/testing/batches/' + nb.data.id)).data;
  const fin = (bd.results || []).find((r) => r.is_final);
  check('Saved: the live result is the average unit weight, 0.6010 g', fin && Number(fin.value) === 0.601 && fin.reported === '0.6010', JSON.stringify(fin));
  const opt = (await ana(`/testing/batches/${nb.data.id}/options`)).data;
  const bal = (opt.equipment || []).find((e) => /Top-loading balance/.test(e.type_name) && e.availability === 'Available');
  const eq = bal ? await ana(`/testing/step-runs/${run('weigh')}/equipment`, { body: { equipment_id: bal.id } }) : { ok: false, data: { error: 'no balance' } };
  const c2 = await ana(`/testing/step-runs/${run('weigh')}/complete`, { body: { signature: sig('analyst') } });
  const c3 = await ana(`/testing/step-runs/${run('calc')}/complete`, { body: { signature: sig('analyst') } });
  check('(the balance recorded; weighing and calculation completed)', eq.ok && c2.ok && c3.ok, [eq, c2, c3].map((x) => x.data.error || '').join(' '));
  bd = (await sup('/testing/batches/' + nb.data.id)).data;
  for (const m of bd.review_marks || []) await sup(`/testing/batches/${nb.data.id}/steps/${m.step_run_id}/review-mark`, { body: {} });
  const ap = await sup(`/testing/batches/${nb.data.id}/approve`, { body: { signature: sig('labsup') } });
  const s2 = (await ak('/samples/' + qr.sample_id)).data.sample;
  check('Approved in QC Review: the sample\'s unit weight is 0.601 g (measured), the serving 2 x 0.601 = 1.202 g', ap.ok && Number(s2.unit_weight) === 0.601 && !!s2.unit_weight_result_id && Number(s2.serving_size) === 1.202 && s2.serving_unit === 'g', ap.data.error || JSON.stringify({ u: s2.unit_weight, s: s2.serving_size }));
  const pv2 = (await pm('/reports/preview', { body: { sample_id: qr.sample_id, tests: [qr.requested_test_id] } })).data;
  const t2 = (pv2.content.tests || []).find((t) => t.requested_test_id === qr.requested_test_id);
  check('Measured and used: no hold; the COA has the per-serving column (the serving shown as measured)',
    !(pv2.checks || []).some((k) => k.code === 'serving_measured') && t2 && t2.per_serving && t2.results.some((r) => r.per_serving) && /measured/.test(pv2.content.sample.serving), JSON.stringify(t2 && t2.results.map((r) => r.per_serving)));
  await signIn(page, BASE, 'Alex Kiddle', `#/samples/${qr.sample_id}`); await page.waitForSelector('#servcard');
  check('The sample page shows the measured unit weight, nothing held', /0\.601 g \(measured\)/.test(await page.locator('#servcard').innerText()) && (await page.locator('#servheld').count()) === 0);
  await shot('sv_03_sample_measured');

  // ---- unplanned: a limit per serving on another sample nobody asked the serving for
  const qr2 = queue.find((r) => r.sample_id !== qr.sample_id && !r.is_gmp && !r.oos_problem);
  const sp = (await ak('/specs?requested_test=' + qr2.requested_test_id)).data;
  const an = sp.analytes[0];
  const ex = sp.specs.find((x) => x.analyte_id === an.analyte_id);
  await ak(`/specs`, { body: { requested_test: qr2.requested_test_id, reason: 'Client asked for a limit per serving', rows: [ex ? { id: ex.id, basis: 'Per serving', unit: 'mg', max_value: 500, min_value: null, text_value: null } : { analyte_id: an.analyte_id, basis: 'Per serving', unit: 'mg', max_value: 500, source: 'Client' }] } });
  const o2 = (await ak('/samples/' + qr2.sample_id)).data;
  await ak(`/orders/${o2.order.id}/samples`, { body: { rows: [{ id: qr2.sample_id, serving_size: 1, serving_unit: 'g' }], reason: 'Serving from the label' } });
  await go(`#/samples/${qr2.sample_id}`); await page.waitForSelector('#servcard');
  check('A limit per serving, the label\'s 1 g only: held ("the serving weight is not measured") with "Request the serving weight test…"',
    /the serving weight is not measured/.test(await page.locator('#servcard').innerText()) && (await page.locator('[data-sreq="Serving weight"]').count()) === 1);
  await page.click('[data-sreq="Serving weight"]'); await page.waitForSelector('.modal #f_note');
  await page.fill('.modal #f_note', 'Emailing Jordan to ask'); await page.click('.modal [data-ok]');
  await toastLike(/waits for the client/); await page.waitForTimeout(800);
  await page.waitForSelector('#rsp tbody tr', { timeout: 15000 });
  const rq = await page.locator('#rsp').innerText();
  check('The request is listed with the split-off requests: Serving weight (10 units), awaiting consent', /Serving weight \(10 units\)/.test(rq) && /Awaiting consent/.test(rq), rq.slice(0, 200));
  await page.locator('#rsp button', { hasText: 'Consent given' }).click(); await page.waitForSelector('.modal #f_note');
  await page.fill('.modal #f_note', 'Jordan Reyes agreed by email'); await page.click('.modal [data-ok]');
  await page.waitForTimeout(1500);
  const o3 = (await ak('/samples/' + qr2.sample_id)).data;
  const t3 = o3.tests.find((t) => t.test_name === 'Serving weight (10 units)');
  check('The client\'s consent orders the Serving weight test (catalogue price); the sample still waits for it', t3 && t3.serving_order && (o3.serving_held || []).some((h) => /waiting for Serving weight/.test(h.problem)));
  await shot('sv_04_unplanned');

  check('No page errors and no native browser dialogs', errors.length === 0 && native === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exit(1); });
