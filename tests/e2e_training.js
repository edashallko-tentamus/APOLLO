// 0.31.0 (migration 053): training and competency. QA opens Testing > Training and competency, grants the legacy
// qualifications (signed: the demo Analyst did Heavy Metals and Vitamin C batches); the Analyst's page and training
// report; the Lab Supervisor gives Microbiology its own rule (department trained after 1 test, any test of it); the
// lab's training gate is switched on and the Analyst cannot sign the Batching step of a USP <62> batch; the Lab
// Supervisor records the Analyst's initial competency on USP <62> (a training record with evidence), evaluates it
// (signed), QA approves it (signed): the qualification is granted, the Analyst is department trained in Microbiology,
// and the same Batching step can now be signed; a continuing competency by training samples makes TRN- samples and
// cannot be evaluated before their results; the rules' page; who may see what. Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, login, call } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function as(who) {
  const cookie = await login(BASE, who, PASSWORD);
  const site = (await call(BASE, '/users', { cookie })).data.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
  return async (p, body, signed, method) => {
    const res = await fetch(BASE + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site },
      body: body ? JSON.stringify({ ...body, ...(signed ? { signature: { username: who, password: PASSWORD } } : {}) }) : undefined });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => ({})) : Buffer.from(await res.arrayBuffer());
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
  const qa = await as('qa.reviewer'); const sup = await as('labsup'); const ana = await as('analyst'); const alex = await as('akiddle');

  // ---- 1. QA: the overview and the legacy qualifications
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/training'); await go('#/training');
  check('Testing has "Training and competency"', (await page.locator('nav a[href="#/training"]').count()) === 1);
  check('The People tab lists the lab\'s people; the lab does not require training yet', (await page.locator('#pg tbody tr').count()) >= 8 && /does not require training at the bench yet/.test(await page.locator('main').innerText()));
  await page.click('#legacy'); await sign(page); await page.waitForTimeout(1500);
  check('Granting the legacy qualifications (signed) gives the Analyst Heavy Metals and Vitamin C (the tests they did)', /2 legacy qualifications granted/.test(await toasts()), await toasts());
  await go('#/training');
  const anaRow = page.locator('#pg tbody tr', { hasText: 'Analyst (demo)' });
  check('The Analyst now has 2 qualified tests', /\b2\b/.test(await anaRow.locator('td:nth-child(2)').innerText()));
  await anaRow.locator('a').click(); await page.waitForSelector('#qg tbody tr');
  const anaId = page.url().split('/').pop();
  const qtext = await page.locator('#qg').innerText();
  check('The Analyst\'s page: Legacy qualifications, current, with the runs counted', /Legacy/.test(qtext) && /Current/.test(qtext) && /Heavy Metals/.test(qtext) && /Vitamin C/.test(qtext));
  check('Work done: the rolling counter of their batches', /Vitamin C stability/.test(await page.locator('#wg').innerText()));
  const rep = await page.evaluate(async (h) => { const r = await fetch(h); return { ok: r.ok, t: r.headers.get('content-type') }; }, await page.getAttribute('#report', 'href'));
  check('The training report prints (PDF)', rep.ok && /pdf/.test(rep.t), JSON.stringify(rep));
  await shot('t01_person');

  // ---- 2. Microbiology's own rule (Lab Supervisor), by the Rules tab
  await signIn(page, BASE, 'Lab Supervisor (demo)', '#/training?tab=rules'); await go('#/training?tab=rules');
  const ov = await sup('/training');
  const micro = ov.departments.find((d) => d.department_name === 'Microbiology');
  // 0.32.0 (Alex): each department sets its own count; every department has its rule, made from the lab's (4 tests)
  const rtxt = await page.locator('#rg').innerText();
  check('The Rules tab lists every department with its own rule (4 tests to start), and "Tests with no department"; nothing to add',
    ov.departments.every((d) => rtxt.includes(d.department_name)) && /Tests with no department/.test(rtxt) && (await page.locator('#rg [data-add]').count()) === 0
    && ov.rules.filter((r) => r.department_id).length === ov.departments.length && ov.rules.every((r) => Number(r.dept_trained_after) === 4));
  const ci = await page.evaluate(() => [...document.querySelectorAll('#rg thead th')].findIndex((th) => th.textContent.trim().startsWith('Department trained after')));
  await page.locator('#rg tbody tr', { hasText: 'Microbiology' }).first().locator('td').nth(ci).click();
  await page.keyboard.type('1'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  await page.click('#rg .savebar [data-save]'); await sign(page, { reason: 'Micro rule' }); await page.waitForTimeout(1200);
  await sup('/training/rules', { reason: 'Micro rule', rows: [{ department_id: micro.id, unlock_any_test: true, unlock_can_train: false }] });
  const ov2 = await sup('/training');
  check('Microbiology\'s count set in the grid (department trained after 1 test); the other departments keep 4',
    ov2.rules.find((r) => r.department_id === micro.id).dept_trained_after === 1 && ov2.rules.filter((r) => r.department_id && r.department_id !== micro.id).every((r) => Number(r.dept_trained_after) === 4));

  // ---- 3. the training gate: the Analyst is not qualified for USP <62>
  const sites = await alex('/sites'); const cfl = sites.find((x) => x.site_code === 'CFL');
  await alex('/sites/bulk', { rows: [{ id: cfl.id, require_training: true }], reason: 'Training required (test)' });
  const bl = await ana('/testing/backlog');
  const usp62 = bl.rows.filter((x) => x.test_name === 'USP <62> Specified Microorganisms');
  const batch = await ana('/testing/batches', { test_version_id: usp62[0].test_version_id, items: usp62.map((x) => ({ requested_test_id: x.requested_test_id })) });
  let bd = await ana('/testing/batches/' + batch.id);
  const batching = bd.steps.find((s) => s.step_type === 'Batching');
  let gate = '';
  try { await ana(`/testing/step-runs/${batching.id}/complete`, {}, true); } catch (e) { gate = e.message; }
  check('With the gate on, the Analyst cannot sign the Batching step of a USP <62> batch: not qualified', /Analyst \(demo\) is not qualified for USP <62> Specified Microorganisms/.test(gate), gate);

  // ---- 4. initial competency by record (Lab Supervisor), evaluated, approved by QA
  await go('#/training/people/' + anaId);
  await page.click('#start'); await page.waitForSelector('.modal #f_test');
  const testOpt = await page.evaluate(() => [...document.querySelector('.modal #f_test').options].find((o) => /^USP <62> Specified/.test(o.text)).value);
  await page.selectOption('.modal #f_test', testOpt); await page.waitForTimeout(200);
  check('The dialog knows it is the initial competency (not qualified yet)', (await page.inputValue('.modal #f_kind')) === 'Initial' && /initial competency/.test(await page.locator('.modal #kindhelp').innerText()));
  await page.fill('.modal #f_desc', 'Read SOP MC-12.04; observed 3 runs; ran 3 supervised runs with the expected results');
  await page.fill('.modal #f_date', new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  await page.setInputFiles('.modal #f_ev', { name: 'training-form-usp62.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.click('.modal [data-ok]'); await page.waitForSelector('#evg'); await page.waitForTimeout(500);
  const attUrl = page.url(); const attId = attUrl.split('/').pop();
  check('Started: the attempt page shows the training and its evidence', /training-form-usp62\.pdf/.test(await page.locator('#evg').innerText()) && /In progress/.test(await page.locator('main h1, main .sub, main').first().innerText()));
  await page.click('#eval'); await page.waitForSelector('.modal #f_evaluation');
  await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(1200);
  check('The Lab Supervisor evaluates it Pass (signed)', /Evaluated and signed/.test(await toasts()), await toasts());
  check('The Lab Supervisor cannot approve it (no Approve button)', (await page.locator('#ok').count()) === 0);
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/training/attempts/' + attId); await go('#/training/attempts/' + attId);
  await page.click('#ok'); await page.waitForSelector('.modal #f_note'); await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(1200);
  check('QA approves it (signed)', /Approved and signed/.test(await toasts()), await toasts());
  const p2 = await qa('/training/people/' + anaId);
  const q62 = p2.qualifications.find((q) => q.test_name === 'USP <62> Specified Microorganisms');
  check('The qualification is granted from the initial competency, current', q62 && q62.source === 'Initial competency' && q62.state === 'Current' && q62.attempt_id === attId);
  check('With Microbiology\'s rule (1 test), the Analyst is department trained in Microbiology', p2.departments.find((d) => d.department_name === 'Microbiology').trained === true);
  await ana(`/testing/step-runs/${batching.id}/complete`, {}, true);
  bd = await ana('/testing/batches/' + batch.id);
  check('Qualified, the Analyst signs the same Batching step', !!bd.steps.find((s) => s.id === batching.id).completed_at);
  await shot('t02_attempt');

  // ---- 5. continuing competency by training samples
  const hm = p2.tests.find((t) => t.test_name === 'Heavy Metals (Pb, Cd, As, Hg) by ICP-MS');
  const att2 = await sup('/training/attempts', { user_id: anaId, test_id: hm.id, kind: 'Continuing', route: 'Training samples', samples: 2,
    known_values: [{ analyte_id: hm.analytes[0].analyte_id, value: 0.5, tolerance_pct: 15 }] });
  const ad = await sup('/training/attempts/' + att2.id);
  check('Continuing competency by training samples: 2 TRN- samples on an internal order, waiting for their results', ad.samples.length === 2 && ad.samples.every((s) => /^TRN-/.test(s.sample_code)) && ad.results.every((r) => !r.final));
  let early = '';
  try { await sup(`/training/attempts/${att2.id}/evaluate`, { evaluation: 'Pass' }, true); } catch (e) { early = e.message; }
  check('It cannot be evaluated before the training samples have approved results', /no approved final result/.test(early), early);
  const blk = (await ana('/testing/backlog')).rows.filter((x) => /^TRN-/.test(x.sample_code || ''));
  check('The training samples wait in the backlog like any sample', blk.length === 2, blk.length);

  // ---- 6. who sees what
  await signIn(page, BASE, 'Analyst (demo)', '#/training'); await go('#/training');
  check('The Analyst (no training.view) goes to their own training page', /Training: Analyst \(demo\)/.test(await page.locator('main h1').innerText()) && (await page.locator('#start').count()) === 1 || /Training: Analyst/.test(await page.locator('main h1').innerText()));
  let other = '';
  try { await ana('/training/people/' + p2.attempts[0].created_by); } catch (e) { other = e.message; }
  check('and cannot open someone else\'s', /your own training only/.test(other), other);
  await page.click('main h1 .auditbtn'); await page.waitForTimeout(900);
  check('Their audit trail lists the qualifications and the competency', /Qualification AQ-/.test(await page.locator('.modal').innerText()) && /Competency TA-/.test(await page.locator('.modal').innerText()));
  await alex('/sites/bulk', { rows: [{ id: cfl.id, require_training: false }], reason: 'Back as it was (test)' });

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
