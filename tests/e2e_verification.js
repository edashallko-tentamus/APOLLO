// WD-6 (migration 024): workflow verification, end to end in the browser. The analyst (a designer) starts version 2 of
// "Vitamin C stability (demo)" and writes its verification protocol from the version's Review tab (signed "Prepared
// by"); QA approves the protocol (signed); the analyst executes it (signed "Executed by"): automated samples run through
// every step, done by the automated accounts; every check passes. The Lab Supervisor cannot approve the version before
// QA signs the report; after QA signs it, the version is approved. The verification batch says what it is and stays
// out of the lab's batch and order lists; the automated accounts cannot sign in and are not among the people.
// WD-6.1 (migration 025): right after the run the server captures screenshots of every page the checks point to
// (signed "Evidence captured by"), shows them in the report with their SHA-256, and the report downloads as Word.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, call, login } = require('./auth');
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
  const session = async (who) => {
    const cookie = await login(BASE, who, PASSWORD);
    const users = (await call(BASE, '/users', { cookie })).data;
    const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
    return async (p, opts = {}) => {
      const res = await fetch(BASE + '/api' + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site }, body: opts.body ? JSON.stringify(opts.body) : undefined });
      return { ok: res.ok, data: await res.json().catch(() => ({})) };
    };
  };
  const status = async () => (await page.locator('main .sub .badge').first().innerText()).trim();

  // ---- the analyst starts version 2 and writes its protocol from the Review tab
  const ana = await session('analyst');
  const tests = (await ana('/methods/tests')).data;
  const vc = (tests.rows || tests).find((t) => t.test_name === 'Vitamin C stability (demo)');
  const nv = await ana(`/methods/tests/${vc.id}/new-version`, { method: 'POST', body: { signature: { username: 'analyst', password: PASSWORD }, reason: 'Verification test' } });
  check('The analyst starts version 2 of the stability test (a draft)', nv.ok && nv.data.id, nv.data.error || '');
  const vid = nv.data.id;
  await signIn(page, BASE, 'Analyst (demo)', `#/methods/versions/${vid}?tab=review`); await page.waitForSelector('#verif #vnew', { timeout: 15000 });
  const card = await page.locator('#verif').innerText();
  check('The Review tab says CFL requires a passing workflow verification, and offers to write the protocol', /CFL requires a passing workflow verification/.test(card));
  await shot('wd6_01_review_tab');
  await page.click('#vnew'); await sign(page); await page.waitForURL(/#\/verification\//, { timeout: 20000 }); await page.waitForSelector('.vdoc'); await page.waitForTimeout(600);
  const vurl = page.url(); const wid = vurl.split('#/verification/')[1];
  const doc1 = await page.locator('.vdoc').innerText();
  check('The protocol is written (Prepared by the analyst): URS and FRS, the samples S1 typical, S2 below the LOQ, S3 outside the specification, and the checks with expected results',
    await status() === 'Protocol draft' && /Prepared by\s*Analyst \(demo\)/i.test(doc1) && /URS-01/.test(doc1) && /FRS-01/.test(doc1)
    && /Below the LOQ/.test(doc1) && /Outside the specification/.test(doc1) && /S3 Vitamin C: final result 750, Does not conform/.test(doc1) && /S2 Vitamin C: final result < 1, Conforms/.test(doc1));
  check('The analyst cannot approve the protocol (QA does), and it cannot be executed yet', !(await page.$('#vapprove')) && !(await page.$('#vexec')));
  await shot('wd6_02_protocol_draft');

  // ---- QA approves the protocol
  await signIn(page, BASE, 'QA Reviewer (demo)', `#/verification/${wid}`); await page.waitForSelector('#vapprove');
  await page.click('#vapprove'); await sign(page); await page.waitForTimeout(1000); await page.waitForSelector('.vdoc');
  check('QA approved the protocol (signed)', await status() === 'Protocol approved' && /Protocol approved by \(QA\)\s*QA Reviewer \(demo\)/i.test(await page.locator('.vsig').innerText()));

  // ---- the analyst executes it
  await signIn(page, BASE, 'Analyst (demo)', `#/verification/${wid}`); await page.waitForSelector('#vexec');
  await page.click('#vexec'); await sign(page); await page.waitForSelector('.vev figure', { timeout: 180000 }); await page.waitForTimeout(800);
  const doc2 = await page.locator('.vdoc').innerText();
  const results2 = await page.$$eval('table.vt td.r-Pass, table.vt td.r-Fail, table.vt td.r-Not', (els) => els.map((e) => e.textContent.trim()));
  check('Executed (signed "Executed by"): every check passed and the outcome is Pass',
    await status() === 'Executed' && /Executed by\s*Analyst \(demo\)/i.test(doc2) && /\bPass\b/.test(await page.locator('.vhead').innerText())
    && !results2.some((x) => /^(Fail|Not tested)/.test(x)) && results2.length > 30, `${results2.filter((x) => !/^Pass/.test(x)).length} not passed of ${results2.length}`);
  check('The run log shows the automated analyst and reviewer at work', /Verification analyst[\s\S]*Made batch BAT-[\s\S]*Verification reviewer[\s\S]*Approved BAT-/.test(doc2));
  check('The report lists its verification order and batch, and shows the expected and actual result of each check side by side',
    /Verification order\s*LO-\d+ \(Approved\)/.test(doc2) && /Batches\s*BAT-\d+ \(Approved\)/.test(doc2) && /750, Does not conform \(unrounded 750/.test(doc2));
  await shot('wd6_03_executed');

  // ---- WD-6.1: the screenshots of the run's pages are captured right after the run (signed "Evidence captured by")
  const figs = await page.$$eval('.vev figure', (els) => els.map((f) => f.innerText));
  const evSig = await page.locator('.vsig').innerText();
  check('The evidence is captured after the run (signed "Evidence captured by"): screenshots of the order, every step, the results and QC, and each sample, each with its SHA-256',
    /Evidence captured by\s*Analyst \(demo\)/i.test(evSig) && figs.length >= 8 && figs.some((t) => /^E-01 Order LO-/.test(t)) && figs.some((t) => /Results and QC/.test(t))
    && figs.some((t) => /Sample .*approved results/.test(t)) && figs.every((t) => /[0-9a-f]{64}/.test(t)), `${figs.length} screenshots`);
  check('Each check points to its evidence (E-nn)', (await page.$$('table.vt a.vevlink')).length > 20);
  for (const f of await page.$$('.vev img')) await f.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const imgs = await page.$$eval('.vev img', (els) => els.map((i) => ({ ok: i.complete && i.naturalWidth === 1440, h: i.naturalHeight })));
  check('The screenshots load (full-page images, 1440 px wide)', imgs.length && imgs.every((i) => i.ok), JSON.stringify(imgs.slice(0, 2)));
  const wv = (await ana(`/verification/${wid}`)).data;
  const pg = await page.evaluate(async (u) => { const r = await fetch(u); const b = new Uint8Array(await r.arrayBuffer()); return { type: r.headers.get('content-type'), sig: Array.from(b.slice(1, 4)).map((x) => String.fromCharCode(x)).join(''),
    hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b))).map((x) => x.toString(16).padStart(2, '0')).join('') }; }, await page.getAttribute('.vev img', 'src'));
  check('A screenshot is the stored PNG, unchanged (its SHA-256 matches the record)', pg.type === 'image/png' && pg.sig === 'PNG' && pg.hash === wv.evidence[0].sha256);
  const stamp = wv.evidence.find((e) => /Results and QC/.test(e.title));
  const ordEv = wv.evidence.find((e) => /^Order /.test(e.title)); const smpEv = wv.evidence.filter((e) => /^Sample /.test(e.title));
  check('Every check has its screenshot: the audit trail check on Results and QC, the order status on the order, each final result on its sample',
    wv.checks.every((c) => wv.evidence.some((e) => e.check_codes.includes(c.check_code))) && stamp && stamp.check_codes.length >= 1
    && ordEv && ordEv.check_codes.length >= 1 && smpEv.length === 3 && smpEv.every((e) => e.check_codes.length >= 1),
    wv.checks.filter((c) => !wv.evidence.some((e) => e.check_codes.includes(c.check_code))).map((c) => c.check_code).join(',') + ` ${wv.evidence.length} screenshots`);
  const dl = page.waitForEvent('download'); await page.click('#vdocx'); const file = await dl;
  const docx = fs.readFileSync(await file.path());
  const names = []; for (let i = 0; i + 30 < docx.length; i++) { if (docx.readUInt32LE(i) === 0x02014b50) { const n = docx.readUInt16LE(i + 28); names.push(docx.slice(i + 46, i + 46 + n).toString()); } }
  check('The Word document downloads: the protocol and report with the screenshots in an appendix',
    /^VER-\d+ .*\.docx$/.test(file.suggestedFilename()) && docx.slice(0, 2).toString() === 'PK' && names.includes('word/document.xml')
    && names.filter((n) => /^word\/media\/.*\.png$/.test(n)).length === wv.evidence.length, `${file.suggestedFilename()}, ${names.length} parts`);
  fs.writeFileSync(path.join(OUT, 'wd6_report.docx'), docx);

  // ---- before QA's report, the version cannot be approved
  const sup = await session('labsup');
  const ap1 = await sup(`/methods/versions/${vid}/approve`, { method: 'POST', body: { signature: { username: 'labsup', password: PASSWORD } } });
  check('Before QA signs the report, the Lab Supervisor cannot approve the version', !ap1.ok && /needs a passing workflow verification/.test(ap1.data.error || ''), ap1.data.error || '');

  // ---- QA signs the report
  await signIn(page, BASE, 'QA Reviewer (demo)', `#/verification/${wid}`); await page.waitForSelector('#vsign');
  check('QA can sign the report now that the evidence is captured', !!(await page.$('#vsign')) && !(await page.$('#vcapture')));
  await page.click('#vsign'); await page.waitForSelector('.modal #f_conclusion'); await page.click('.modal [data-ok]'); await sign(page); await page.waitForTimeout(1000); await page.waitForSelector('.vdoc');
  const doc3 = await page.locator('.vdoc').innerText();
  check('QA signed the report (signed "Approved by"): Report signed, Pass, with its conclusion', await status() === 'Report signed'
    && /Report approved by \(QA\)\s*QA Reviewer \(demo\)/i.test(await page.locator('.vsig').innerText()) && /Pass\.\s*Every requirement passed/.test(doc3));
  await shot('wd6_04_report_signed');

  // ---- now the version can be approved, from its Review tab
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/methods/versions/${vid}?tab=review`); await page.waitForSelector('#verif table'); await page.waitForSelector('#approve');
  check('The Review tab lists the signed, passing verification', /A signed, passing verification covers the current design/.test(await page.locator('#verif').innerText()));
  await page.click('#approve'); await sign(page); await page.waitForTimeout(1200);
  check('The version is approved (Effective)', /Effective/.test(await page.locator('main').innerText()));

  // ---- the verification batch and order stay out of the lab's lists
  const wd = (await ana(`/verification/${wid}`)).data;
  const vb = wd.batches[0];
  await page.goto(`${BASE}/#/testing/batches/${vb.id}`); await page.waitForSelector('main h1'); await page.waitForTimeout(800);
  check('The verification batch says what it is (automated, not lab work)', /Workflow verification batch of VER-\d+/.test(await page.locator('main').innerText()) && !(await page.$('#cancelb')));
  await shot('wd6_05_batch');
  const lists = (await sup('/testing/batches?show=all')).data; const ords = (await sup('/orders')).data;
  check('It is not in the lab\'s batch list, and its order is not in the lab orders', !lists.rows.some((x) => x.id === vb.id) && !(ords.rows || ords).some((o) => o.order_code === wd.order.order_code));
  const bot = await call(BASE, '/auth/login', { method: 'POST', body: { username: 'verify.analyst', password: 'anything-1234' } });
  check('An automated account cannot sign in', !bot.ok && /automated verification account/.test(bot.data.error || ''), bot.data.error || '');
  const adm = await session('akiddle');
  const people = (await adm('/admin/users')).data;
  check('The automated accounts are not among the people (they are never in groups)', !people.users.some((u) => /^verify\./.test(u.username)));
  await signIn(page, BASE, 'Alex Kiddle', '#/admin/sites'); await page.waitForSelector('#sg table'); await page.waitForTimeout(500);
  check('The lab setting "Verify workflows" is on for CFL and TPS', /Verify workflows/.test(await page.locator('#sg').innerText()));

  check('No page errors and no native browser dialogs', errors.length === 0 && native === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.stack || e.message); process.exit(1); });
