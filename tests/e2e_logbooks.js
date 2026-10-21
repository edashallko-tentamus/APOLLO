// Electronic logbooks, L-1 (migration 034) and L-2 (migration 035), end to end in the browser.
//  L-1: Testing > Logbooks (the eight demo logbooks, what is due); the demo Analyst records the daily balance check by
//       paste, one balance fails and the reason is asked before signing; the failing entry flags the batch steps that used
//       the balance (shown on the entry, the equipment page and in QC Review, where the reviewer accepts the flag);
//       QA approves the entries in Logbook review (signed, not their own); a Lab Supervisor designs a new logbook by
//       paste and QA approves the design; a stability study shows its chamber's excursion.
//  L-2: USP <61> suitability version 2 (the CFU added comes from the scanned challenge inoculum) passes its workflow
//       verification (the run scans the approved inocula) and the Lab Supervisor approves it. The Analyst counts a new
//       S. aureus inoculum in its logbook (it makes the lot), runs the test (the bench through the API, as the screens
//       do) and scans the inoculum lots at Inoculate: the S. aureus recovery waits for QA's approval of the new entry and
//       is calculated once QA approves it. USP <62>: the aliquots intake weighed are scanned at Weigh (weight and
//       balance), and QC Review lists them with who weighed them.
// Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, call, login, verifyVersion } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

