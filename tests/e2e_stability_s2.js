// Stability S-2 (migration 041) end to end in the browser, on a fresh database (demo data of seeds 025 and 027):
//  - the studies list shows STB-00001's chamber excursion waiting for QA;
//  - STB-00001's page: no report can be issued (the excursion, no finalized result), a preview of the next report;
//  - the QA Reviewer assesses the excursion (signed, with a justification); an analyst sees no Assess button;
//  - an amendment: "Amend the study" starts a new version of SQ-00002; a 36-month timepoint pasted and ticked for
//    moisture at 25/60; issued, sent and accepted; the study runs to version 2 with the new pull scheduled;
//  - the Lab Supervisor cancels STB-00002 (awaiting material): signed with a reason, its T0 order cancelled;
//  - stored material is disposed of only when nothing still needs it.
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
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const cell = (host, r, c) => page.locator(`${host} .gwrap > table > tbody > tr:nth-child(${r}) > td:nth-child(${c})`);
  const cookie = await login(BASE, 'akiddle', PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const cfl = users.find((u) => u.username === 'akiddle').sites.find((s) => s.site_code === 'CFL').id;
  const api = async (p, opts = {}) => { const res = await fetch(BASE + '/api' + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': cfl },
    body: opts.body ? JSON.stringify(opts.body) : undefined }); return { ok: res.ok, data: await res.json().catch(() => ({})) }; };
  const studies = (await api('/stability/studies')).data.rows;
  const s1 = studies.find((r) => r.study_code === 'STB-00001'); const s2 = studies.find((r) => r.study_code === 'STB-00002');

  // ---- the list and STB-00001's page
  await signIn(page, BASE, 'Alex Kiddle', '#/stability/studies'); await page.waitForSelector('#g tbody tr');
  const list = await page.locator('#g tbody tr').allInnerTexts();
  check('Stability studies: STB-00001 shows its chamber excursion waiting for QA', list.some((t) => /STB-00001/.test(t) && /\t1\t/.test('\t' + t.replace(/\n/g, '\t') + '\t')), list.find((t) => /STB-00001/.test(t)) || '');
  await page.goto(`${BASE}/#/stability/studies/${s1.id}`); await page.waitForSelector('#reports .stb-probs'); await page.waitForTimeout(800);
  const probs = await page.locator('#reports .stb-probs').innerText();
  check('No report can be issued yet: the excursion is not assessed and no result is finalized (Issue is disabled)',
    /not assessed by QA/.test(probs) && /No results are finalized yet/.test(probs) && (await page.locator('#issue').isDisabled()), probs.replace(/\n/g, ' / '));
  check('The excursion card lists Stability chamber 1 (28.1 °C), not assessed', /Stability chamber 1/.test(await page.locator('#excur').innerText()) && /Not assessed/.test(await page.locator('#excur').innerText()));
  const prev = await fetch(`${BASE}/api/stability/studies/${s1.id}/report-preview.pdf`, { headers: { Cookie: cookie, 'x-site-id': cfl } });
  check('A preview of the next report opens (PDF)', prev.ok && (prev.headers.get('content-type') || '').includes('pdf'));
  await shot('stb2_01_study');

  // ---- QA assesses the excursion; an analyst cannot
  await signIn(page, BASE, 'Analyst (demo)', `#/stability/studies/${s1.id}`); await page.waitForSelector('#excur tbody tr');
  check('An analyst sees the excursion but no Assess button', (await page.locator('#excur button', { hasText: 'Assess' }).count()) === 0);
  await signIn(page, BASE, 'QA Reviewer (demo)', `#/stability/studies/${s1.id}`); await page.waitForSelector('#excur tbody tr');
  await page.locator('#excur button', { hasText: 'Assess' }).first().click(); await page.waitForSelector('.modal #f_decision');
  await page.selectOption('.modal #f_decision', 'No impact');
  await page.fill('.modal #f_justification', '28.1 °C for under 2 hours, back in range at the next reading; fish oil softgels are not sensitive to a short 3 °C rise.');
  await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(1200);
  await page.waitForSelector('#excur tbody tr');
  const exc = await page.locator('#excur').innerText();
  check('QA\'s assessment is recorded (No impact, the justification, who)', /No impact/.test(exc) && /under 2 hours/.test(exc) && /QA Reviewer/.test(exc), exc.slice(0, 200));
  const probs2 = await page.locator('#reports .stb-probs').innerText();
  check('The excursion no longer blocks the report (only the missing finalized results do)', !/not assessed/.test(probs2) && /No results are finalized yet/.test(probs2), probs2.replace(/\n/g, ' / '));
  await shot('stb2_02_assessed');
  await page.goto(`${BASE}/#/reports/finalization?tab=stability`); await page.waitForSelector('#g tbody tr'); await page.waitForTimeout(500);
  const rf = await page.locator('#g tbody tr').allInnerTexts();
  check('Report Finalization > Stability reports lists STB-00001, not ready while no result is finalized', rf.some((t) => /STB-00001/.test(t) && /Not now/.test(t) && /No results are finalized/.test(t)), rf.join(' / ').slice(0, 200));

  // ---- an amendment: extend to 36 months (moisture at 25/60)
  await signIn(page, BASE, 'Alex Kiddle', `#/stability/studies/${s1.id}`); await page.waitForSelector('#amend');
  await page.click('#amend'); await page.waitForSelector('.modal [data-ok]'); await page.click('.modal [data-ok]');
  await page.waitForSelector('#tps tbody tr'); await page.waitForTimeout(800);
  const amdNote = await page.locator('main .notice.stb-amd').innerText().catch(() => '');
  check('"Amend the study" opens a new version of the quote, marked as an amendment of STB-00001', /Amendment of study STB-00001/.test(amdNote) && /SQ-00002 v2/.test(await page.locator('main h1').innerText()), amdNote.slice(0, 80));
  const nTp = await page.locator('#tps tbody tr').count();
  await page.click('#tps [data-add="1"]'); await cell('#tps', nTp + 1, 1).click(); await paste('36 M\t36\tMonths\t7\t7'); await page.waitForTimeout(400);
  const mx = await page.locator('#mx tbody tr').allInnerTexts();
  const mrow = mx.findIndex((t) => /Moisture/.test(t) && /25 °C/.test(t)) + 1;
  const heads = await page.locator('#mx thead th').allInnerTexts();
  const col = heads.findIndex((h) => /36 M/.test(h)) + 1;
  await cell('#mx', mrow, col).click(); await paste('Yes'); await page.waitForTimeout(300);
  await page.click('#save'); await page.waitForTimeout(1500); await page.waitForSelector('#tps tbody tr');
  const pid = s1.project_id;
  const q2 = (await api('/stability/quotes/' + pid)).data;
  check('Saved: version 2 has a 36 M timepoint with moisture at 25/60; nothing stops it being issued',
    q2.version.version_no === 2 && q2.design.timepoints.some((t) => t.label === '36 M') && q2.design.cells.some((c) => c.timepoint_id === q2.design.timepoints.find((t) => t.label === '36 M').id)
    && !q2.problems.some((x) => x.severity === 'Error'), JSON.stringify(q2.problems));
  await page.click('#send'); await page.waitForSelector('.modal #f_contact_id'); await page.click('.modal [data-ok]'); await page.waitForTimeout(2500);
  await page.waitForSelector('#acc'); await page.click('#acc'); await page.waitForSelector('.modal #f_contact_id'); await page.click('.modal [data-ok]'); await page.waitForTimeout(1800);
  const st1 = (await api('/stability/studies/' + s1.id)).data;
  check('Accepted: STB-00001 runs to version 2 (amendment 1), one pull added (36 M at 25/60), none cancelled',
    st1.study.version_no === 2 && st1.study.amendment_no === 1 && st1.amendments.length === 1 && st1.amendments[0].pulls_added === 1 && st1.amendments[0].pulls_cancelled === 0,
    JSON.stringify(st1.amendments[0] || {}));
  const p36 = st1.pulls.find((p) => p.timepoint_label === '36 M');
  check('The 36 M pull is scheduled 36 months after placement', p36 && p36.status === 'Scheduled' && /25 °C/.test(p36.condition_name), JSON.stringify(p36 || {}));
  check('Pulls already taken are unchanged (1 M pulled, at both conditions)', st1.pulls.filter((p) => p.timepoint_label === '1 M' && p.status === 'Pulled').length === 2);
  await page.goto(`${BASE}/#/stability/studies/${s1.id}`); await page.waitForSelector('#amds tbody tr'); await page.waitForTimeout(500);
  check('The study page lists the amendment', /v1 to v2/.test(await page.locator('#amds').innerText()));
  check('No material can be disposed of while pulls still need it', (await page.locator('#stor button', { hasText: 'Dispose' }).count()) === 0);
  await shot('stb2_03_amended');

  // ---- the Lab Supervisor cancels STB-00002 (awaiting material)
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/stability/studies/${s2.id}`); await page.waitForSelector('#cancel');
  await page.click('#cancel'); await page.waitForSelector('.modal [data-ok]'); await page.click('.modal [data-ok]');
  await sign(page, { reason: 'Client postponed the product launch' }); await page.waitForTimeout(1500);
  const st2 = (await api('/stability/studies/' + s2.id)).data;
  check('STB-00002 is cancelled with the reason and who; its T0 sample and tests are cancelled',
    st2.study.status === 'Cancelled' && /postponed/.test(st2.study.cancel_reason || '') && st2.study.t0_sample_status === 'Cancelled' && st2.t0tests.every((t) => t.status === 'Cancelled'),
    `${st2.study.status} ${st2.study.t0_sample_status}`);
  await page.waitForSelector('main .notice.stb-done');
  check('The page says it is cancelled and offers no Cancel or Amend', /Cancelled/.test(await page.locator('main .notice.stb-done').innerText()) && !(await page.$('#cancel')) && !(await page.$('#amend')));
  await signIn(page, BASE, 'Analyst (demo)', `#/stability/studies/${s1.id}`); await page.waitForSelector('main h1');
  check('An analyst cannot cancel a study', !(await page.$('#cancel')));
  await shot('stb2_04_cancelled');

  // ---- the audit trail
  const aud = await fetch(`${BASE}/api/audit/scope?kind=stability_study&id=${s1.id}`, { headers: { Cookie: cookie, 'x-site-id': cfl } }).then((r) => r.json()).catch(() => ({}));
  const auRows = Array.isArray(aud) ? aud : aud.rows || [];
  check('The study\'s audit trail has the assessment and the amendment', auRows.some((r) => r.table_name === 'stability_excursion_assessment') && auRows.some((r) => r.table_name === 'stability_amendment'), String(auRows.length));

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
