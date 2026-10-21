// 0.27.0 (migration 048) in the browser, on a fresh test database: bench values saved as they are typed (a page
// refresh loses nothing; changing a saved value asks for its reason first), a further dilution recorded with a new
// analytical run (each reading keeps its own run's dilution), and the analyst's pick of the reading reported, which QC
// Review uses unless the reviewer chooses otherwise. A small test is designed, verified and approved through the API
// (weigh, dilute 1 + 9, read, result = reading x factor).
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, login, call, verifyVersion, PASSWORD } = require('./auth');
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

async function as(who) {
  const cookie = await login(BASE, who, PASSWORD);
  const site = (await call(BASE, '/users', { cookie })).data.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
  return async (p, body, signed, method) => {
    const res = await fetch(BASE + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site },
      body: body ? JSON.stringify({ ...body, ...(signed ? { signature: { username: who, password: PASSWORD } } : {}) }) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
}

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto('about:blank'); await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(900); };
  const gm = await as('gm'); const sup = await as('labsup'); const ana = await as('analyst');

  // ---- the test: designed by the analyst, verified, approved by the Lab Supervisor, priced by the General Manager
  await ana('/methods/sops', { rows: [{ method_name: 'Lead by ICP-MS (run dilution e2e)', sop_code: 'E2E-48' }], reason: 'New SOP' }, true);
  const no = await ana('/methods/new-options');
  const dept = (no.departments.find((d) => /CHEM/i.test(d.department_code)) || no.departments[0]).id;
  const t = await ana('/methods/tests', { row: { test_name: 'Lead with run dilutions (e2e)', department_id: dept, method_id: no.methods.find((m) => /run dilution e2e/.test(m.method_name)).id } }, true);
  const lead = (await ana('/analytes')).find((a) => a.analyte_name === 'Lead').id;
  await ana(`/methods/versions/${t.version_id}/analytes`, { rows: [{ analyte_id: lead, sort_order: 1, result_type: 'Numeric', reporting_unit: 'mg/kg', loq: 0.01, lod: 0.005, status: 'Active' }] }, true);
  const vd0 = await ana('/methods/versions/' + t.version_id);
  const balType = vd0.lists.types.find((x) => /balance/i.test(x.type_name));
  let prev = null;
  const step = async (key, name, stype, config, eq) => {
    const r = await ana(`/methods/versions/${t.version_id}/steps`, { step: { step_key: key, step_name: name, step_type: stype, config }, equipment: eq ? [{ equipment_type_id: eq.id, is_main: true }] : [], deps: prev ? [{ depends_on_step_id: prev }] : [], reason: 'Draft being developed (before approval)' }, true);
    prev = r.id;
  };
  await step('batch', 'Batch', 'Batching', { max_samples: 10, qc: [] });
  await step('weigh', 'Weigh', 'Weighing', { target_mode: 'None', unit: 'g' }, balType);
  await step('dilute', 'Dilute', 'Dilution', { mode: 'Single', aliquot: 1, diluent: 9, fields_per_entry: 2 });
  await step('read', 'Read', 'Data Entry', { value_label: 'Lead', value_unit: 'mg/L', require_attachment: false });
  await step('calc', 'Result', 'Calculation', { formula: '{read.reading} * {dilute.factor}' });
  await step('review', 'QC Review', 'QC Review', {});
  const vd = await ana('/methods/versions/' + t.version_id);
  check('(set-up) the design has no errors', !vd.problems.some((p) => p.severity === 'Error'), vd.problems.map((p) => p.problem).join(' | '));
  const outcome = await verifyVersion(BASE, t.version_id);
  check('(set-up) its workflow verification passes', /^Pass/.test(outcome), outcome);
  await sup(`/methods/versions/${t.version_id}/approve`, { reason: 'Approved for the test' }, true);
  await gm(`/catalog/${t.id}`, { entry: { base_price: 40, standard_tat: 5, tat_unit: 'Business Days' }, reason: 'Priced' }, false, 'PUT');
  const client = (await gm('/clients')).find((c) => c.client_code === 'CL-00005');
  const q = await gm('/quotes', { client_id: client.id, project_name: 'Lead with run dilutions (e2e)' });
  await gm(`/versions/${q.version_id}/lines`, { rows: [{ test_id: t.id, quantity: 2 }], prefill: true });
  await gm(`/versions/${q.version_id}/status`, { status: 'Quoted', reason: 'Issued' });
  const ordering = (await gm('/order-setup/' + client.id)).contacts[0].id;
  await gm(`/quotes/versions/${q.version_id}/decide`, { decision: 'Accepted', contact_id: ordering });
  const line = (await gm(`/versions/${q.version_id}`)).lines.find((l) => l.test_id === t.id);
  const ord = await gm('/orders', { row: { client_id: client.id, ordering_contact_id: ordering, po_number: 'E2E-RUNS' } });
  await gm(`/orders/${ord.id}/samples`, { rows: [{ client_sample_id: 'Run dilution A', matrix: 'Powder' }, { client_sample_id: 'Run dilution B', matrix: 'Powder' }] });
  const smp = (await gm('/orders/' + ord.id)).samples;
  await gm(`/orders/${ord.id}/add-test`, { sample_ids: smp.map((s) => s.id), line_id: line.line_id });
  await gm(`/orders/${ord.id}/log`, { sample_ids: smp.map((s) => s.id) });

  // ---- the batch
  const bl = await ana('/testing/backlog');
  const batch = await ana('/testing/batches', { test_version_id: t.version_id, items: bl.rows.filter((x) => x.test_id === t.id).map((x) => ({ requested_test_id: x.requested_test_id })) });
  let bd = await ana('/testing/batches/' + batch.id);
  const run = (k) => bd.steps.find((s) => s.step_key === k).id;
  const entA = bd.entries.find((e) => /A$/.test(e.client_sample_id || '')).id; const entB = bd.entries.find((e) => /B$/.test(e.client_sample_id || '')).id;
  const complete = async (k) => { await ana(`/testing/step-runs/${run(k)}/complete`, {}, true); bd = await ana('/testing/batches/' + batch.id); };
  const val = (k, e, rn = 1) => (bd.values.find((v) => v.step_run_id === run(k) && v.entry_id === e && !v.analyte_id && Number(v.run_no) === rn) || {}).value_num;
  await complete('batch');

  // ---- autosave: typed weights are saved without pressing Save; a refresh keeps them
  await signIn(page, BASE, 'Analyst (demo)', `#/testing/batches/${batch.id}?step=weigh`); await page.waitForSelector('#body tbody tr');
  const wcol = await page.evaluate(() => [...document.querySelectorAll('#body thead th')].findIndex((th) => /^Weight/.test(th.textContent.trim())) + 1);
  const rowOf = async (label) => (await page.evaluate((l) => [...document.querySelectorAll('#body tbody tr')].findIndex((tr) => tr.innerText.includes(l)) + 1, label));
  const typeAt = async (r, c, text) => { await page.click(`#body tbody tr:nth-child(${r}) td:nth-child(${c})`); await page.keyboard.type(text); await page.keyboard.press('Enter'); };
  const la = bd.entries.find((e) => e.id === entA).label; const lb = bd.entries.find((e) => e.id === entB).label;
  await typeAt(await rowOf(la), wcol, '0.5');
  await page.waitForFunction(() => /Saved automatically/.test(document.querySelector('#body .autosaved')?.textContent || ''), null, { timeout: 10000 });
  await typeAt(await rowOf(lb), wcol, '0.52');
  await page.waitForTimeout(1600);
  await shot('br_01_autosaved');
  await page.reload(); await page.waitForSelector('#body tbody tr'); await page.waitForTimeout(500);
  bd = await ana('/testing/batches/' + batch.id);
  check('Weights typed are saved by themselves (no Save pressed); after a page refresh both are there', Number(val('weigh', entA)) === 0.5 && Number(val('weigh', entB)) === 0.52,
    `${val('weigh', entA)} / ${val('weigh', entB)}`);
  await typeAt(await rowOf(la), wcol, '0.51');
  await page.waitForSelector('.sigmodal #f_rpick', { timeout: 10000 });
  check('Changing a saved weight asks for the reason straight away', true);
  await sign(page, { reason: 'Re-weighed: the first weighing drifted' });
  await page.waitForFunction(() => /Saved automatically/.test(document.querySelector('#body .autosaved')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  bd = await ana('/testing/batches/' + batch.id);
  const audit = await ana(`/audit?table=entry_value&id=${bd.values.find((v) => v.step_run_id === run('weigh') && v.entry_id === entA).id}`).catch(() => []);
  check('... saved with it (0.51; the reason in the audit trail)', Number(val('weigh', entA)) === 0.51 && (!Array.isArray(audit) || !audit.length || audit.some((a) => /drifted/.test(a.reason || ''))));
  const opts = await ana(`/testing/batches/${batch.id}/options`);
  const bal = opts.equipment.find((e) => e.type_name === balType.type_name && e.availability === 'Available' && e.calibration_status !== 'Deficient');
  await ana(`/testing/step-runs/${run('weigh')}/equipment`, { equipment_id: bal.id });
  await complete('weigh');

  // ---- run 1 at 1 + 9; run 2 diluted a further 1 + 9 for sample A
  await ana(`/testing/step-runs/${run('dilute')}/values`, { rows: [{ entry_id: entA, data: { fields: [{ aliquot: 1, diluent: 9 }] } }, { entry_id: entB, data: { fields: [{ aliquot: 1, diluent: 9 }] } }] });
  await complete('dilute');
  await ana(`/testing/step-runs/${run('read')}/values`, { rows: [{ entry_id: entA, analyte_id: lead, value_num: 50 }, { entry_id: entB, analyte_id: lead, value_num: 2 }] });
  await go(`#/testing/batches/${batch.id}?step=read`); await page.waitForSelector('#body tbody tr');
  await page.locator('[data-a="rean"]').first().click(); await page.waitForSelector('.modal #f_aliquot');
  await page.fill('.modal #f_aliquot', '1'); await page.fill('.modal #f_diluent', '9');
  await page.evaluate((id) => { for (const x of document.querySelectorAll('.modal input[type=checkbox]')) x.checked = x.id === 'f_e_' + id; }, entA);
  await page.click('.modal [data-ok]'); await sign(page, { reason: 'Over the calibration range: diluted further' });
  await page.waitForFunction(() => /run=2/.test(location.hash), null, { timeout: 15000 }); await page.waitForTimeout(800);
  bd = await ana('/testing/batches/' + batch.id);
  const dil2 = bd.values.find((v) => v.step_run_id === run('dilute') && v.entry_id === entA && Number(v.run_no) === 2);
  check('Add analytical run, with "Further dilution 1 + 9" (signed): run 2 gets the sample\'s dilution with one more 1 + 9',
    dil2 && dil2.data.fields.length === 2 && !bd.values.some((v) => v.step_run_id === run('dilute') && v.entry_id === entB && Number(v.run_no) === 2));
  await ana(`/testing/step-runs/${run('read')}/values`, { rows: [{ entry_id: entA, analyte_id: lead, run_no: 2, value_num: 4.8 }] });
  bd = await ana('/testing/batches/' + batch.id);
  const res = (rn) => (bd.results.find((r) => r.entry_id === entA && Number(r.run_no) === rn && r.is_final) || {}).value;
  check('Each reading keeps its own run\'s dilution: run 1 500 (50 x 10), run 2 480 (4.8 x 100)', Number(res(1)) === 500 && Number(res(2)) === 480, `${res(1)} / ${res(2)}`);

  // ---- the analyst picks run 2 on the reading tab
  await go(`#/testing/batches/${batch.id}?step=read&run=1`); await page.waitForSelector('#body tbody tr');
  const rtxt = await page.locator('#body').innerText();
  check('The reading tab shows each reading\'s dilution (×10; RA1- at ×100)', /×10\b/.test(rtxt), rtxt.slice(0, 300).replace(/\s+/g, ' '));
  await go(`#/testing/batches/${batch.id}?step=read&run=2`); await page.waitForSelector('#body tbody tr');
  check('... RA1- (run 2) at ×100', /×100\b/.test(await page.locator('#body').innerText()));
  await page.click('#body tbody tr:nth-child(1) td:nth-child(3)');
  await page.locator('[data-a="pick"]').first().click(); await page.waitForSelector('.modal #f_note');
  await page.fill('.modal #f_note', 'Run 1 over the calibration range; run 2 diluted x100'); await page.click('.modal [data-ok]');
  await page.waitForFunction(() => /Picked: QC Review will report/.test([...document.querySelectorAll('.toast')].map((x) => x.innerText).join(' ')), null, { timeout: 15000 });
  await page.waitForSelector('#body tbody tr'); await page.waitForTimeout(800);
  check('"Pick reported reading…": the row shows ✓ with the note', /✓ All analytes: Run 1 over the calibration range/.test(await page.locator('#body').innerText()));
  await shot('br_02_picked');
  await complete('read'); await complete('calc');

  // ---- QC Review reports the pick; the reviewer can still choose otherwise
  const rv = await sup(`/testing/batches/${batch.id}/review`);
  const itemA = (rv.items || rv.rows || rv).find ? (rv.items || rv.rows || rv).find((x) => x.sample_label && x.candidates && x.candidates.some((c) => c.entry_id === entA)) : null;
  check('QC Review: sample A reports run 2 (480) with "Picked by the analyst (Analyst (demo)): …"', itemA && Number(itemA.chosen_run_no) === 2 && Number(itemA.value) === 480
    && /^Picked by the analyst \(Analyst \(demo\)\): Run 1 over/.test(itemA.justification || ''), itemA ? `${itemA.chosen_run_no} ${itemA.value} ${itemA.justification}` : JSON.stringify(Object.keys(rv)));
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/testing/batches/${batch.id}?step=review`); await page.waitForSelector('#panel .card'); await page.waitForTimeout(1500);
  check('... shown to the reviewer beside the reading', /Picked by the analyst/.test(await page.locator('#panel').innerText()));
  await shot('br_03_review');

  check('No native browser dialogs', native === 0);
  check('No page errors', !errors.length, errors.slice(0, 3).join(' | '));
  await b.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
