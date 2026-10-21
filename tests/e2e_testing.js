// Testing, WD-2 (migration 016): the backlog and the demo batch BAT-000001 taken through every bench step by the demo
// Analyst: weights pasted from Excel, spikes added to selected rows (right-click and button), the balance and the
// ICP-MS, the digestion fields, the standard dilution, readings pasted for four analytes, the raw data attached, the
// check standards recorded; each step signed "Performed by"; live results and QC verdicts; a duplicate re-analysis and a
// re-prep (signed, with a reason) back to the top of the backlog. Then a witness: the analyst makes digestion
// "witness required" on the Heavy Metals version 2 draft, the Lab Supervisor approves it, a sample is ordered on it, and
// completing digestion needs the witness's own user ID and password. Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, verifyVersion } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-3]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(700); };
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const hm = () => page.locator('.tbgroup', { hasText: 'Heavy Metals (Pb, Cd, As, Hg) by ICP-MS (v1)' });
  const cell = (r, c) => `#body tbody tr:nth-child(${r}) td:nth-child(${c})`;
  // (Claude Code, 2026-10-15: on a busy laptop the grid could still be drawing when the paste arrived, so the paste was
  // lost and the save bar never showed; wait for the cell, and paste again once if no save bar appears)
  const pasteOnce = async (sel, text) => {
    await page.locator(sel).waitFor({ state: 'visible' }); await page.waitForTimeout(300);
    await page.locator(sel).click();
    await page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
    await page.waitForTimeout(250);
  };
  const pasteAt = async (sel, text) => {
    await pasteOnce(sel, text);
    const bar = page.locator('#body .savebar [data-save]');
    try { await bar.waitFor({ state: 'visible', timeout: 4000 }); } catch (e) { if (await bar.count()) await pasteOnce(sel, text); }
  };
  const saveGrid = async () => { await page.locator('#body .savebar [data-save]').waitFor({ state: 'visible', timeout: 10000 }); await page.click('#body .savebar [data-save]'); await page.waitForTimeout(1200); };
  // open a step's tab and wait until the new page is shown with that tab active (the old page stays up while the batch reloads)
  const tab = async (name) => {
    await page.locator('.tbtabs a', { hasText: name }).first().click();
    await page.waitForFunction((n) => [...document.querySelectorAll('.tbtabs a.on')].some((a) => a.textContent.includes(n)), name, { timeout: 15000 });
    await page.waitForSelector('#panel .card'); await page.waitForTimeout(600);
  };
  const status = async () => (await page.locator('main .sub .badge').first().innerText()).trim();
  // making a batch lands on the Batches list with the new batch highlighted; open it from there
  const openMade = async () => { await page.waitForSelector('#g tr.tbmade', { timeout: 15000 }); await page.locator('#g tr.tbmade a').first().click(); await page.waitForSelector('#panel .card'); await page.waitForTimeout(700); };
  // the Complete step dialog: own password, and the witness's when asked
  const complete = async ({ witness = null, expectError = false } = {}) => {
    await page.click('[data-a="complete"]'); await page.waitForSelector('.sigmodal #c_pass');
    await page.fill('.sigmodal #c_pass', PASSWORD);
    if (witness) { await page.fill('.sigmodal #c_wuser', witness); await page.fill('.sigmodal #c_wpass', PASSWORD); }
    await page.click('.sigmodal [data-ok]');
    if (expectError) { await page.waitForFunction(() => document.querySelector('.sigmodal .merr')?.textContent.trim()); const t = await page.textContent('.sigmodal .merr'); return t; }
    await page.waitForSelector('.sigmodal', { state: 'detached', timeout: 15000 }); await page.waitForTimeout(900); return '';
  };
  const modalPick = async (sel, re) => {
    const v = await page.evaluate(([s, src]) => { const o = [...document.querySelectorAll(s + ' option')].find((x) => new RegExp(src).test(x.textContent)); return o ? o.value : null; }, [sel, re.source]);
    await page.locator(sel).selectOption(v);
  };
  const addMaterial = async (opener, lotRe, purpose, volume) => {
    await opener(); await page.waitForSelector('.modal #f_lot_id');
    await modalPick('.modal #f_lot_id', lotRe); await page.locator('.modal #f_purpose').selectOption(purpose);
    if (volume) await page.fill('.modal #f_volume', String(volume));
    await page.click('.modal [data-ok]'); await page.waitForTimeout(1000);
  };

  // ---- Analyst: the backlog and the batch list
  await signIn(page, BASE, 'Analyst (demo)', '#/testing'); await page.waitForSelector('.tbgroup');
  const bl = await page.locator('main').innerText();
  check('Testing is in the menu; the backlog groups by department and test: two Heavy Metals samples wait in Chemistry',
    (await page.locator('nav a[href="#/testing"]').count()) === 1 && /CHEM Chemistry/.test(bl) && /Heavy Metals \(Pb, Cd, As, Hg\) by ICP-MS \(v1\)/.test(bl) && /2 waiting · up to 20 per batch/.test(bl)
    && (await hm().locator('tbody tr').count()) === 2 && (await hm().locator('[data-auto]').count()) === 1);
  await shot('95_backlog');
  await go('#/testing/batches?show=mine'); await page.waitForSelector('#g tbody tr');
  check('My worklist: the demo batch assigned to me, at Weigh', /BAT-000001[\s\S]*In Progress[\s\S]*Analyst \(demo\)[\s\S]*1 of 7[\s\S]*Weigh/.test(await page.locator('#g').innerText()));
  await page.locator('#g a', { hasText: 'BAT-000001' }).click(); await page.waitForSelector('#panel .card'); await page.waitForTimeout(600);
  check('The batch opens at its next step (Weigh): the target, the balance used, what is still to do',
    /Weigh/.test(await page.locator('.tbtabs a.on').innerText()) && /accepted 0\.45 to 0\.55 g/.test(await page.locator('#panel').innerText())
    && /no weight/.test(await page.locator('.tbtodo').innerText()) && /EQ-\d+/.test(await page.locator('.tbused').innerText()));

  // ---- Weigh: paste three weights, spikes on the LCS and the matrix spikes
  await pasteAt(cell(6, 5), '0.5012\n0.4987\n0.5033'); await saveGrid();
  check('Weights pasted from Excel are recorded (no reason needed for new values)', /Saved 3 rows/.test(await toasts()) && !(await page.locator('.tbtodo').count()));
  await page.locator(cell(2, 2)).click();
  await addMaterial(async () => { await page.locator(cell(2, 3)).click({ button: 'right' }); await page.waitForSelector('.tbmenu'); await page.locator('.tbmenu button', { hasText: 'Add material' }).click(); },
    /IV-SPK|Multi-element spike/, 'Spike', 0.5);
  await page.locator(cell(4, 2)).click(); await page.locator(cell(5, 2)).click({ modifiers: ['Shift'] });
  await addMaterial(() => page.click('[data-a="mat"]'), /Multi-element spike/, 'Spike', 0.5);
  const spikes = await page.locator('#body tbody').innerText();
  check('Spikes added to selected rows (right-click menu and button): the LCS, spike and duplicate show the lot and volume',
    (spikes.match(/INV-\d+ 0\.5 mL/g) || []).length === 3);
  await shot('96_weigh');
  await complete();
  check('Weigh completed with the analyst\'s signature', /✓/.test(await page.locator('.tbtabs a', { hasText: 'Weigh' }).innerText()));

  // ---- Digestion fields, the standard dilution
  await tab('Microwave digestion');
  await page.fill('#pf_digest_final_volume_ml', '50'); await page.fill('#pf_program', 'Supplements-1'); await page.fill('#pf_maximum_temperature_c', '200');
  await page.click('#pf_save'); await page.waitForTimeout(900);
  await complete();
  await tab('Dilute for ICP-MS'); await page.click('#dl_std'); await saveGrid();
  check('The standard dilution (10 + 40) fills every row: factor 5, final volume 50', /\b5\s+50\b/.test(await page.locator(cell(1, 1) + ' >> xpath=..').innerText()));
  await complete();

  // ---- Readings: paste four analytes for every entry; raw data, the instrument, the check standards
  await tab('ICP-MS reading');
  const rows = await page.locator('#body tbody tr').allInnerTexts();
  const reading = (t) => {
    const k = t.split('\t')[2];
    if (/^ICV/.test(k)) return [49, 49, 49, 4.9]; if (/^CCV/.test(k)) return [51, 51, 51, 5.1];
    if (/Method Blank/.test(k)) return [0.005, 0.005, 0.005, 0.002]; if (/Laboratory Control/.test(k)) return [19.5, 19.5, 19.5, 1.95];
    if (/Duplicate/.test(k)) return [20.5, 20.5, 20.5, 2.0]; if (/Matrix Spike/.test(k)) return [21, 21, 21, 2.1];
    return [1.0, 1.0, 1.0, 0.05];
  };
  await pasteAt(cell(1, 5), rows.map((t) => reading(t).join('\t')).join('\n')); await saveGrid();
  const fc = page.waitForEvent('filechooser'); await page.click('[data-a="file"]'); const ch = await fc;
  await ch.setFiles({ name: 'BAT-000001_icpms_export.csv', mimeType: 'text/csv', buffer: Buffer.from('Sample,Pb,Cd,As,Hg\nICV,49,49,49,4.9\n') }); await page.waitForTimeout(1200);
  await page.click('[data-a="eq"]'); await page.waitForSelector('.modal #f_equipment_id'); await modalPick('.modal #f_equipment_id', /ICP-MS 2/); await page.click('.modal [data-ok]'); await page.waitForTimeout(1000);
  const nRows = await page.locator('#body tbody tr').count();
  await page.locator(cell(1, 2)).click(); await page.locator(cell(2, 2)).click({ modifiers: ['Shift'] });
  await addMaterial(() => page.click('[data-a="mat"]'), /check standard/, 'Standard', 1);
  await page.locator(cell(nRows, 2)).click();
  await addMaterial(() => page.click('[data-a="mat"]'), /check standard/, 'Standard', 1);
  const rd = await page.locator('#panel').innerText();
  check('Readings pasted for four analytes; the raw data file, the ICP-MS and the check standards are recorded; nothing left to do',
    /BAT-000001_icpms_export\.csv/.test(rd) && /ICP-MS 2/.test(rd) && !(await page.locator('.tbtodo').count()) && !/record it/.test(await page.locator('#body tbody').innerText()));
  await shot('97_readings');
  await complete();
  await tab('Result in the sample');
  const calc = await page.locator('#body tbody').innerText();
  check('The results are calculated live (reading x 5 x 50 / 1000 / weight)', /0\.496/.test(calc) && !/Waiting for/.test(calc));
  await complete();
  check('Every bench step done: the batch waits for QC Review', (await status()) === 'Awaiting Review');
  await tab('Results and QC');
  const qc = await page.locator('#qc tbody').innerText();
  check('QC verdicts per analyte: check standards, blank, LCS, spike recoveries and the duplicate RPD all pass',
    /Pass/.test(qc) && !/Fail|Waiting|Not judged/.test(qc) && /Matrix Spike Duplicate\s+1\s+RPD/.test(qc) && /97\.5 %/.test(qc));
  check('The reported results follow the test\'s rounding (3 significant figures)', /0\.496/.test(await page.locator('#res tbody').innerText()));
  await shot('98_results');

  // ---- WD-5: a new analytical run (re-analysis in duplicate) of one sample, with the run's own ICV and CCVs
  await tab('ICP-MS reading');
  const sIdx = (await page.locator('#body tbody tr').allInnerTexts()).findIndex((t) => /\tSample\t/.test(t) && !/Spike/.test(t)) + 1;
  const sLabel = (await page.locator(cell(sIdx, 2)).innerText()).trim();
  await page.locator(cell(sIdx, 3)).click();
  await page.click('[data-a="rean"]'); await page.waitForSelector('.modal #f_runs'); await page.locator('.modal #f_runs').selectOption('2'); await page.click('.modal [data-ok]');
  await sign(page); await page.waitForFunction(() => /run=2/.test(location.hash), null, { timeout: 15000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.tbruns a.on')].some((a) => a.textContent.includes('Run 2')), null, { timeout: 15000 }); await page.waitForTimeout(800);
  const rr = await page.locator('#body tbody').innerText();
  check('Add analytical run (duplicate, signed with a reason): run 2 opens with the sample read again as RA1- and RA2- and the run\'s own ICV and CCVs; the batch is back in progress',
    rr.includes('RA1-' + sLabel) && rr.includes('RA2-' + sLabel) && /RA1-ICV/.test(rr) && /RA1-CCV-1/.test(rr) && !/Method Blank/.test(rr)
    && (await status()) === 'In Progress' && /run 2/.test(await page.locator('.tbtodo').innerText()));
  await shot('98a_run2');
  const rows2 = await page.locator('#body tbody tr').allInnerTexts();
  let si = 0;
  await pasteAt(cell(1, 5), rows2.map((t) => (t.split('\t')[2] === 'Sample' ? (si++ === 0 ? [1.1, 1.1, 1.1, 0.06] : [1.2, 1.2, 1.2, 0.07]) : reading(t)).join('\t')).join('\n')); await saveGrid();
  const fc2 = page.waitForEvent('filechooser'); await page.click('[data-a="file"]'); const ch2 = await fc2;
  await ch2.setFiles({ name: 'BAT-000001_icpms_run2.csv', mimeType: 'text/csv', buffer: Buffer.from('Sample,Pb,Cd,As,Hg\nICV,49,49,49,4.9\n') }); await page.waitForTimeout(1200);
  await page.click('[data-a="eq"]'); await page.waitForSelector('.modal #f_equipment_id'); await modalPick('.modal #f_equipment_id', /ICP-MS 2/); await page.click('.modal [data-ok]'); await page.waitForTimeout(1000);
  const p2 = await page.locator('#panel').innerText();
  check('Run 2 has its own readings, raw data file and instrument (run 1\'s file is on run 1); nothing left to do',
    /BAT-000001_icpms_run2\.csv/.test(p2) && !/BAT-000001_icpms_export/.test(p2) && /ICP-MS 2/.test(p2) && !(await page.locator('.tbtodo').count()));
  await complete(); await tab('Result in the sample'); await complete();
  await tab('Results and QC');
  const res3 = await page.locator('#res tbody').innerText();
  check('Every reading is kept and calculated (three results for the re-analysed sample, two of them from run 2); run 2\'s QC is judged in run 2',
    (res3.match(new RegExp(sLabel + '\\tSample\\t\\d', 'g')) || []).length === 3 && (res3.match(new RegExp('RA[12]-' + sLabel + '\\tSample\\t2', 'g')) || []).length === 2
    && /RA1-ICV\s+2\s+Recovery %/.test(await page.locator('#qc tbody').innerText()));

  // ---- Re-prep one sample from the results
  const lastSample = (await page.locator('#res tbody tr').allInnerTexts()).map((t, i) => [t, i + 1]).filter(([t]) => /\tSample\t1\t/.test(t)).pop();
  const rpLabel = lastSample[0].split('\t')[1];
  await page.locator(`#res tbody tr:nth-child(${lastSample[1]}) td:nth-child(3)`).click();
  await page.click('#rp'); await page.waitForSelector('.modal #f_replicates'); await page.locator('.modal #f_replicates').selectOption('2'); await page.click('.modal [data-ok]');
  await sign(page, { reason: 'Digest not clear (particles)' }); await page.waitForTimeout(900);
  check('Re-prep in duplicate: the sample leaves this batch\'s results', !new RegExp(rpLabel + '\\tSample').test(await page.locator('#res tbody').innerText()));
  // 0.28.1: it stays on the bench tabs, read only, with its data and where it went
  const origBatch = page.url().match(/#\/testing\/batches\/[\w-]+/)[0];
  await tab('Dilute for ICP-MS');
  const dilTxt = await page.locator('#body').innerText();
  check('The re-prepped sample stays on the step, greyed and read only, saying it waits in the backlog',
    dilTxt.includes(rpLabel) && /Re-prepped \(Digest not clear.*\): waiting in the backlog/.test(dilTxt) && (await page.locator('#body tr.tbsup', { hasText: rpLabel }).count()) === 1, dilTxt.split('\n').filter((l) => l.includes(rpLabel)).join(' | '));
  await go('#/testing'); await page.waitForSelector('.tbgroup');
  const first = await hm().locator('tbody tr').first().innerText();
  check('The re-prep is at the top of the backlog, in duplicate, with its reason', new RegExp('Re-prep\\t' + rpLabel).test(first) && /Re-prep ×2/.test(first) && /Digest not clear/.test(first));

  // ---- Batch the selected backlog rows (the re-prep and one more)
  await hm().locator('tbody tr:nth-child(1) td:nth-child(1)').click(); await hm().locator('tbody tr:nth-child(2) td:nth-child(1)').click({ modifiers: ['Shift'] });
  await hm().locator('[data-sel]').click(); await page.waitForSelector('#g tr.tbmade', { timeout: 15000 });
  const madeCode = decodeURIComponent((page.url().match(/made=([^&]+)/) || [])[1] || '');
  check('Making a batch lands on the Batches list (not inside the batch), with the new batch highlighted',
    /#\/testing\/batches\?show=open/.test(page.url()) && /^BAT-\d{6}$/.test(madeCode) && (await page.locator('#g tr.tbmade').innerText()).includes(madeCode) && /made and assigned to you/.test(await page.locator('main').innerText()));
  await openMade();
  check('Batch selected rows: a new batch with the re-prep twice (labelled RP1- and RP2-), one more sample and fresh QC',
    (await page.locator('main h1').innerText()).includes(madeCode) && /3 samples, 7 QC/.test(await page.locator('main .sub').innerText())
    && new RegExp('RP1-' + rpLabel + '[\\s\\S]*RP2-' + rpLabel).test(await page.locator('#panel').innerText()));
  check('The new batch says where each re-prep came from', new RegExp('Re-prep of ' + rpLabel + ' in BAT-\\d{6}').test(await page.locator('#panel').innerText()));
  await go(origBatch); await page.waitForSelector('#panel .card'); await tab('Dilute for ICP-MS');
  check('The first batch now says which batch the re-prep went to (a link)', (await page.locator('#body a', { hasText: `now in ${madeCode}` }).count()) === 1);

  // ---- Witness: digestion "witness required" on version 2, approved, ordered, done at the bench
  await go('#/methods'); await page.locator('#g tbody tr', { hasText: 'Heavy Metals (Pb, Cd, As, Hg)' }).locator('a', { hasText: 'v2' }).click(); await page.waitForSelector('.wdtabs');
  const v2 = page.url().match(/versions\/([\w-]+)/)[1];
  await go(`#/methods/versions/${v2}?tab=workflow`); await page.locator('#diag .node', { hasText: 'Microwave digestion' }).click(); await page.waitForSelector('#se #s_wit');
  await page.locator('#se #s_wit').selectOption('Required'); await page.click('#s_save'); await sign(page); await page.waitForTimeout(900);
  await page.locator('#diag .node', { hasText: 'Microwave digestion' }).click(); await page.waitForSelector('#se #s_wit');
  check('The designer sets a step\'s witness (None, Optional, Required), saved with a signature', (await page.locator('#se #s_wit').inputValue()) === 'Required');
  const v2out = await verifyVersion(BASE, v2);
  check('Version 2 (witness required) passes its workflow verification: the automated witness signs the digestion', /^Pass/.test(v2out), v2out);
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/methods/versions/${v2}?tab=review`); await page.waitForSelector('#approve');
  await page.click('#approve'); await sign(page); await page.waitForTimeout(1000);
  // order it on a logged sample (Alex, through the order API)
  const api = async (who, p, body) => {
    const lr = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: who, password: PASSWORD }) });
    const cookie = lr.headers.get('set-cookie').split(';')[0];
    const users = await (await fetch(BASE + '/api/users', { headers: { Cookie: cookie } })).json();
    const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
    const r = await fetch(BASE + '/api' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  };
  const ordersList = await api('akiddle', '/orders');
  const lo1 = (ordersList.rows || ordersList).find((o) => o.order_code === 'LO-000001');
  const od = await api('akiddle', '/orders/' + lo1.id);
  const van = od.samples.find((s) => s.client_sample_id === 'VAN-0912');
  const line = od.orderable.find((l) => /Heavy Metals \(Pb, Cd, As, Hg\)/.test(l.test_name));
  await api('akiddle', `/orders/${lo1.id}/add-test`, { sample_ids: [van.id], line_id: line.line_id });
  await signIn(page, BASE, 'Analyst (demo)', '#/testing'); await page.waitForSelector('.tbgroup');
  check('Version 2 is approved and its first order is in the backlog as its own group', /ICP-MS \(v2\)/.test(await page.locator('main').innerText()));
  await page.locator('.tbgroup', { hasText: 'ICP-MS (v2)' }).locator('[data-auto]').click(); await page.waitForSelector('.modal [data-ok]'); await page.click('.modal [data-ok]');
  await openMade();
  await complete();
  await tab('Weigh'); const wn = await page.locator('#body tbody tr').count();
  await pasteAt(cell(1, 5), Array(wn).fill('0.5').join('\n')); await saveGrid();
  await page.click('[data-a="eq"]'); await page.waitForSelector('.modal #f_equipment_id'); await modalPick('.modal #f_equipment_id', /Analytical balance/); await page.click('.modal [data-ok]'); await page.waitForTimeout(900);
  await complete();
  await tab('Microwave digestion');
  for (const id of await page.locator('#body [data-k]').evaluateAll((xs) => xs.map((x) => x.id))) await page.fill('#' + id, id.includes('program') ? 'Supplements-1' : '50');
  await page.click('#pf_save'); await page.waitForTimeout(900);
  await page.click('[data-a="complete"]'); await page.waitForSelector('.sigmodal #c_wit');
  check('Completing a witness-required step: Witnessed is ticked and fixed, with the witness\'s sign-in fields',
    (await page.locator('.sigmodal #c_wit').isChecked()) && (await page.locator('.sigmodal #c_wit').isDisabled()) && (await page.locator('.sigmodal #c_wuser').isVisible()));
  await page.fill('.sigmodal #c_pass', PASSWORD); await page.fill('.sigmodal #c_wuser', 'labsup'); await page.fill('.sigmodal #c_wpass', 'wrong-password'); await page.click('.sigmodal [data-ok]');
  await page.waitForFunction(() => /witness/i.test(document.querySelector('.sigmodal .merr')?.textContent || ''));
  check('A wrong witness password is refused and nothing is signed', /witness user ID or password is not correct/i.test(await page.textContent('.sigmodal .merr')));
  await page.fill('.sigmodal #c_pass', PASSWORD); await page.fill('.sigmodal #c_wpass', PASSWORD); await page.click('.sigmodal [data-ok]');
  await page.waitForSelector('.sigmodal', { state: 'detached', timeout: 15000 }); await page.waitForTimeout(900);
  check('Digestion completed by the analyst and witnessed by the Lab Supervisor, both signed', /performed by Analyst \(demo\)[\s\S]*witnessed by Lab Supervisor \(demo\)/.test(await page.locator('#panel .tbhead').innerText()));
  await shot('99_witness');
  const bUrl = page.url().split('#')[1].split('?')[0];

  // ---- WD-3 QC Review: the Lab Supervisor reviews BAT-000001 (choose the re-analysed reading, return once, approve)
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#/testing/batches?show=review'); await page.waitForSelector('#g tbody tr');
  check('The QC Review queue lists the batch waiting for review', /BAT-000001[\s\S]*Awaiting Review/.test(await page.locator('#g').innerText()));
  await page.locator('#g a', { hasText: 'BAT-000001' }).click(); await page.waitForSelector('#rv_res'); await page.waitForTimeout(800);
  const b1 = page.url().match(/batches\/([\w-]+)/)[1];
  check('The batch opens at QC Review: the re-analysed sample needs its reportable reading chosen; the others are chosen automatically',
    /choose the reportable reading/.test(await page.locator('.tbtodo').innerText()) && (await page.locator('#rv_ok').count()) === 1);
  const rv = await api('labsup', `/testing/batches/${b1}/review`);
  // nested: one row per sample with its analytes under it (hits above the LOQ and items to check), and one row per QC entry
  const samplesN = new Set(rv.items.map((x) => x.requested_test_id)).size;
  check('Results to report are nested under each sample (one row per sample), and QC under each QC entry',
    (await page.locator('#rv_res > .gwrap > table > tbody > tr:not(.gdetail)').count()) === samplesN
    && (await page.locator('#rv_qc > .gwrap > table > tbody > tr:not(.gdetail)').count()) === new Set(rv.verdicts.map((v) => v.entry_id + ':' + v.analytical_run)).size);
  const nested = () => page.locator('#rv_res tr.gdetail .gwrap > table > tbody > tr');
  const hitRows = await nested().count();
  check('Under each sample, only hits above the LOQ and items to check are listed, with the sample repeated on every row',
    hitRows <= rv.items.length && (hitRows === 0 || (await nested().first().innerText()).split('\t')[0].trim().length > 0));
  await page.locator('.rvswitch[data-sw="results"] button', { hasText: 'All analytes' }).click(); await page.waitForTimeout(900);
  const allRows = await nested().count();
  check('"All analytes" lists every analyte of every sample', allRows === rv.items.length, `${hitRows} shown, ${allRows} with all, ${rv.items.length} items`);
  await page.locator('.rvswitch[data-sw="results"] button', { hasText: 'Hits above the LOQ' }).click(); await page.waitForTimeout(900);
  // WD-5: the re-analysed sample: tick one reading with a justification, or several to report their average
  const multi = rv.items.filter((x) => x.candidates.length > 1);
  for (const [k, it] of multi.entries()) {
    const row = page.locator('#rv_res tr.gdetail .gwrap > table > tbody > tr', { hasText: it.analyte_name }).filter({ hasText: it.sample_label }).first();
    await row.locator('button', { hasText: 'Choose' }).click(); await page.waitForSelector('.modal #f_c0');
    if (k === 0) for (let i = 0; i < it.candidates.length; i++) await page.check(`.modal #f_c${i}`);
    else { await page.check(`.modal #f_c${it.candidates.findIndex((c) => c.run_no === 2)}`); await page.fill('.modal #f_justification', 'Run 1 drifted (internal standard); run 2 is in control'); }
    await page.click('.modal [data-ok]'); await page.waitForTimeout(1300);
  }
  const chosen = await api('labsup', `/testing/batches/${b1}/review`);
  const got = (it) => chosen.items.find((x) => x.requested_test_id === it.requested_test_id && x.analyte_id === it.analyte_id);
  check('Reportable results chosen with the tick boxes: the average of the three readings for one analyte, the run 2 reading (justified) for the others',
    multi.length > 1 && got(multi[0]).mode === 'Average' && got(multi[0]).readings.length === 3
    && multi.slice(1).every((it) => got(it).chosen_run_no === 2 && /Run 1 drifted/.test(got(it).justification))
    && /Average of 3 readings/.test(await page.locator('#rv_res').innerText()));
  // every step must be approved before the batch can be
  check('The batch cannot be approved until each step is approved (Approve batch is locked)',
    /not approved yet/.test(await page.locator('.tbtodo').innerText()) && await page.locator('#rv_ok').isDisabled());
  const firstStep = page.locator('#rv_steps tbody tr').first();
  await firstStep.locator('a').click(); await page.waitForSelector('.rvbar');
  check('Opening a step from the review shows it as recorded, with an Approve step button', /check this step as recorded/.test(await page.locator('.rvbar').innerText()));
  await page.click('.rvbar [data-mark="approve"]'); await page.waitForSelector('.rvbar.ok', { timeout: 15000 });
  check('The step is approved (who and when are shown)', /Approved in QC Review by Lab Supervisor \(demo\)/.test(await page.locator('.rvbar').innerText()));
  await go(`#/testing/batches/${b1}`); await page.waitForSelector('#rv_steps');
  // approve each step still to approve, waiting for the page to come back with one fewer each time
  const toApprove = () => page.locator('#rv_steps button', { hasText: 'Approve step' });
  const approveAll = async () => {
    for (let i = 0; i < 20; i++) {
      const n = await toApprove().count(); if (!n) break;
      await Promise.all([page.waitForResponse((res) => res.url().includes('/review-mark')), toApprove().first().click()]);
      await page.waitForFunction((m) => document.querySelectorAll('#rv_steps button').length && [...document.querySelectorAll('#rv_steps button')].filter((x) => x.textContent === 'Approve step').length < m, n, { timeout: 15000 });
    }
  };
  await approveAll();
  check('Every step approved from the review list; nothing left to resolve', /Ready to approve/.test(await page.locator('#panel').innerText()) && !(await page.locator('#rv_ok').isDisabled()));
  await page.click('#rv_ret'); await page.waitForSelector('.modal #f_step_run_id'); await page.click('.modal [data-ok]');
  await sign(page, { reason: 'Check the digest volume on the bench sheet' }); await page.waitForTimeout(900);
  check('Return to the analyst (signed, with what to fix): the batch is back in progress with the reviewer\'s note',
    (await status()) === 'In Progress' && /Returned by the reviewer[\s\S]*Check the digest volume/.test(await page.locator('main').innerText()));
  await signIn(page, BASE, 'Analyst (demo)', `#/testing/batches/${b1}`); await page.waitForSelector('#panel .card'); await page.waitForTimeout(600);
  await complete();
  check('The analyst completes the reopened step; the batch is back for review', (await status()) === 'Awaiting Review');
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/testing/batches/${b1}`); await page.waitForSelector('#rv_steps'); await page.waitForTimeout(600);
  const marks = (await api('labsup', '/testing/batches/' + b1)).review_marks;
  check('After the return only the reopened step needs approving again; the steps before it keep their approval',
    marks.filter((m) => !m.mark_id).length >= 1 && marks.filter((m) => m.mark_id).length >= 1 && /choose the reportable reading/.test(await page.locator('#panel').innerText()) === false);
  await approveAll();
  check('The reviewer\'s choices were kept', /Ready to approve/.test(await page.locator('#panel').innerText()));
  await page.click('#rv_ok'); await sign(page); await page.waitForTimeout(1200);
  const appr = await page.locator('main').innerText();
  check('Approved (signed "Reviewed by"): the results are stored with their specification comparison; the QC Review step is done',
    (await status()) === 'Approved' && /Approved by Lab Supervisor \(demo\)/.test(appr) && /Stored results/.test(appr) && /✓/.test(await page.locator('.tbtabs a', { hasText: 'QC Review' }).innerText()));
  await shot('99b_review');
  const sampleId = rv.items[0] && (await api('labsup', '/testing/batches/' + b1)).entries.find((e) => e.requested_test_id === rv.items[0].requested_test_id).sample_id;
  await go('#/samples/' + sampleId); await page.waitForSelector('#rg tbody tr');
  check('The sample page shows its approved results and links to the batch', /Lead[\s\S]*BAT-000001/.test(await page.locator('#rg').innerText()));
  const ordersAfter = await api('akiddle', '/orders');
  check('The order is In Testing (some of its tests are not finished)', (ordersAfter.rows || ordersAfter).some((o) => o.order_code === 'LO-000003' && o.status === 'In Testing'));
  await go('#/testing/batches?show=open'); await page.locator('#g a', { hasText: madeCode }).click(); await page.waitForSelector('#cancelb');
  await page.click('#cancelb'); await sign(page, { reason: 'Digester down; rebatch tomorrow' }); await page.waitForTimeout(900);
  check('A batch is cancelled (signed, with a reason): its samples go back to the backlog', (await status()) === 'Cancelled' && /Cancelled/.test(await page.locator('.tbtodo').innerText()));
  await go('#/testing'); await page.waitForSelector('.tbgroup');
  check('The re-prep is back at the top of the backlog', /^Re-prep/.test(await hm().locator('tbody tr').first().innerText()));

  // ---- Assign (Lab Supervisor), the audit trail, Intake sees no bench buttons
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#' + bUrl); await page.waitForSelector('#assign');
  await page.click('#assign'); await page.waitForSelector('.modal #f_user_id'); await modalPick('.modal #f_user_id', /Lab Supervisor/); await page.click('.modal [data-ok]'); await page.waitForTimeout(900);
  check('A Lab Supervisor reassigns the batch', /assigned to Lab Supervisor \(demo\)/.test(await page.locator('main .sub').innerText()));
  await page.click('main h1 .auditbtn'); await page.waitForSelector('.modal tbody tr'); await page.waitForTimeout(400);
  const aud = await page.locator('.modal').innerText();
  check('The batch\'s audit trail lists its steps, values and signatures', /Performed by|Witnessed by/.test(aud) && /Value for/.test(aud) && /Batch BAT-/.test(aud));
  await page.keyboard.press('Escape');
  await signIn(page, BASE, 'Intake Tech (demo)', '#/testing'); await page.waitForTimeout(800);
  check('Intake sees the backlog but cannot batch', (await page.locator('[data-auto]').count()) === 0);

  // ---- a supervisor assigns several batches at once: Ctrl+click two rows of the Batches list, then Assign selected
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#/testing/batches?show=all'); await page.waitForSelector('#g tbody tr');
  const bRows = page.locator('#g > .gwrap > table > tbody > tr');
  // an open batch and another batch two or more rows away (Ctrl+click); approved or cancelled ones are skipped when assigning
  const rowTexts = await bRows.allInnerTexts();
  const isOpen = (t) => !/Approved|Cancelled/.test(t);
  const i1 = rowTexts.findIndex(isOpen);
  const i2 = rowTexts.findIndex((t, i) => Math.abs(i - i1) > 1);
  await bRows.nth(i1).locator('td:nth-child(5)').click(); await bRows.nth(i2).locator('td:nth-child(5)').click({ modifiers: ['Control'] });
  check('Ctrl+click selects rows that are not next to each other', (await bRows.nth(i1).locator('td.sel').count()) > 0 && (await bRows.nth(i2).locator('td.sel').count()) > 0
    && (await bRows.nth(Math.min(i1, i2) + 1).locator('td.sel').count()) === 0, `rows ${i1} and ${i2}`);
  const picked = [i1, i2].filter((i) => isOpen(rowTexts[i])).map((i) => rowTexts[i].split('\t')[0].trim());
  await page.click('#massassign'); await page.waitForSelector('.modal #f_user_id');
  const intro = await page.locator('.modal .intro').innerText();
  check('Assign selected lists the picked batches that are still open (approved or cancelled ones are skipped)',
    picked.length >= 1 && picked.every((c) => intro.includes(c)) && intro.split(',').length === picked.length, `${intro} | expected ${picked.join(', ')}`);
  await page.locator('.modal #f_user_id').selectOption({ label: 'Analyst (demo)' }); await page.click('.modal [data-ok]'); await page.waitForTimeout(1500);
  const afterAssign = await api('labsup', '/testing/batches?show=all');
  const assignedNow = (afterAssign.rows || []).filter((r) => picked.includes(r.batch_code));
  check('The selected open batches are assigned to the analyst in one go',
    /assigned/.test(await toasts()) && assignedNow.length === picked.length && assignedNow.every((r) => r.assigned_name === 'Analyst (demo)'), await toasts());

  check('No native browser dialogs were used', native === 0);
  check('No page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