// an API session for a demo user at CFL; signed calls send the user's own password (as the signature dialog does)
async function as(who) {
  const cookie = await login(BASE, who, PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
  return async (p, body, signed) => {
    const res = await fetch(BASE + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site },
      body: body ? JSON.stringify({ ...body, ...(signed ? { signature: { username: who, password: PASSWORD } } : {}) }) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
}

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(900); };
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const cell = (host, r, c) => page.locator(`${host} .gwrap > table > tbody > tr:nth-child(${r}) > td:nth-child(${c})`);
  const pasteAt = async (host, r, c, text) => { await cell(host, r, c).click(); await paste(text); await page.waitForTimeout(250); };
  const alex = await as('akiddle'); const sup = await as('labsup'); const ana = await as('analyst'); const qa = await as('qa.reviewer');

  // ================================================================ L-1: the logbooks
  await signIn(page, BASE, 'Analyst (demo)', '#/logbooks'); await page.waitForSelector('#g tbody tr');
  const lbs = await page.locator('#g tbody tr').allInnerTexts();
  const nav = await page.locator('#nav').innerText();
  check('Testing > Logbooks lists the eight demo logbooks (balances, pipettes, temperatures, cultures, inocula, controls, sample weights)',
    lbs.length === 8 && /LB-0001\s+Daily balance check/.test(lbs[0]) && lbs.some((t) => /LB-0008/.test(t) && /Sample weights/.test(t)) && /Logbooks/.test(nav), `${lbs.length}`);
  const list = await ana('/logbooks');
  const lb = (code) => list.rows.find((x) => x.logbook_code === code);
  check('What is due now is listed (the monthly pipette checks and today\'s controls)', (await page.locator('#due tbody tr').count()) === list.due.length && list.due.some((x) => x.logbook_code === 'LB-0002'), String(list.due.length));

  // ================================================================ L-2 set-up (API): USP <61> suitability version 2 on a sample
  const tl = await sup('/methods/tests'); const t61 = (tl.rows || tl).find((t) => t.test_name === 'USP <61> Method Suitability (TAMC/TYMC)');
  const v2 = (await sup('/methods/tests/' + t61.id)).versions.find((v) => v.status === 'Draft');
  // CFL requires a workflow verification: the run scans the approved challenge inocula the protocol picked
  const outcome = await verifyVersion(BASE, v2.id);
  check('The workflow verification of USP <61> version 2 passes: its run scans each organism\'s approved challenge inoculum and the recovery matches the independent calculation', outcome === 'Pass', outcome);
  await sup(`/methods/versions/${v2.id}/approve`, { reason: 'Approved for the logbook browser test' }, true);
  check('USP <61> version 2 reads the CFU added from the scanned inoculum ({inoc.cfu_added}) and is approved by the Lab Supervisor',
    (await sup('/methods/tests/' + t61.id)).versions.some((v) => v.version_no === 2 && v.status === 'Effective'));
  const acme = (await alex('/clients')).find((c) => c.client_code === 'CL-00005');
  const q = await alex('/quotes', { client_id: acme.id, project_name: 'Method suitability (logbook test)' });
  await alex(`/versions/${q.version_id}/lines`, { rows: [{ test_id: t61.id, quantity: 1 }], prefill: true });
  await alex(`/versions/${q.version_id}/status`, { status: 'Quoted', reason: 'Issued' });
  await alex(`/quotes/versions/${q.version_id}/decide`, { decision: 'Accepted', contact_id: (await alex('/order-setup/' + acme.id)).contacts[0].id });
  const line = (await alex(`/versions/${q.version_id}`)).lines.find((l) => l.test_name === t61.test_name);
  const ord = (await alex('/orders')).find((o) => o.po_number === 'PO-45231');
  const vc = (await alex('/orders/' + ord.id)).samples.find((s) => s.client_sample_id === 'VC-2303');
  await alex(`/orders/${ord.id}/add-test`, { sample_ids: [vc.id], line_id: line.line_id });

  // ================================================================ L-2: a new S. aureus challenge inoculum, recorded by paste
  const lb5 = await ana('/logbooks/' + lb('LB-0005').id);
  const saCulture = lb5.opts.lots.find((x) => x.item_name === 'Staphylococcus aureus ATCC 6538');
  await go(`#/logbooks/${lb('LB-0005').id}?tab=record`); await page.waitForSelector('#body #g tbody tr');
  // When | Working culture | Passage (calc) | Volume plated | Count 1 | Count 2 | CFU/mL (calc) | Volume added | CFU added (calc) | Volume made
  await pasteAt('#body', 1, 2, saCulture.lot_code); await pasteAt('#body', 1, 4, '0.1\t44\t46'); await pasteAt('#body', 1, 8, '0.1'); await pasteAt('#body', 1, 10, '10');
  const prev = await page.locator('#body #g tbody tr').first().innerText();
  check('The record grid previews the calculated values (passage from the culture\'s lot, 450 CFU/mL, 45 CFU added) and Pass', /450/.test(prev) && /\b45\b/.test(prev) && /Pass/.test(prev), prev.replace(/\s+/g, ' '));
  await page.click('#body #save'); await sign(page); await page.waitForTimeout(1500);
  const madeToast = await toasts();
  const lotCode = (madeToast.match(/lots? made: (INV-\d+)/) || [])[1];
  check('Signed once: the entry is recorded and its lot is made', /Recorded 1 entry/.test(madeToast) && !!lotCode, madeToast);
  await shot('lb_01_inoculum');
  const lb5b = await ana('/logbooks/' + lb('LB-0005').id);
  const newInoc = lb5b.entries.find((e) => e.created_lot_code === lotCode);

  // ================================================================ L-2: the bench (API, as the screens do), scanning the inoculum lots
  const bl = await ana('/testing/backlog');
  const rt = bl.rows.find((x) => x.test_name === t61.test_name && x.version_no === 2);
  const batch = await ana('/testing/batches', { test_version_id: rt.test_version_id, items: [{ requested_test_id: rt.requested_test_id }] });
  let bd = await ana('/testing/batches/' + batch.id);
  const opts = await ana(`/testing/batches/${batch.id}/options`);
  const run = (k) => bd.steps.find((s) => s.step_key === k).id;
  const ents = bd.entries.map((e) => e.id);
  const lotId = (re) => opts.lots.find((l) => re.test(`${l.lot_code} ${l.item_name || ''}`)).id;
  const eqId = (re) => opts.equipment.find((e) => re.test(e.equipment_name)).id;
  const complete = async (k) => { await ana(`/testing/step-runs/${run(k)}/complete`, {}, true); bd = await ana('/testing/batches/' + batch.id); };
  const load = async (k) => { const l = await ana(`/testing/step-runs/${run(k)}/loads`, { equipment_id: eqId(/Incubator/), entry_ids: ents }); await ana(`/testing/loads/${l.id}`, { time_out: 'now', note: 'Browser test: taken out at once' }); };
  const counts = async (k, base) => { const ids = bd.steps.find((s) => s.step_key === k).config.analyte_ids;
    await ana(`/testing/step-runs/${run(k)}/values`, { rows: bd.entries.flatMap((e) => ids.map((a, i) => ({ entry_id: e.id, analyte_id: a, value_num: base + i }))) }); };
  await complete('batch');
  await ana(`/testing/step-runs/${run('weigh')}/values`, { rows: ents.map((id) => ({ entry_id: id, value_num: 10.01 })) });
  await ana(`/testing/step-runs/${run('weigh')}/equipment`, { equipment_id: eqId(/Top-loading/) });
  await complete('weigh');
  await ana(`/testing/step-runs/${run('dil')}/values`, { rows: ents.map((id) => ({ entry_id: id, data: { fields: [{ aliquot: 10, diluent: 90 }] } })) });
  await complete('dil');
  for (const re of [new RegExp('^' + lotCode + ' '), /Challenge inoculum: Pseudomonas/, /Challenge inoculum: Bacillus/, /Challenge inoculum: Candida/, /Challenge inoculum: Aspergillus/]) {
    await ana(`/testing/step-runs/${run('inoc')}/materials`, { lot_id: lotId(re), purpose: 'Strain', volume: 0.1, volume_unit: 'mL', entry_ids: ents });
  }
  await complete('inoc');
  await ana(`/testing/step-runs/${run('plate_b')}/values`, { rows: ents.map((id) => ({ entry_id: id, value_num: 2 })) });
  await ana(`/testing/step-runs/${run('plate_b')}/materials`, { lot_id: lotId(/ Tryptic Soy Agar$/), purpose: 'Media', volume: 1, volume_unit: 'g', entry_ids: ents });
  await complete('plate_b'); await load('inc_b'); await complete('inc_b'); await counts('count_b', 40); await complete('count_b');
  await ana(`/testing/step-runs/${run('plate_f')}/values`, { rows: ents.map((id) => ({ entry_id: id, value_num: 2 })) });
  await ana(`/testing/step-runs/${run('plate_f')}/materials`, { lot_id: lotId(/Sabouraud/), purpose: 'Media', volume: 2, volume_unit: 'each', entry_ids: ents });
  await complete('plate_f'); await load('inc_f'); await complete('inc_f'); await counts('count_f', 30); await complete('count_f');
  const sa = bd.analytes.find((a) => a.analyte_name === 'Staphylococcus aureus').analyte_id;
  const smpEntry = bd.entries.find((e) => e.entry_type === 'Sample').id;
  const saRes = () => bd.results.find((r) => r.step_key === 'calc' && r.entry_id === smpEntry && r.analyte_id === sa);
  check('The S. aureus recovery waits for QA to approve the new inoculum entry; the other organisms are calculated from theirs',
    /Waiting for QA to approve/.test(saRes().waiting || '') && bd.results.filter((r) => r.step_key === 'calc' && r.entry_id === smpEntry && r.value !== null).length === 4, saRes().waiting);

  // the bench screens: the inoculum chips carry their logbook entries; the Results tab says what the recovery waits for
  await go(`#/testing/batches/${batch.id}?step=inoc`); await page.waitForSelector('#panel .card');
  const chips = await page.locator('#panel .tbchip').allInnerTexts();
  check('Inoculate: each inoculum lot is shown with the logbook entry it carries (LBE-…)', chips.filter((t) => /Challenge inoculum|INV-/.test(t) && /LBE-\d+/.test(t)).length >= 5 && chips.some((t) => t.includes(newInoc.entry_code)), chips.length + ' chips');
  await go(`#/testing/batches/${batch.id}?step=results`); await page.waitForSelector('#res tbody tr');
  check('Results tab: "Waiting for QA to approve" the S. aureus inoculum', /Waiting for QA to approve/.test(await page.locator('#res').innerText()));
  await shot('lb_02_waiting_for_qa');

  // ================================================================ L-1: the daily balance check, one balance failing
  await go(`#/logbooks/${lb('LB-0001').id}?tab=record`); await page.waitForSelector('#body #g tbody tr');
  const rows1 = await page.locator('#body #g tbody tr').allInnerTexts();
  check('Record entries: one row per balance the logbook covers', rows1.length === 2 && /Analytical balance 1/.test(rows1[0]) && /Top-loading balance 1/.test(rows1[1]), rows1.length + ' rows');
  // When | Equipment | Check weight | Nominal | Reading | Error % (calc) | Result | Reason
  await pasteAt('#body', 1, 3, 'W-100\t100\t100.02\nW-500\t500\t500.9');
  const prev1 = await page.locator('#body #g tbody').innerText();
  check('The preview judges each row against its own limit (analytical 0.05 %, top-loading 0.1 %): one Pass, one Fail', /0\.02[\s\S]*Pass[\s\S]*0\.18[\s\S]*Fail/.test(prev1), prev1.replace(/\s+/g, ' '));
  await page.click('#body #save'); await page.waitForSelector('.modal textarea');
  const ask = await page.locator('.modal').innerText();
  check('A failing row asks for its reason before signing (Alex: "a reason is prompted at failure")', /1 entry fails: give the reason/.test(ask) && /Top-loading balance 1/.test(ask), ask.slice(0, 120));
  await page.fill('.modal textarea', 'Re-checked: still 0.18 % high. Taken out of use, supervisor informed, service booked.');
  await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(1500);
  check('Both entries recorded with one signature, the failure with its reason', /Recorded 2 entries \(1 failed, with their reasons\)/.test(await toasts()), await toasts());
  const lb1 = await ana('/logbooks/' + lb('LB-0001').id);
  const failing = lb1.entries.find((e) => e.result === 'Fail' && /Top-loading/.test(e.equipment_name));
  await go('#/logbooks/entries/' + failing.id); await page.waitForSelector('.lb-failbox');
  const fb = await page.locator('main').innerText();
  check('The failing entry: outside its limit, the reason, the window, and the batch that used the balance', /Error.*0\.1/.test(fb) && /Taken out of use/.test(fb) && /flagged in QC Review/.test(fb) && fb.includes(batch.batch_code), batch.batch_code);
  await shot('lb_03_failing_entry');
  const top = opts.equipment.find((e) => /Top-loading/.test(e.equipment_name));
  await go('#/equipment/' + top.id); await page.waitForSelector('#eqlb .card');
  check('The equipment page shows its logbooks and the open failure', /Failing:/.test(await page.locator('#eqlb').innerText()) && /LB-0001/.test(await page.locator('#eqlb').innerText()));

  // ================================================================ QA: Logbook review
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/logbooks/review'); await page.waitForSelector('#g tbody tr');
  const waiting = await page.locator('#g tbody tr').allInnerTexts();
  check('Logbook review lists the new entries (with the failure and its reason) for QA', waiting.some((t) => t.includes(failing.entry_code) && /Fail/.test(t) && /Taken out of use/.test(t)) && waiting.some((t) => t.includes(newInoc.entry_code)), waiting.length + ' waiting');
  const before = (await qa('/logbooks/review')).rows.length;
  await page.click('#all'); await page.click('#ok'); await page.waitForSelector('.modal [data-ok]'); await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(1500);
  const approvedToast = await toasts();
  const after = await qa('/logbooks/review');
  check('QA approves every ticked entry with one signature', /Approved \d+ entr/.test(approvedToast) && after.rows.length < before && !after.rows.some((x) => x.id === newInoc.id || x.id === failing.id), `${before} -> ${after.rows.length}`);

  // the recovery is now calculated from the approved inoculum: 40 CFU recovered / 45 CFU added
  bd = await ana('/testing/batches/' + batch.id);
  check('Once QA approves the inoculum, the S. aureus recovery is calculated: 40 / 45 x 100 = 88.9 %', Math.abs(Number(saRes().value) - 88.888888) < 0.001, String(saRes().value));
  await complete('calc');

  // ================================================================ QC Review: the equipment flag, accepted by the reviewer
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/testing/batches/${batch.id}?step=review`); await page.waitForSelector('#rv_flags tbody tr', { timeout: 15000 });
  const fl = await page.locator('#rv_flags').innerText();
  check('QC Review: the balance flagged by its logbook, with what failed, not accepted yet', /Top-loading balance|EQ-/.test(fl) && /Not accepted yet/.test(fl) && fl.includes(failing.entry_code));
  await page.locator('#rv_flags button', { hasText: 'Accept…' }).first().click(); await page.waitForSelector('.modal #f_justification');
  await page.fill('.modal #f_justification', 'The aliquots for this batch were weighed to 10 g; a 0.18 % error does not change the counts.'); await page.click('.modal [data-ok]'); await page.waitForTimeout(1500);
  const flags = await sup(`/testing/batches/${batch.id}/equipment-flags`);
  check('The reviewer accepts the flag with a justification (kept with their name)', flags.rows.length >= 1 && flags.rows.every((x) => x.accepted) && /Lab Supervisor/.test(flags.rows[0].accepted_by_name || ''), JSON.stringify(flags.rows.map((x) => x.accepted)));
  await shot('lb_04_flag_accepted');

  // ================================================================ L-2: aliquots weighed by intake, scanned at Weigh (USP <62>)
  const lb8 = await ana('/logbooks/' + lb('LB-0008').id);
  const aliq = lb8.entries.filter((e) => e.status === 'Recorded');
  await signIn(page, BASE, 'Analyst (demo)', '#/testing'); await page.waitForSelector('.tbgroup');
  await page.locator('.tbgroup', { hasText: 'USP <62>' }).locator('[data-auto]').click(); await page.waitForSelector('.modal [data-ok]'); await page.click('.modal [data-ok]');
  await page.waitForSelector('#g tr.tbmade', { timeout: 15000 }); await page.locator('#g tr.tbmade a').first().click(); await page.waitForSelector('#panel .card'); await page.waitForTimeout(700);
  const b62 = page.url().match(/batches\/([\w-]+)/)[1];
  await page.click('[data-a="complete"]'); await page.waitForSelector('.sigmodal #c_pass'); await page.fill('.sigmodal #c_pass', PASSWORD); await page.click('.sigmodal [data-ok]');
  await page.waitForSelector('.sigmodal', { state: 'detached', timeout: 15000 }); await page.waitForTimeout(900);
  await go(`#/testing/batches/${b62}?step=weigh`); await page.waitForSelector('[data-a="aliquot"]');
  for (const a of aliq) {
    await page.click('[data-a="aliquot"]'); await page.waitForSelector('.modal #f_code');
    await page.fill('.modal #f_code', a.entry_code.toLowerCase()); await page.click('.modal [data-ok]'); await page.waitForTimeout(1300);
  }
  const wg = await page.locator('#body tbody').innerText();
  check('Scan aliquot: each sample\'s weight (10.04 g, 10.07 g) comes from its aliquot, linked by its entry code',
    aliq.length === 2 && aliq.every((a) => wg.includes(a.entry_code)) && /10\.04/.test(wg) && /10\.07/.test(wg), wg.replace(/\s+/g, ' ').slice(0, 200));
  const d62 = await ana('/testing/batches/' + b62);
  check('The balance the aliquot was weighed on is recorded for the sample', d62.equipment_used.filter((x) => /Top-loading/.test(x.equipment_name)).length >= 2);
  await shot('lb_05_aliquots');
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/testing/batches/${b62}?step=review`); await page.waitForSelector('#rv_aliq tbody tr', { timeout: 15000 });
  const al = await page.locator('#rv_aliq').innerText();
  check('QC Review lists the weighed aliquots: used for which sample, the balance, who weighed them (intake)', (await page.locator('#rv_aliq tbody tr').count()) === 2 && /Used for/.test(al) && /Intake Tech/.test(al) && /Top-loading balance 1/.test(al), al.replace(/\s+/g, ' ').slice(0, 200));

  // ================================================================ L-1: a new logbook, designed by the Lab Supervisor, approved by QA
  await go('#/logbooks'); await page.click('#new'); await page.waitForSelector('.modal #f_logbook_name');
  await page.fill('.modal #f_logbook_name', 'Water bath temperature'); await page.click('.modal [data-ok]');
  await page.waitForSelector('#fg'); await page.waitForTimeout(900);
  const newId = (await page.evaluate(() => location.hash)).match(/logbooks\/([\w-]+)/)[1];
  check('+ New logbook: created and opened on its design (v1 Draft)', /LB-0009 Water bath temperature/.test(await page.locator('main h1').innerText()) && /Design version 1 \(Draft\)/.test(await page.locator('main').innerText()));
  await page.click('#fg [data-add="1"]'); await page.click('#fg [data-add="1"]');
  // Order | Label | Key | Type | Unit | Lower | Upper
  await pasteAt('#fg', 1, 1, '10\tThermometer reading\ttemp_c\tNumber\t°C\t36\t38\n20\tThermometer ID\tthermometer\tText');
  await page.click('#fg .savebar [data-save]'); await sign(page, { reason: 'New logbook design' }); await page.waitForTimeout(1500);
  const nd = await sup('/logbooks/' + newId);
  check('The fields are added by paste; a design change takes a reason, not a signature', nd.fields.length === 2 && nd.fields.some((f) => f.field_key === 'temp_c' && Number(f.limit_min) === 36 && Number(f.limit_max) === 38));
  check('The Lab Supervisor who designed it cannot approve it (no logbook.review)', !(await page.locator('#approve').count()));
  await signIn(page, BASE, 'QA Reviewer (demo)', `#/logbooks/${newId}?tab=design`); await page.waitForSelector('#approve');
  await page.click('#approve'); await sign(page); await page.waitForTimeout(1500);
  const na = await qa('/logbooks/' + newId);
  check('QA approves the design (signed): version 1 is Effective and entries can be recorded', na.versions.some((v) => v.version_no === 1 && v.status === 'Effective' && v.approved_by_name));

  // ================================================================ elsewhere: stability excursions, the inoculum's lot
  const st = (await alex('/stability/studies')).rows.find((x) => x.study_code === 'STB-00001');
  await go('#/stability/studies/' + st.id); await page.waitForSelector('#excur .card', { timeout: 15000 });
  check('STB-00001 shows the chamber excursion from the temperature log (28.1 °C in the 25 °C chamber)', /Chamber excursions/.test(await page.locator('#excur').innerText()) && /28\.1/.test(await page.locator('#excur').innerText()));
  const newLot = lb5b.entries.find((e) => e.id === newInoc.id).created_lot_id;
  await go('#/inventory/lots/' + newLot); await page.waitForSelector('#lotlb .card', { timeout: 15000 });
  check('The inoculum\'s lot page shows the entry that made it and its published values', (await page.locator('#lotlb').innerText()).includes(newInoc.entry_code) && /CFU added/.test(await page.locator('#lotlb').innerText()));
  await shot('lb_06_lot');

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
