// 0.21.0 (migration 039) end to end in the browser, on Colleen's Salmonella BAX Q7 screen with reflex to confirmation:
//  - the Workflow Designer's new settings: "Not a result" values per analyte, "Not weighed" product categories and
//    controls, incubation windows per product category, "Alert the client" on a Split off step;
//  - the test built by the demo Analyst (through the API, as the designer does), verified and approved;
//  - samples logged by matrix (food, sponge swab, dry pet food): the bench shows each sample's own weight range (or "Not
//    weighed"), its own enrichment amounts (one click fills them), its own incubation window;
//  - a Signal error forces a re-run (flagged at the bench, listed in QC Review, approval refused until read again);
//  - a presumptive positive orders the confirmation and alerts the client's Positive alerts contact (Outbox, the batch
//    and the sample page show who was told and when).
// Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, login, call, verifyVersion } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

async function as(who) {
  const cookie = await login(BASE, who, PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
  const f = async (p, body, signed, method) => {
    const res = await fetch(BASE + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site },
      body: body ? JSON.stringify({ ...body, ...(signed ? { signature: { username: who, password: PASSWORD } } : {}) }) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
  return f;
}

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto('about:blank'); await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(900); };
  const alex = await as('akiddle'); const sup = await as('labsup'); const ana = await as('analyst'); const qa = await as('qa.reviewer');

  // ================================================================ set-up: product categories, matrices, the method, a Positive alerts contact
  await alex('/product-categories/bulk', { rows: [{ category_name: 'Environmental sponge', sort_order: 60 }, { category_name: 'Dry pet food', sort_order: 61 }], reason: 'Salmonella BAX demo' });
  const cats = await alex('/product-categories'); const cat = (n) => cats.find((x) => x.category_name === n).id;
  await alex('/matrices/bulk', { rows: [{ matrix_name: 'Environmental sponge swab', product_category_id: cat('Environmental sponge') }, { matrix_name: 'Dry pet food (kibble)', product_category_id: cat('Dry pet food') }], reason: 'Salmonella BAX demo' });
  check('Contact roles include "Positive alerts"', ((await alex('/meta')).contactRoles || []).some((r) => r.role_code === 'ALERT' && r.role_name === 'Positive alerts'));
  const acme = (await alex('/clients')).find((c) => c.client_code === 'CL-00005');
  await alex('/contacts/bulk', { rows: [{ first_name: 'Dana', last_name: 'Ortiz (alerts)', email: 'dana.alerts@acme.example' }], reason: 'Salmonella BAX demo' });
  const dana = (await alex('/contacts')).find((x) => x.email === 'dana.alerts@acme.example');
  await alex('/client-contacts/bulk', { rows: [{ client_id: acme.id, contact_id: dana.id, roles: ['ALERT'] }], reason: 'Salmonella BAX demo' });
  await ana('/methods/sops', { rows: [{ method_name: 'Hygiena Real-Time Salmonella Assay (BAX Q7)', sop_code: 'MC-12.06 rev 1' }], reason: 'New SOP' }, true);
  const no = await ana('/methods/new-options');
  const micro = no.departments.find((d) => d.department_code === 'MICRO').id; const mth = no.methods.find((m) => /BAX Q7/.test(m.method_name)).id;

  // ================================================================ the test, as the designer saves it
  const t = await ana('/methods/tests', { row: { test_name: 'Salmonella BAX Q7 screen', department_id: micro, method_id: mth } }, true);
  let vd = await ana('/methods/versions/' + t.version_id);
  const sal = (await ana('/analytes')).find((a) => a.analyte_name === 'Salmonella').id;
  await ana(`/methods/versions/${t.version_id}/analytes`, { rows: [{ analyte_id: sal, sort_order: 1, result_type: 'Qualitative', status: 'Active',
    result_values: ['Negative', 'Presumptive positive', 'Indeterminate', 'Signal error'], found_values: ['Presumptive positive'], invalid_values: ['Indeterminate', 'Signal error'] }] }, true);
  const type = (n) => vd.lists.types.find((x) => x.type_name === n).id;
  const maldi = vd.lists.tests.find((x) => /MALDI/.test(x.test_name));
  let prev = null; const ids = {};
  const step = async (key, name, stype, config, eq) => {
    const r = await ana(`/methods/versions/${t.version_id}/steps`, { step: { step_key: key, step_name: name, step_type: stype, config },
      equipment: eq ? [{ equipment_type_id: type(eq), is_main: true }] : [], deps: prev ? [{ depends_on_step_id: prev }] : [], reason: 'Draft being developed (before approval)' }, true);
    prev = r.id; ids[key] = r.id;
  };
  await step('batch', 'Batch (one rack per shift)', 'Batching', { max_samples: 20, qc: [{ qc_type: 'Positive Control', qc_class: 'Prep', frequency: 'Once', count: 1, criteria: [{ limit_type: 'Presence' }] },
    { qc_type: 'Negative Control', qc_class: 'Prep', frequency: 'Once', count: 1, criteria: [{ limit_type: 'Absence' }] }] });
  const food = vd.lists.categories.find((x) => x.category_name === 'Food').id;
  await step('weigh', 'Weigh test portion', 'Weighing', { target_mode: 'By product category', unit: 'g', qc_not_weighed: true, by_category: [
    { category_id: food, min: 24.5, max: 25.5 }, { category_id: cat('Dry pet food'), min: 367.5, max: 382.5 }, { category_id: cat('Environmental sponge'), not_weighed: true }] }, 'Top-loading balance');
  await step('enrich', 'Add BPW (1 in 10)', 'Dilution', { mode: 'Single', aliquot: 25, diluent: 225, fields_per_entry: 1, expected_diluent: 'BPW', by_category: [
    { category_id: cat('Dry pet food'), aliquot: 375, diluent: 3375 }, { category_id: cat('Environmental sponge'), aliquot: 1, diluent: 90 }] });
  await step('inc', 'Incubate enrichment', 'Incubation', { temp_c: 35, temp_tolerance: 1, duration: 22, duration_unit: 'hours', window_min: 20, window_max: 24,
    by_category: [{ category_id: cat('Dry pet food'), window_min: 22, window_max: 26 }] }, 'Incubator');
  await step('bax', 'BAX Q7 run', 'Data Entry', { value_label: 'BAX result', require_attachment: false });
  await step('split', 'Reflex to confirmation', 'Split off Test', { test_id: maldi.id, trigger: 'On finding', finding: 'Present', finding_steps: ['bax'], consent_required: false, notify_client: true });
  await step('review', 'QC Review', 'QC Review', {});
  vd = await ana('/methods/versions/' + t.version_id);
  check('The design has no errors (a "Not weighed" category needs no range; the windows per category are complete)', !vd.problems.some((p) => p.severity === 'Error'), vd.problems.map((p) => p.problem).join(' | '));

  // the designer shows the new settings
  await signIn(page, BASE, 'Analyst (demo)', `#/methods/versions/${t.version_id}?tab=analytes`); await page.waitForSelector('#ag table');
  const ah = await page.locator('#ag table thead').innerText(); const ab = await page.locator('#ag table tbody').innerText();
  check('Designer, Analytes: a "Not a result" column holds Indeterminate, Signal error', /Not a result/.test(ah) && /Indeterminate, Signal error/.test(ab));
  await go(`#/methods/versions/${t.version_id}?tab=workflow&step=${ids.weigh}`); await page.waitForSelector('#c_cat table');
  check('Designer, Weighing: "Not weighed" per product category and "Prep QC (controls) are not weighed"',
    /Not weighed/.test(await page.locator('#c_cat table thead').innerText()) && await page.locator('#c_qcnw').isChecked());
  await go(`#/methods/versions/${t.version_id}?tab=workflow&step=${ids.inc}`); await page.waitForSelector('#c_cat table');
  check('Designer, Incubation: a window per product category (Dry pet food 22 to 26)', /Dry pet food\s+22\s+26/.test(await page.locator('#c_cat table tbody').innerText()));
  await go(`#/methods/versions/${t.version_id}?tab=workflow&step=${ids.split}`); await page.waitForSelector('#c_alert');
  check('Designer, Split off Test: "Alert the client" is ticked', await page.locator('#c_alert').isChecked());
  await shot('bax_01_designer');

  // verification (CFL requires it) and approval
  const outcome = await verifyVersion(BASE, t.version_id);
  check('The workflow verification passes (an exception is allowed: the split-off test is not on the verification\'s quote)', /^Pass/.test(outcome), outcome);
  await sup(`/methods/versions/${t.version_id}/approve`, { reason: 'Approved for the demo' }, true);
  await alex(`/catalog/${t.id}`, { entry: { base_price: 45, standard_tat: 2, tat_unit: 'Business Days' }, reason: 'Priced' }, false, 'PUT');

  // the quote, the order: four samples, one per matrix, screen only
  const q = await alex('/quotes', { client_id: acme.id, project_name: 'Salmonella screen with reflex (demo)' });
  await alex(`/versions/${q.version_id}/lines`, { rows: [{ test_id: t.id, quantity: 4 }, { test_id: maldi.id, quantity: 4 }], prefill: true });
  await alex(`/versions/${q.version_id}/status`, { status: 'Quoted', reason: 'Issued' });
  const ordering = (await alex('/order-setup/' + acme.id)).contacts[0].id;
  await alex(`/quotes/versions/${q.version_id}/decide`, { decision: 'Accepted', contact_id: ordering });
  const line = (await alex(`/versions/${q.version_id}`)).lines.find((l) => l.test_id === t.id);
  const ord = await alex('/orders', { row: { client_id: acme.id, ordering_contact_id: ordering, po_number: 'DEMO-1016' } });
  await alex(`/orders/${ord.id}/samples`, { rows: [{ client_sample_id: 'Granola bar 2610-A', matrix: 'Snack' }, { client_sample_id: 'Sponge, Line 3 drain', matrix: 'Environmental sponge swab' },
    { client_sample_id: 'Dry dog food 26-288', matrix: 'Dry pet food (kibble)' }] });
  const smp = (await alex('/orders/' + ord.id)).samples; const sid = (re) => smp.find((s) => re.test(s.client_sample_id)).id;
  await alex(`/orders/${ord.id}/add-test`, { sample_ids: smp.map((s) => s.id), line_id: line.line_id });
  await alex(`/orders/${ord.id}/log`, { sample_ids: smp.map((s) => s.id) });

  // ================================================================ the bench
  const bl = await ana('/testing/backlog');
  const rts = bl.rows.filter((x) => x.test_id === t.id);
  const batch = await ana('/testing/batches', { test_version_id: t.version_id, items: rts.map((x) => ({ requested_test_id: x.requested_test_id })) });
  let bd = await ana('/testing/batches/' + batch.id);
  const opts = await ana(`/testing/batches/${batch.id}/options`);
  const run = (k) => bd.steps.find((s) => s.step_key === k).id;
  const ent = (re) => bd.entries.find((e) => e.entry_type === 'Sample' && re.test(e.client_sample_id)).id;
  const qcEnt = (tp) => bd.entries.find((e) => e.qc_type === tp).id;
  const eqId = (re) => opts.equipment.find((e) => re.test(e.type_name) && e.availability === 'Available' && e.calibration_status !== 'Deficient').id;
  const complete = async (k) => { await ana(`/testing/step-runs/${run(k)}/complete`, {}, true); bd = await ana('/testing/batches/' + batch.id); };
  await complete('batch');

  // Weighing: each sample's own range; the sponge and the controls are not weighed
  await go(`#/testing/batches/${batch.id}?step=weigh`); await page.waitForSelector('#panel tbody tr');
  const wtxt = await page.locator('#panel').innerText();
  check('Weighing: each sample shows its category and accepted range (Food 24.5 to 25.5, Dry pet food 367.5 to 382.5); the sponge and the controls are "Not weighed"',
    /Food\s+[\s\S]*24\.5 to 25\.5/.test(wtxt) && /Dry pet food[\s\S]*367\.5 to 382\.5/.test(wtxt) && (wtxt.match(/Not weighed/g) || []).length >= 3, wtxt.slice(0, 400).replace(/\s+/g, ' '));
  check('Weighing: the step waits only for the food and pet food weights', bd.steps.find((s) => s.step_key === 'weigh').missing.filter((m) => /no weight/.test(m)).length === 2);
  await ana(`/testing/step-runs/${run('weigh')}/values`, { rows: [{ entry_id: ent(/Granola/), value_num: 25.12 }, { entry_id: ent(/dog food/), value_num: 390.0 }] });
  await go(`#/testing/batches/${batch.id}?step=weigh`); await page.waitForSelector('#panel tbody tr');
  check('Weighing: a pet food weight outside its own range (390 g) is flagged "Outside the range"', /Outside the range/.test(await page.locator('#panel').innerText()));
  await shot('bax_02_weighing');
  await ana(`/testing/step-runs/${run('weigh')}/values`, { rows: [{ entry_id: ent(/dog food/), value_num: 375.4, correction: true }], reason: 'Re-weighed into the 375 g window' });
  await ana(`/testing/step-runs/${run('weigh')}/equipment`, { equipment_id: eqId(/Top-loading/) });
  await complete('weigh');

  // Enrichment: one click fills each sample's own amounts
  await go(`#/testing/batches/${batch.id}?step=enrich`); await page.waitForSelector('#panel tbody tr');
  await page.click('#dl_std'); await page.waitForTimeout(300);
  const dtxt = await page.locator('#panel tbody').innerText();
  check('Enrichment: "Each sample\'s amounts" fills 375 + 3375 (dry pet food), 1 + 90 (sponge), 25 + 225 (food and controls)',
    /375\s+3375/.test(dtxt) && /\b1\s+90\b/.test(dtxt) && /25\s+225/.test(dtxt) && /Dry pet food/.test(dtxt), dtxt.slice(0, 300).replace(/\s+/g, ' '));
  await shot('bax_03_enrichment');
  await page.click('#panel [data-save]'); await page.waitForTimeout(1500);
  bd = await ana('/testing/batches/' + batch.id);
  check('Enrichment: saved from the screen, nothing missing', bd.steps.find((x) => x.step_key === 'enrich').missing.length === 0, bd.steps.find((x) => x.step_key === 'enrich').missing.join(' | '));
  await complete('enrich');

  // Incubation: the pet food's own window
  const iso = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const l1 = await ana(`/testing/step-runs/${run('inc')}/loads`, { equipment_id: eqId(/Incubator/), entry_ids: bd.entries.filter((e) => !/dog food/.test(e.client_sample_id || '')).map((e) => e.id), time_in: iso(23) });
  const l2 = await ana(`/testing/step-runs/${run('inc')}/loads`, { equipment_id: eqId(/Incubator/), entry_ids: [ent(/dog food/)], time_in: iso(25) });
  await ana(`/testing/loads/${l1.id}`, { time_out: 'now' }); await ana(`/testing/loads/${l2.id}`, { time_out: 'now' });
  await go(`#/testing/batches/${batch.id}?step=inc`); await page.waitForSelector('#inc_e tbody tr');
  const itxt = await page.locator('#inc_e').innerText(); const ltxt = await page.locator('#inc_l').innerText();
  check('Incubation: the pet food shows its own window (22 to 26 h, Dry pet food), the others the step\'s (20 to 24 h)', /22 to 26 h \(Dry pet food\)/.test(itxt) && /20 to 24 h/.test(itxt));
  check('Incubation: the pet food\'s 25 h load is within its window: no load is flagged', !/outside/.test(ltxt), ltxt.slice(0, 200).replace(/\s+/g, ' '));
  await shot('bax_04_incubation');
  await complete('inc');

  // the BAX run: signal errors on the sponge and the positive control; a presumptive positive on the pet food
  await ana(`/testing/step-runs/${run('bax')}/values`, { rows: [
    { entry_id: ent(/Granola/), analyte_id: sal, value_text: 'Negative' }, { entry_id: ent(/Sponge/), analyte_id: sal, value_text: 'Signal error' },
    { entry_id: ent(/dog food/), analyte_id: sal, value_text: 'Presumptive positive' },
    { entry_id: qcEnt('Positive Control'), analyte_id: sal, value_text: 'Signal error' }, { entry_id: qcEnt('Negative Control'), analyte_id: sal, value_text: 'Negative' }] });
  await go(`#/testing/batches/${batch.id}?step=bax`); await page.waitForSelector('#panel tbody tr');
  const rtxt = await page.locator('#panel tbody').innerText();
  check('BAX run: the two signal errors are flagged "Re-run required"', (rtxt.match(/Re-run required/g) || []).length === 2, rtxt.slice(0, 300).replace(/\s+/g, ' '));
  await shot('bax_05_rerun_required');
  await complete('bax');
  await complete('split');

  // the reflex and the alert
  const split = bd.splits.find((s) => /dog food/.test(s.client_sample_id || '') || s.sample_id === sid(/dog food/));
  check('Reflex: the presumptive positive ordered the confirmation at once (no split-off for the signal error)', bd.splits.length === 1 && split && split.status === 'Ordered');
  check('Alert: Dana (Positive alerts) was emailed, queued by the analyst who completed the step', split && split.alerts.length === 1 && split.alerts[0].to_address === 'dana.alerts@acme.example' && split.alerts[0].by === 'Analyst (demo)');
  await go(`#/testing/batches/${batch.id}?step=split`); await page.waitForSelector('#sp_g tbody tr');
  check('The batch shows who was alerted and when', /Dana Ortiz \(alerts\)/.test(await page.locator('#sp_g').innerText()));
  const out = await alex('/outbox');
  const mail = out.find((e) => e.template === 'Presumptive Result');
  check('Outbox: the "Presumptive positive" email to Dana, saying confirmation has started', mail && /^Presumptive result: Salmonella Presumptive positive in Dry dog food 26-288/.test(mail.subject) && /has been started/.test(mail.body), mail ? mail.subject : '');
  await go(`#/samples/${sid(/dog food/)}`); await page.waitForSelector('#rsp tbody tr', { timeout: 15000 }).catch(() => {});
  check('The sample page shows the alert', /Dana Ortiz \(alerts\)/.test(await page.locator('main').innerText()));
  await shot('bax_06_sample_alert');

  // QC Review: the readings that are not results stop approval
  await signIn(page, BASE, 'QA Reviewer (demo)', `#/testing/batches/${batch.id}?step=review`); await page.waitForSelector('#panel .tbnote, #panel .tbtodo');
  const rv = await qa(`/testing/batches/${batch.id}/review`);
  const qtxt = await page.locator('#panel').innerText();
  check('QC Review: "Readings that are not results" lists both; approval waits for the re-run',
    /Readings that are not results/.test(qtxt) && rv.problems.some((p) => /"Signal error" is not a result/.test(p.problem || p)) && rv.problems.some((p) => /Positive Control.*not a result/.test(p.problem || p)));
  await shot('bax_07_qc_review_waits');
  // the re-run (a new analytical run of the sponge and the positive control)
  await ana(`/testing/step-runs/${run('bax')}/runs`, { entry_ids: [ent(/Sponge/), qcEnt('Positive Control')], replicates: 1, reason: 'Signal error: re-run per MC-12.06 8.5.2' }, true);
  await ana(`/testing/step-runs/${run('bax')}/values`, { rows: [{ entry_id: ent(/Sponge/), analyte_id: sal, run_no: 2, value_text: 'Negative' }, { entry_id: qcEnt('Positive Control'), analyte_id: sal, run_no: 2, value_text: 'Presumptive positive' }] });
  await complete('bax');
  bd = await qa('/testing/batches/' + batch.id);
  for (const m of bd.review_marks.filter((x) => !x.mark_id)) await qa(`/testing/batches/${batch.id}/steps/${m.step_run_id}/review-mark`, {});
  const rv2 = await qa(`/testing/batches/${batch.id}/review`);
  check('Read again: nothing left to resolve; the sponge\'s Negative (run 2) is chosen by itself', rv2.problems.length === 0
    && rv2.items.some((i) => i.chosen_run_no === 2 && i.value_text === 'Negative'), rv2.problems.map((p) => p.problem || p).join(' | '));
  await qa(`/testing/batches/${batch.id}/approve`, {}, true);
  const res = await alex(`/testing/samples/${sid(/Sponge/)}/results`);
  check('Approved: the sponge is reported Negative', res.results.some((r) => r.value_text === 'Negative'));

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
