// R-1 (migration 026): Result Finalization and the COA, end to end in the browser. The demo order PO-45231 (three lots of
// Vitamin C tablets, a client specification, a submission form attached) waits in Result Finalization. The demo
// Project Manager reviews two COAs as a group: the PDF, the sample's history and attachments beside it, the release
// check; adds a canned note; a sample edited after logging raises a warning that needs a reason; one signature issues
// both. The sample page lists the version with its fingerprint; the PDF downloads; the public verification page
// confirms it unchanged. A GMP sample is refused to the Project Manager and finalized by QA, and the order is
// Reported. The Outbox has the COA emails (the PDF attached) and the templates, which QA edits.
const path = require('path'); const fs = require('fs'); const crypto = require('crypto');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, call, login } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-3]/.test(m.text())) errors.push(m.text()); });
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
  const toastText = async () => { await page.waitForSelector('.toast', { timeout: 15000 }); return page.locator('.toast').last().innerText(); };
  const toastLike = async (re) => { // the newest message matching re (older messages may still be showing)
    let all = [];
    for (let i = 0; i < 60; i++) { all = await page.locator('.toast').allInnerTexts(); const hit = all.filter((x) => re.test(x)).pop(); if (hit) return hit; await page.waitForTimeout(250); }
    return all.join(' / ');
  };

  // ---- the order: compliance category on the samples grid, the submission form attached
  const sup = await session('labsup');
  const orders = (await sup('/orders')).data; const ord = (orders.rows || orders).find((o) => o.po_number === 'PO-45231');
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/orders/${ord.id}`); await page.waitForSelector('#sg tbody tr');
  const otext = await page.locator('main').innerText();
  check('The order lists each sample\'s compliance category and the submission form', /Category/.test(otext) && /Dietary supplement/.test(otext) && /Submission form \(scanned\)/.test(otext));
  // a sample edited after logging (the lot), so its COA raises a warning
  const od = (await sup(`/orders/${ord.id}`)).data;
  const s2 = od.samples.find((s) => s.client_sample_id === 'VC-2302'); const s3 = od.samples.find((s) => s.client_sample_id === 'VC-2303');
  const ed = await sup(`/orders/${ord.id}/samples`, { method: 'POST', body: { rows: [{ id: s2.id, lot: 'VC-2302B' }], reason: 'Lot corrected after the client called' } });
  check('(the Lab Supervisor corrects VC-2302\'s lot after logging)', ed.ok, ed.data.error || '');

  // ---- the queue: the Project Manager
  await signIn(page, BASE, 'projmgr', '#/reports/finalization'); await page.waitForSelector('#g tbody tr');
  const nav = await page.locator('nav, #nav, aside').first().innerText().catch(() => '');
  const q1 = await page.locator('#g tbody tr').allInnerTexts();
  check('Report Finalization is in the Testing menu, and the queue lists the three approved tests', /Report Finalization/.test(nav) && q1.filter((t) => /VC-230[123]/.test(t)).length === 3, `${q1.length} rows`);
  await shot('r1_01_queue');
  await page.locator('#g tbody tr td:text-is("VC-2301")').click(); await page.locator('#g tbody tr td:text-is("VC-2302")').click({ modifiers: ['Shift'] });
  await page.click('#go'); await page.waitForSelector('.fz', { timeout: 30000 });
  const h1 = await page.locator('main .sub').first().innerText();
  const rev1 = await page.locator('.fz').innerText();
  check('Review selected opens COA 1 of 2: the PDF beside the sample\'s submission details, notes, attachments and history',
    /COA 1 of 2/.test(await page.locator('main h1').innerText()) && /VC-2301/.test(h1) && (await page.$('iframe.pdf')) !== null
    && /Submission/.test(rev1) && /Dietary supplement/.test(rev1) && /Submission form \(scanned\)/.test(rev1) && /BAT-\d+/.test(rev1));
  const checks1 = await page.$$eval('#checks .chk', (els) => els.map((e) => e.className.replace('chk ', '') + ':' + e.querySelector('b').textContent));
  check('The release check: values read back from the PDF, specification, conformance worked out again, history, identity, completeness, holds, independence, dates: all pass',
    checks1.length >= 9 && checks1.every((x) => x.startsWith('Pass')) && checks1.some((x) => /Values on the PDF/.test(x)) && checks1.some((x) => /Conformance worked out again/.test(x)), checks1.join(' | '));
  const tok = await page.getAttribute('iframe.pdf', 'src');
  const pdfHead = await page.evaluate(async (u) => { const r = await fetch(u); const t = new Uint8Array(await r.arrayBuffer()); return r.headers.get('content-type') + ' ' + String.fromCharCode(...t.slice(0, 5)); }, tok);
  check('The COA under review is a PDF', /application\/pdf %PDF-/.test(pdfHead), pdfHead);
  await shot('r1_02_review');
  // a canned COA comment on the sample
  await page.selectOption('#nc', { label: 'Results relate only to the sample as received.' }); await page.click('#addnote');
  await page.waitForFunction(() => /Results relate only to the sample as received\./.test(document.querySelector('.fz')?.innerText || ''), null, { timeout: 30000 });
  check('A canned COA comment is added (from Canned reasons), and the COA is made again with it', /On the COA[\s\S]*Results relate only to the sample as received\./.test(await page.locator('.fz').innerText()));
  await page.click('#ready'); await page.waitForFunction(() => /COA 2 of 2/.test(document.querySelector('main h1')?.textContent || ''), null, { timeout: 30000 });
  await page.waitForSelector('#checks');
  const checks2 = await page.$$eval('#checks .chk', (els) => els.map((e) => e.className.replace('chk ', '') + ':' + e.querySelector('b').textContent + ':' + e.textContent));
  check('Mark ready moves on to COA 2: the lot edited after logging is a Warning, naming the change and who made it',
    checks2.some((x) => /^Warning:Sample details since logging/.test(x) && /VC-2302" to "VC-2302B" by Lab Supervisor/.test(x)), checks2.filter((x) => /^Warning/.test(x)).join(' | '));
  await page.click('#ready');
  check('A Warning needs a reason before the COA can be marked ready', /Give a reason/.test(await toastText()) && /COA 2 of 2/.test(await page.locator('main h1').innerText()));
  await page.fill('[data-ack="identity"]', 'Lot corrected from the client\'s submission form; confirmed by phone');
  await page.click('#ready'); await page.waitForTimeout(800);
  check('With the reason, both COAs are ready', /2 of 2 ready/.test(await page.locator('#readyn').innerText()) && /Sign and issue 2 COAs/.test(await page.locator('#sign').innerText()));
  await shot('r1_03_ready');
  await page.click('#sign'); await sign(page);
  const t1 = await toastText();
  check('One signature issues both COAs (a finalization group), placed in the Outbox', /FG-\d+: 2 COAs issued/.test(t1), t1);
  await page.waitForSelector('#g tbody tr'); await page.waitForTimeout(500);
  const q2 = await page.locator('#g tbody tr').allInnerTexts();
  const q2v = q2.filter((t) => /VC-230\d/.test(t)); // the R-2 demo lots (VC-240x, held by OOS) wait too
  check('Back on the queue, only VC-2303 of this order waits', q2v.length === 1 && /VC-2303/.test(q2v[0]), q2.join(' / '));

  // ---- 0.14.1 (migration 028): tabs, claiming, the archive, the order's COAs, the report ID
  const tabs = await page.locator('.rftabs').innerText();
  check('Four tabs: Report Finalization Queue, Finalization worklist, Batched Finalization, Issued COAs',
    /Report Finalization Queue/.test(tabs) && /Finalization worklist/.test(tabs) && /Batched Finalization/.test(tabs) && /Issued COAs/.test(tabs), tabs);
  check('The queue has an OOS column linking each held result to its investigation', await page.locator('#g thead').innerText().then((x) => /OOS/.test(x))
    && (await page.locator('#g tbody tr:has-text("VC-240") td.rfoos a').count()) >= 1);
  await page.locator('#g tbody tr td:text-is("VC-2303")').click(); await page.click('#claim');
  const tc = await toastLike(/FB-\d+/);
  await page.waitForFunction(() => /tab=mine/.test(location.hash)); await page.waitForSelector('#g tbody tr');
  check('Claim selected: VC-2303 moves to the Project Manager\'s worklist (FB-…)', /FB-\d+: 1 sample test claimed/.test(tc) && /VC-2303/.test(await page.locator('#g').innerText()), tc);
  await shot('r1_03b_worklist');
  const qa0 = await session('qa.reviewer');
  const rtc = (await qa0('/reports/queue')).data.rows.find((r) => r.sample_id === s3.id);
  check('Someone else sees it held by the Project Manager', rtc && rtc.claim_code && !rtc.mine && /Project Manager/.test(rtc.claimed_by_name));
  const pvq = (await qa0('/reports/preview', { method: 'POST', body: { sample_id: s3.id, tests: [rtc.requested_test_id] } })).data;
  const fq = await qa0('/reports/finalize', { method: 'POST', body: { signature: { username: 'qa.reviewer', password: PASSWORD }, items: [{ sample_id: s3.id, tests: [rtc.requested_test_id], acks: Object.fromEntries((pvq.checks || []).filter((k) => k.level === 'Warning').map((k) => [k.code, 'x'])) }] } });
  check('Nobody else can finalize a claimed test', !fq.ok && /claimed|holds|held/i.test(fq.data.error || ''), fq.data.error || '');
  await page.goto(`${BASE}/#/reports/finalization?tab=batches`); await page.waitForSelector('#g tbody tr');
  check('Batched Finalization lists the group in progress and who holds it', /FB-\d+[\s\S]*You[\s\S]*VC-2303|FB-\d+[\s\S]*You/.test(await page.locator('#g').innerText()));
  await page.locator('#g tbody tr button:has-text("Release all")').first().click();
  check('The holder releases it: back in the queue for anyone', /released/.test(await toastLike(/released/)) && !(await (await session('projmgr'))('/reports/queue')).data.rows.find((r) => r.sample_id === s3.id).claim_id);
  await page.goto(`${BASE}/#/reports/finalization?tab=issued`); await page.waitForSelector('#g tbody tr');
  check('Issued COAs: the archive lists the issued reports by report ID (sample ID + R1)', /CFL\d+-R1/.test(await page.locator('#g').innerText()));
  await page.goto(`${BASE}/#/orders/${ord.id}`); await page.waitForSelector('#ocg tbody tr', { timeout: 15000 });
  check('The lab order lists its samples\' COAs', (await page.locator('#ocg tbody tr').count()) >= 2 && /CFL\d+-R1/.test(await page.locator('#ocg').innerText()));
  await page.goto(`${BASE}/#/reports/finalization`); await page.waitForSelector('#g tbody tr');

  // ---- the sample page: the version, its fingerprint; the PDF; the public check
  const s1 = od.samples.find((s) => s.client_sample_id === 'VC-2301');
  await page.goto(`${BASE}/#/samples/${s1.id}`); await page.waitForSelector('#coag tbody tr', { timeout: 15000 });
  const card = await page.locator('#coacard').innerText();
  check('The sample page lists COA version 1 (final), who finalized it, the group, the verification code and the SHA-256; the note',
    /CFL\d+-R1 \(v1\)/.test(card) && /Yes/.test(card) && /Project Manager \(demo\)/.test(card) && /FG-\d+/.test(card) && /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(card)
    && /Results relate only to the sample as received\./.test(card));
  await shot('r1_04_sample');
  const pm = await session('projmgr');
  const cv = (await pm(`/reports/samples/${s1.id}/coa`)).data.versions[0];
  const pdf = await page.evaluate(async (u) => { const r = await fetch(u); const t = new Uint8Array(await r.arrayBuffer());
    return { type: r.headers.get('content-type'), hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', t))).map((x) => x.toString(16).padStart(2, '0')).join(''), b64: btoa(String.fromCharCode(...t)) }; },
  `/api/reports/coa/${cv.id}/pdf`);
  check('The issued PDF downloads unchanged (its SHA-256 is the recorded one)', pdf.type === 'application/pdf' && pdf.hash === cv.sha256);
  const pdfPath = path.join(OUT, 'r1_coa.pdf'); fs.writeFileSync(pdfPath, Buffer.from(pdf.b64, 'base64'));
  const anon = await b.newPage();
  await anon.goto(`${BASE}/verify.html?c=${cv.verify_code}`); await anon.waitForSelector('#out .res');
  const vtxt = await anon.locator('#out').innerText();
  await anon.setInputFiles('#file', pdfPath); await anon.waitForSelector('#fileres .res');
  const ftxt = await anon.locator('#fileres').innerText();
  const tampered = path.join(OUT, 'r1_coa_tampered.pdf'); const tb = fs.readFileSync(pdfPath); tb[tb.length - 20] ^= 1; fs.writeFileSync(tampered, tb);
  await anon.setInputFiles('#file', tampered); await anon.waitForFunction(() => /not this certificate/.test(document.querySelector('#fileres')?.textContent || ''));
  check('The public verification page (no sign-in) confirms the code, shows the fingerprint, and accepts the real PDF but not an altered one',
    /Issued by the laboratory, and the current version/.test(vtxt) && vtxt.includes(cv.sha256) && /unchanged/.test(ftxt));
  await anon.screenshot({ path: path.join(OUT, 'r1_05_verify.png'), fullPage: true }); await anon.close();

  // ---- a new version without a new result (e.g. a corrected detail), from the sample page
  await signIn(page, BASE, 'projmgr', `#/samples/${s1.id}`); await page.waitForSelector('#reissue', { timeout: 15000 });
  await page.click('#reissue'); await page.waitForSelector('#checks', { timeout: 30000 });
  check('"Issue a new version" opens the COA as version 2, superseding version 1', /version 2/.test(await page.locator('main .sub').first().innerText()));
  await page.click('#ready'); await page.waitForTimeout(400); await page.click('#sign'); await sign(page, { reason: 'Client address corrected' });
  const t3 = await toastText();
  const v2 = (await pm(`/reports/samples/${s1.id}/coa`)).data.versions;
  check('Signed with the reason: version 2 is issued, carrying version 1\'s fingerprint', /1 COA issued/.test(t3) && v2.length === 2 && v2[0].version_no === 2 && v2[0].prev_sha256 === v2[1].sha256, t3);
  const old = await (await fetch(`${BASE}/api/public/coa/${v2[1].verify_code}`)).json();
  check('The public check of version 1 now says a later version replaces it', old.found && old.superseded && old.latest_version === 2);

  // ---- GMP: the Project Manager cannot finalize it; QA can; then the order is Reported
  const ur = await sup(`/orders/${ord.id}/samples`, { method: 'POST', body: { rows: [{ id: s3.id, compliance_category: 'cGMP' }], reason: 'Category corrected from the submission form' } });
  const rt3 = (await pm('/reports/queue')).data.rows.find((r) => r.sample_id === s3.id);
  check('(VC-2303 is now cGMP: the queue says QA finalizes it)', ur.ok && rt3 && rt3.is_gmp);
  const pv = (await pm('/reports/preview', { method: 'POST', body: { sample_id: s3.id, tests: [rt3.requested_test_id] } })).data;
  const acks = Object.fromEntries(pv.checks.filter((k) => k.level === 'Warning').map((k) => [k.code, 'Category corrected from the submission form']));
  const f1 = await pm('/reports/finalize', { method: 'POST', body: { signature: { username: 'projmgr', password: PASSWORD }, items: [{ sample_id: s3.id, tests: [rt3.requested_test_id], acks }] } });
  check('A Project Manager cannot finalize GMP work', !f1.ok && /quality team/.test(f1.data.error || ''), f1.data.error || '');
  await signIn(page, BASE, 'QA Reviewer (demo)', '#/reports/finalization'); await page.waitForSelector('#g tbody tr');
  await page.locator('#g tbody tr td:text-is("VC-2303")').click(); await page.click('#go'); await page.waitForSelector('#checks', { timeout: 30000 });
  for (const t of await page.$$('[data-ack]')) await t.fill('Category corrected from the submission form');
  await page.click('#ready'); await page.waitForTimeout(500); await page.click('#sign'); await sign(page);
  const t2 = await toastText();
  const od2 = (await sup(`/orders/${ord.id}`)).data;
  check('QA finalizes it; every sample has its final COA, so the order is Reported', /1 COA issued/.test(t2) && od2.order.status === 'Reported', `${t2} / ${od2.order.status}`);

  // ---- the Outbox: the COA emails (PDF attached) and the templates
  await page.goto(`${BASE}/#/outbox`); await page.waitForSelector('#g tbody tr');
  const ob = await page.locator('#g').innerText();
  check('The Outbox holds the COA emails ("COA Issued")', (ob.match(/Certificate of Analysis CFL\d+-R\d/g) || []).length >= 3);
  await page.locator('#g tbody tr td:has-text("Certificate of Analysis CFL")').first().click(); await page.waitForSelector('.modal .email');
  const em = await page.locator('.modal .email').innerText();
  check('The email names the COA and version, and attaches the PDF; it gives the verification link and code',
    /Attachment:\s*the COA \(PDF\)/.test(em) && /verify\.html\?c=[A-Z0-9-]+/.test(em) && /verification code [A-Z0-9]{4}-/.test(em));
  await page.click('.modal [data-x]');
  await page.click('#tplTab'); await page.waitForSelector('#tg tbody tr');
  const tpl = await page.locator('#tg').innerText();
  check('Templates tab: every automatic email is a template (rush not accepted, COA issued, OOS result)', /Rush request not accepted/.test(tpl) && /Certificate of Analysis issued/.test(tpl) && /Out of specification result/.test(tpl));
  const tv0 = (await (await session('qa.reviewer'))('/outbox/templates')).data.rows.find((r) => r.template_code === 'COA Issued').record_version;
  await page.locator('#tg tbody tr:has-text("Certificate of Analysis issued") button:has-text("Wording")').click(); await page.waitForSelector('.modal #f_body');
  await page.fill('.modal #f_body', (await page.inputValue('.modal #f_body')) + '\n\nOur quality team is available at qa@example-lab.com.');
  await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(800);
  const tr = (await (await session('qa.reviewer'))('/outbox/templates')).data.rows.find((r) => r.template_code === 'COA Issued');
  check('QA edits a template\'s wording (with a reason); it is audited', /qa@example-lab\.com/.test(tr.body) && tr.record_version === tv0 + 1);
  await shot('r1_06_templates');

  // ---- an analyst cannot finalize
  const ana = await session('analyst');
  const qa1 = (await ana('/reports/queue')).data;
  check('An analyst sees no Result Finalization rights', qa1.can_finalize === false);

  check('No page errors and no native browser dialogs', errors.length === 0 && native === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exit(1); });
