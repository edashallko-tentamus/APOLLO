// Standalone quotes (migration 029) end to end in the browser, as the demo Account Manager:
//  - My open quotes (only theirs, only open) and All quotes with the status, type and lab filters;
//  - a new quote for Beta Foods built while "on the phone": tests added from the CFL and TPS tabs and from All labs
//    (each line shows its lab, starting at the list price), one discount typed, then "Send to client…": the quote is
//    issued, the email with the PDF and the link is in the Outbox;
//  - the client accepts through the link (no sign-in); the list shows it accepted online; its tests become orderable;
//  - a Draft cannot be issued without final prices; fill down, issue, then Reject… from the list with a reason;
//  - Accept… from the list; handing a quote to another sales person; Projects lists only projects; the audit icon.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, call, login } = require('./auth');
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
  const toastText = async () => { await page.waitForSelector('.toast', { timeout: 20000 }); return page.locator('.toast').last().innerText(); };
  const rowsOf = async () => page.locator('#g tbody tr').allInnerTexts();
  const as = async (who) => {
    const cookie = await login(BASE, who, PASSWORD);
    const users = (await call(BASE, '/users', { cookie })).data;
    const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === 'CFL').id;
    return async (p, opts = {}) => { const res = await fetch(BASE + '/api' + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site },
      body: opts.body ? JSON.stringify(opts.body) : undefined }); return { ok: res.ok, data: await res.json().catch(() => ({})) }; };
  };
  const am = await as('acctmgr');

  // ---- the list
  await signIn(page, BASE, 'Account Manager (demo)', '#/quotes'); await page.waitForSelector('#g tbody tr');
  const nav = await page.locator('#nav').innerText();
  const mine = await rowsOf();
  check('Pricing > Quotes; "My open quotes" lists only my open quotes (Q-00001 quoted, Q-00002 draft)', /Quotes/.test(nav) && /Projects/.test(nav) && mine.length === 2
    && mine.some((t) => /Q-00001/.test(t)) && mine.some((t) => /Q-00002/.test(t)), mine.length + ' rows');
  check('Each row shows who prepared it, and Accept / Reject on the quoted one', mine.every((t) => /Account Manager \(demo\)/.test(t)) && /Accept…[\s\S]*Reject…/.test(mine.find((t) => /Q-00001/.test(t))));
  await shot('q_01_my_open');
  await page.click('#tall'); await page.waitForSelector(".pgtabs");
  await page.click('.pgtabs .tab[data-f="all"]'); await page.waitForTimeout(400);
  const all = await rowsOf();
  check('All quotes: quotes and projects together, with the Alex-prepared rejected one', all.some((t) => /Q-00004/.test(t) && /Alex Kiddle/.test(t) && /Rejected/.test(t)) && all.some((t) => /PRJ-/.test(t)));
  await page.click('.pgtabs .tab[data-f="Accepted"]'); await page.selectOption('#ty', 'Quote'); await page.waitForTimeout(500);
  const acc = await rowsOf();
  check('Filters: Accepted + Quotes only gives Q-00003 (accepted by Priya Shah)', acc.length === 1 && /Q-00003/.test(acc[0]) && /Priya Shah/.test(acc[0]), acc.join(' / '));
  await page.click('.pgtabs .tab[data-f="all"]'); await page.selectOption('#ty', 'all');
  const tps = (await am('/quotes')).data.labs.find((l) => l.site_code === 'TPS');
  await page.selectOption('#lab', tps.id); await page.waitForTimeout(500);
  const tr = await rowsOf();
  check('Lab filter TPS: the quotes with TPS tests (Q-00001, Q-00003)', tr.length === 2 && tr.every((t) => /TPS/.test(t)), tr.length + '');
  await shot('q_02_all_filtered');
  await page.selectOption('#lab', '');

  // ---- a new quote on the phone: CFL and TPS tests on one quote
  await page.click('#new'); await page.waitForSelector('.modal #f_client_id');
  await page.selectOption('.modal #f_client_id', { label: 'Beta Foods LLC' });
  await page.fill('.modal #f_project_name', 'Hot sauce, new line launch'); await page.click('.modal [data-ok]');
  await page.waitForSelector('.modal #f_quote_contact_id'); await page.selectOption('.modal #f_quote_contact_id', { label: 'Jordan Reyes <jordan.reyes@example-beta.com>' });
  await page.click('.modal [data-ok]');
  await page.waitForSelector('#qpick .tabs', { timeout: 15000 });
  const head = await page.locator('main h1').innerText();
  const vid = (await page.evaluate(() => location.hash)).split('/')[2];
  check('The new quote opens as a Draft (Q-00005) with lab tabs to add tests', /Quote Q-00005/.test(head) && /Draft/.test(await page.locator('main .sub').innerText())
    && /CFL[\s\S]*TPS[\s\S]*All labs/.test(await page.locator('#qpick .tabs').innerText()), head);
  const addFrom = async (labText, testName) => {
    await page.locator('#qpick .tabs button', { hasText: labText }).click(); await page.waitForTimeout(300);
    await page.locator('#qcat tbody tr', { hasText: testName }).locator('button', { hasText: '+ Add' }).click();
    await page.waitForFunction((n) => [...document.querySelectorAll('#lg tbody tr')].some((r) => r.innerText.includes(n)), testName, { timeout: 15000 });
    await page.waitForSelector('#qpick .tabs');
  };
  await addFrom('TPS', 'Dissolution, USP <711> (TPS)');
  await addFrom('CFL', 'Heavy Metals (Pb, Cd, As, Hg) by ICP-MS');
  await page.locator('#qpick .tabs button', { hasText: 'All labs' }).click(); await page.fill('#qfind', 'salmon'); await page.waitForTimeout(300);
  check('Search within the lab tab narrows the catalogue', (await page.locator('#qcat tbody tr').count()) === 1);
  await page.locator('#qcat tbody tr', { hasText: 'Salmonella' }).locator('button', { hasText: '+ Add' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('#lg tbody tr')].some((r) => r.innerText.includes('Salmonella')), null, { timeout: 15000 });
  const lines = await page.locator('#lg tbody tr').allInnerTexts();
  // 0.16.1: no "Any lab" (Salmonella's home lab is CFL); the TPS test on a CFL quote is subcontracted (the 20-30 rule: $650 to $676)
  check('Three lines, each showing its lab; the TPS test is subcontracted at $676 ($650 less 20 %, plus 30 %)', lines.length === 3 && lines.some((t) => /Dissolution[\s\S]*TPS \(subcontracted\)[\s\S]*\$676\.00[\s\S]*\$520\.00/.test(t))
    && lines.some((t) => /Heavy Metals \(Pb[\s\S]*CFL/.test(t)) && lines.some((t) => /Salmonella[\s\S]*CFL/.test(t)) && !lines.some((t) => /Any lab/.test(t)) && /\$\d/.test(await page.locator('#tot .big').innerText()), lines.join(' | '));
  // a discount on the dissolution line: final price 608.40 (10 % off $676)
  const di = (await page.locator('#lg tbody tr td:nth-child(2)').allInnerTexts()).findIndex((t) => t.includes('Dissolution')) + 1;
  await page.locator(`#lg tbody tr:nth-child(${di}) td:nth-child(7)`).click(); await page.keyboard.type('608.40'); await page.keyboard.press('Enter');
  await page.click('#lsave'); await page.waitForTimeout(800);
  check('A discount typed on one line (10% on dissolution) is saved', /10\.00%/.test(await page.locator(`#lg tbody tr:nth-child(${di})`).innerText()));
  await shot('q_03_new_quote_lines');

  // ---- send it while on the phone
  await page.click('#send'); await page.waitForSelector('.modal #f_contact_id');
  await page.fill('.modal #f_message', 'As discussed on the phone, here are the tests for the three new sauces.');
  await page.click('.modal [data-ok]');
  await page.waitForSelector('.qsent', { timeout: 60000 });
  const banner = await page.locator('.qsent').innerText();
  const link = await page.locator('#qlink').inputValue();
  check('"Send to client…" issues the quote and sends it: the page says to whom, with the client link', /Quoted/.test(await page.locator('main .sub').innerText()) && /Jordan Reyes/.test(banner) && /quote-response\.html\?t=/.test(link));
  await shot('q_04_sent');
  await page.goto(`${BASE}/#/outbox`); await page.waitForSelector('#g tbody tr');
  // click the link itself: a short subject does not reach the middle of the cell on every screen (laptop, 2026-10-14)
  await page.locator('#g tbody tr td a:has-text("Quotation Q-00005")').first().click(); await page.waitForSelector('.modal .email');
  const em = await page.locator('.modal .email').innerText();
  const att = await page.locator('.modal .email a:has-text("quotation (PDF)")').getAttribute('href');
  const pdfHead = await page.evaluate(async (u) => { const r = await fetch(u); const t = new Uint8Array(await r.arrayBuffer()); return String.fromCharCode(...t.slice(0, 5)); }, att);
  check('The Outbox has the quotation email: the message, total, valid date, the accept link and the PDF attached', /As discussed on the phone/.test(em) && /Quote total: \$/.test(em)
    && /Valid until: /.test(em) && /quote-response\.html\?t=/.test(em) && pdfHead === '%PDF-', pdfHead);
  check('The Outbox links the email to its quote', /Q-00005/.test(await page.locator('#g').innerText()));
  await page.click('.modal [data-ok]');

  // ---- the client accepts through the link
  const cctx = await b.newContext(); const cp = await cctx.newPage();
  await cp.goto(link.replace(/^https?:\/\/[^/]+/, BASE)); await cp.waitForSelector('#yes');
  const ct = await cp.locator('main').innerText();
  check('The client\'s page (no sign-in): the quotation with a Laboratory column and the total', /Quotation Q-00005/.test(ct) && /Laboratory/.test(ct) && /Tentamus Pharmaceutical Services/.test(ct) && /Total \$/.test(ct));
  await cp.click('#yes');
  check('Accepting needs a name', /Type your name/.test(await cp.locator('#msg').innerText()));
  await cp.fill('#nm', 'Jordan Reyes'); await cp.fill('#nt', 'PO 2210'); await cp.click('#yes'); await cp.waitForSelector('.ok');
  check('The client accepts online', /is accepted/.test(await cp.locator('main').innerText()));
  await cp.screenshot({ path: path.join(OUT, 'q_05_client_accepted.png'), fullPage: true });
  await cctx.close();
  await page.goto(`${BASE}/#/quotes?tab=all`); await page.waitForSelector(".pgtabs"); await page.click('.pgtabs .tab[data-f="Accepted"]'); await page.waitForTimeout(400);
  const accd = (await rowsOf()).find((t) => /Q-00005/.test(t)) || '';
  check('The list shows Q-00005 accepted by Jordan Reyes (online)', /Accepted/.test(accd) && /Jordan Reyes \(online\)/.test(accd), accd);
  const beta = (await am('/clients')).data.find((c) => c.legal_name === 'Beta Foods LLC');
  const orderable = (await am('/clients/' + beta.id)).data.orderable;
  check('Its tests can now be ordered by the client (quoted-only ordering)', orderable.some((o) => o.project_code === 'Q-00005' && /Salmonella/.test(o.test_name)), orderable.map((o) => o.project_code).join(','));

  // ---- Q-00002: no final prices, fill down, issue, then reject from the list
  const q2 = (await am('/quotes')).data.rows.find((r) => r.project_code === 'Q-00002');
  await page.goto(`${BASE}/#/quote/${q2.version_id}`); await page.waitForSelector('#lg tbody tr');
  await page.click('[data-act="Quoted"]'); await page.waitForSelector('.modal'); await page.click('.modal [data-ok]');
  const noPrice = await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Final Price/.test(t.textContent)), null, { timeout: 15000 }).then(() => true).catch(() => false);
  check('A quote cannot be issued without final prices', noPrice);
  await page.locator('#lg tbody tr:nth-child(1) td:nth-child(7)').click(); await page.keyboard.type('55'); await page.keyboard.press('Enter');
  await page.locator('#lg tbody tr:nth-child(1) td:nth-child(7)').click(); await page.locator('#lg tbody tr:nth-child(4) td:nth-child(7)').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+d'); await page.click('#lsave'); await page.waitForTimeout(800);
  await page.click('[data-act="Quoted"]'); await page.waitForSelector('.modal'); await page.click('.modal [data-ok]'); await page.waitForTimeout(800);
  check('Final price filled down (Ctrl+D), then issued without sending', /Quoted/.test(await page.locator('main .sub').innerText()));
  await page.goto(`${BASE}/#/quotes?tab=mine`); await page.waitForSelector('#g tbody tr');
  await page.locator('#g tbody tr', { hasText: 'Q-00002' }).locator('button', { hasText: 'Reject…' }).click(); await page.waitForSelector('.modal #f_note');
  await page.click('.modal [data-ok]');
  check('Rejecting asks why', /Why is required/.test(await page.locator('.modal .merr').innerText()));
  await page.fill('.modal #f_note', 'Turnaround: client needs results in 3 days'); await page.click('.modal [data-ok]'); await page.waitForTimeout(800);
  const left = await rowsOf();
  check('Rejected from the list: it leaves "My open quotes"', !left.some((t) => /Q-00002/.test(t)) && left.some((t) => /Q-00001/.test(t)));

  // ---- Q-00001: accept from the list
  await page.locator('#g tbody tr', { hasText: 'Q-00001' }).locator('button', { hasText: 'Accept…' }).click(); await page.waitForSelector('.modal #f_contact_id');
  check('Accept… proposes the quote\'s contact', (await page.$eval('.modal #f_contact_id', (e) => e.options[e.selectedIndex].text)) === 'Sam Nguyen');
  await page.fill('.modal #f_note', 'PO 7781 by email'); await page.click('.modal [data-ok]'); await page.waitForTimeout(800);
  const q1 = (await am('/quotes')).data.rows.find((r) => r.project_code === 'Q-00001');
  check('Accepted from the list, by the lab (not online)', q1.status === 'Accepted' && q1.accepted_by_name === 'Sam Nguyen' && q1.decided_via === 'Lab');
  await shot('q_06_after_decisions');

  // ---- hand a quote to another sales person
  await page.goto(`${BASE}/#/quote/${(await am('/quotes')).data.rows.find((r) => r.project_code === 'Q-00005').version_id}`); await page.waitForSelector('#qedit');
  await page.click('#qedit'); await page.waitForSelector('.modal #f_owner_id'); await page.selectOption('.modal #f_owner_id', { label: 'Alex Kiddle' });
  await page.click('.modal [data-ok]'); await page.waitForTimeout(800);
  check('"Details…" hands the quote to another sales person (Prepared by)', /Alex Kiddle/.test(await page.locator('.meta3').innerText()));
  await page.click('main .auditbtn'); await page.waitForTimeout(1500);
  check('The quote has an audit trail (the audit icon)', /Q-00005|quoted_test_configuration|Quote/i.test(await page.locator('body').innerText()));

  // ---- projects stay projects
  await page.goto(`${BASE}/#/projects`); await page.waitForSelector('#g tbody tr');
  const pr = await rowsOf();
  check('Projects lists only projects', pr.length > 0 && pr.every((t) => /PRJ-/.test(t)) && !pr.some((t) => /Q-0000/.test(t)));

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
