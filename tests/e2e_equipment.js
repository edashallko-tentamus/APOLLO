// Phase 1, Equipment (migration 009): the register and its filters, automatic tag-outs, the due list, each lab's
// lists, new equipment with owners, tag-out / record the work / release by someone else, calibration with a
// certificate, maintenance schedules, Add many by paste and fill down, Excel export, transfer to another lab,
// and the audit trail. Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign } = require('./auth');
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
// A tiny valid PDF to stand in for a calibration certificate
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-3]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(500); };
  const head = async (host) => (await page.locator(`${host} thead th`).allInnerTexts()).map((t) => t.trim());
  const col = async (host, title) => (await head(host)).indexOf(title) + 1;
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const mainText = async () => page.locator('main').innerText();
  const fillModal = async (vals) => {
    for (const [k, v] of Object.entries(vals)) {
      const el = page.locator(`.modal #f_${k}`);
      const tag = await el.evaluate((x) => x.tagName);
      if (tag === 'SELECT') await el.selectOption({ label: v }); else await el.fill(v);
    }
  };
  const okModal = async () => { await page.locator('.modal [data-ok]').last().click(); await page.waitForTimeout(300); };
  const openEq = async (name) => { await go('#/equipment'); await page.locator('#g tbody tr', { hasText: name }).locator('a').first().click(); await page.waitForSelector('main .statcards'); await page.waitForTimeout(400); };

  // ---- The register: automatic tag-outs happened (expired pipette calibration, overdue ICP-MS cones)
  await signIn(page, BASE, 'Alex Kiddle', '#/equipment');
  await page.waitForSelector('#g tbody tr');
  check('Equipment is in the menu and the register lists the lab\'s equipment', (await page.locator('nav a[href="#/equipment"]').count()) === 1 && (await page.locator('#g tbody tr').count()) === 16); // 9, plus ICP-MS 2 and the microwave digester (WD-2 demo), a top-loading balance (WD-4 demo) and four stability chambers (seed_025)
  const tagged = await page.locator('a.tab', { hasText: 'Tagged out' }).innerText();
  check('Expired calibration and overdue maintenance were tagged out automatically', /Tagged out\s*2/.test(tagged), tagged);
  const pipRow = page.locator('#g tbody tr', { hasText: 'Pipette P10 #3' });
  check('The expired pipette shows red and Tagged out: Calibration', /Tagged out: Calibration/.test(await pipRow.innerText())
    && /cbad/.test(await pipRow.locator(`td:nth-child(${await col('#g', 'Calibration expires')})`).getAttribute('class')));
  check('The balance due within 30 days shows amber', /cwarn/.test(await page.locator('#g tbody tr', { hasText: 'Analytical balance 1' }).locator(`td:nth-child(${await col('#g', 'Calibration expires')})`).getAttribute('class')));
  await shot('70_equipment_list');

  // ---- Due and overdue
  await go('#/equipment/due'); await page.waitForSelector('#g tbody tr');
  const dueText = await page.locator('#g').innerText();
  check('Due list: the tagged-out ICP-MS and pipette, the balance due soon, HPLC maintenance due soon', /ICP-MS 1/.test(dueText) && /Pipette P10 #3/.test(dueText)
    && /Calibration due soon/.test(dueText) && /Preventive maintenance/.test(dueText));
  await shot('71_equipment_due');

  // ---- Each lab's lists: add a type (signed)
  await go('#/equipment/lists'); await page.waitForSelector('#tg tbody tr');
  const nt = await page.locator('#tg tbody tr').count();
  await page.click('#tg [data-add="1"]');
  await page.locator(`#tg tbody tr:nth-child(${nt + 1}) td:nth-child(1)`).click(); await page.keyboard.type('Viscometer'); await page.keyboard.press('Enter');
  await page.click('#tg .savebar [data-save]'); await sign(page); await page.waitForTimeout(800);
  check('A new equipment type is added to the lab\'s list with a signature', /Viscometer/.test(await page.locator('#tg').innerText()));

  // ---- New equipment with owners (signed)
  await go('#/equipment/new');
  await page.fill('#e_name', 'Viscometer 1'); await page.selectOption('#e_type', { label: 'Viscometer' });
  await page.selectOption('#e_dept', { label: 'CHEM Chemistry' }); await page.fill('#e_mfr', 'Brookfield'); await page.fill('#e_serial', 'BRK-77001');
  await page.check('#e_calreq'); await page.fill('#e_interval', '12');
  await page.click('#save');
  check('Saving without an owner is stopped with a clear message', /at least one group or person/.test(await page.locator('#ferr').innerText()));
  await page.getByRole('checkbox', { name: 'Lab Supervisor', exact: true }).check();
  await page.click('#save'); await sign(page); await page.waitForSelector('main .statcards'); await page.waitForTimeout(400);
  check('New equipment created: system ID, owner shown, calibration Deficient until calibrated', /EQ-\d{5}/.test(await page.locator('.eyebrow').innerText())
    && /Lab Supervisor/.test(await page.locator('.ownerchips').innerText()) && /Deficient: no calibration/.test(await mainText()));
  const viscUrl = page.url();

  // ---- Record a calibration with its certificate
  await page.click('[data-act="calib"]');
  await fillModal({ performed_by_vendor: 'Northbridge Scientific Supply', certificate_number: 'BRK-C-1001' });
  await page.setInputFiles('.modal #f_file', { name: 'BRK-C-1001.pdf', mimeType: 'application/pdf', buffer: PDF });
  await okModal(); await sign(page); await page.waitForTimeout(900);
  check('Calibration recorded: Conforms, expiry from the 12-month interval, certificate linked', /Conforms: expires/.test(await mainText())
    && /Certificate BRK-C-1001/.test(await page.locator('#cg').innerText()) && /BRK-C-1001\.pdf/.test(await page.locator('#dg').innerText()));
  const certHref = await page.locator('#dg a', { hasText: 'BRK-C-1001.pdf' }).getAttribute('href');
  const cert = await page.evaluate(async (u) => { const r = await fetch(u); return { s: r.status, t: r.headers.get('content-type') }; }, certHref);
  check('The certificate opens exactly as uploaded (PDF)', cert.s === 200 && /pdf/.test(cert.t), JSON.stringify(cert));

  // ---- Tag out for repair, record the repair; the same person cannot release it
  await page.click('[data-act="tagout"]');
  await fillModal({ reason_code: 'Repair', description: 'Spindle wobble at 60 rpm' });
  await okModal(); await sign(page); await page.waitForTimeout(800);
  check('Tagged out for repair: card shows, availability Tagged out', /tagged out for repair/i.test(await page.locator('.tagcard').innerText()) && /Tagged out: Repair/.test(await page.locator('.statcards').innerText()));
  await page.locator('.tagcard button', { hasText: 'Record repair' }).click();
  await fillModal({ summary: 'Spindle bearing replaced; verified with standard oil' });
  await okModal(); await sign(page); await page.waitForTimeout(800);
  check('Alex tagged it out and recorded the repair, so no release button for him', (await page.locator('.tagcard [data-in]').count()) === 0
    && /someone else must release/.test(await page.locator('.tagcard').innerText()));
  await shot('72_equipment_tagged');

  // ---- QA releases it
  await signIn(page, BASE, 'QA Reviewer (demo)'); await page.goto(viscUrl); await page.waitForSelector('.tagcard [data-in]');
  await page.click('.tagcard [data-in]'); await sign(page); await page.waitForTimeout(900);
  check('QA (who did not do the work) releases it: Available, logged as Released to service', (await page.locator('.tagcard').count()) === 0
    && /Available/.test(await page.locator('.statcards').innerText()) && /Released to service/.test(await page.locator('#lg').innerText()));
  check('QA sees no Tag out button (no equipment.tag), but can view everything', (await page.locator('[data-act="tagout"]').count()) === 0);

  // ---- Analyst: overdue ICP-MS cones (automatic maintenance tag): record the work and tag it back in
  await signIn(page, BASE, 'Analyst (demo)'); await openEq('ICP-MS 1');
  check('Analysts can change equipment (Edit shown)', (await page.locator('main a.btn', { hasText: 'Edit' }).count()) === 1);
  check('ICP-MS shows the automatic maintenance tag', /automatic: maintenance due/.test(await page.locator('.tagcard').innerText()));
  await page.locator('.tagcard [data-in]').click();
  await fillModal({ summary: 'Sampler and skimmer cones cleaned and inspected' });
  await okModal(); await sign(page); await page.waitForTimeout(900);
  check('After maintenance the analyst tags it back in: Available; next due date moved on a month', (await page.locator('.tagcard').count()) === 0
    && /Available/.test(await page.locator('.statcards').innerText()) && /Scheduled|Due soon/.test(await page.locator('.statcards').innerText()));
  await shot('73_equipment_maintenance');

  // ---- Lab Supervisor: Add many pipettes by paste and fill down
  await signIn(page, BASE, 'Lab Supervisor (demo)'); await go('#/equipment/add'); await page.waitForSelector('#g tbody tr');
  await page.locator('#g tbody tr:nth-child(1) td:nth-child(1)').click();
  await page.evaluate(() => {
    const txt = 'Pipette P20 #4\tPipette\tCHEM\tEppendorf\tResearch plus 2-20 µL\tPP-2004\nPipette P20 #5\tPipette\tCHEM\tEppendorf\tResearch plus 2-20 µL\tPP-2005\nPipette P20 #6\tPipette\tCHEM\tEppendorf\tResearch plus 2-20 µL\tPP-2006';
    const dt = new DataTransfer(); dt.setData('text/plain', txt);
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await page.waitForTimeout(300);
  const ic = await col('#g', 'Interval (months)'); const oc = await col('#g', 'Responsible group');
  await page.locator(`#g tbody tr:nth-child(1) td:nth-child(${ic})`).click(); await page.keyboard.type('6'); await page.keyboard.press('Enter');
  await page.locator(`#g tbody tr:nth-child(1) td:nth-child(${oc})`).click(); await page.keyboard.type('Analyst'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.locator(`#g tbody tr:nth-child(1) td:nth-child(${ic})`).click({ modifiers: [] });
  await page.locator(`#g tbody tr:nth-child(3) td:nth-child(${oc})`).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+d'); await page.waitForTimeout(200);
  await page.click('#g .savebar [data-save]'); await sign(page); await page.waitForTimeout(1200);
  await page.waitForSelector('#g tbody tr');
  const listNow = await page.locator('#g').innerText();
  check('Add many: three pipettes created from a paste with fill down', /Pipette P20 #4/.test(listNow) && /Pipette P20 #6/.test(listNow), (await toasts()));
  const p6 = page.locator('#g tbody tr', { hasText: 'Pipette P20 #6' });
  check('Filled-down owner and interval: Analyst owns #6; calibration Deficient (none yet)', /Analyst/.test(await p6.innerText()) && /None/.test(await p6.innerText()), await p6.innerText());

  // ---- Maintenance schedule on the HPTLC (signed grid)
  await openEq('HPTLC system');
  await page.click('#sg [data-add="1"]');
  await page.locator('#sg tbody tr:nth-child(1) td:nth-child(1)').click();
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', 'Clean the TLC Visualizer lamp housing\t3\tmonths\t2026-12-01\t14\tYes');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await page.waitForTimeout(300);
  await page.click('#sg .savebar [data-save]'); await sign(page); await page.waitForTimeout(900);
  check('A maintenance schedule is added with a signature', /Clean the TLC Visualizer lamp housing/.test(await page.locator('#sg').innerText()), await toasts());

  // ---- Excel export of the register
  await go('#/equipment');
  const xl = await page.evaluate(async () => {
    const site = (await (await fetch('/api/users')).json()).flatMap((u) => u.sites || []).find((x) => x.site_code === 'CFL').id;
    const r = await fetch('/api/bulk/equipment/export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-site-id': site }, body: '{}' });
    return { s: r.status, t: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength }; });
  check('The register exports to Excel', xl.s === 200 && /spreadsheetml/.test(xl.t) && xl.n > 1000, JSON.stringify(xl));

  // ---- Transfer the refrigerator to TPS (history goes with it)
  await openEq('Reagent refrigerator 1');
  await page.click('[data-act="transfer"]');
  await fillModal({ to_site_id: 'TPS Tentamus Pharmaceutical Services', department_id: 'TPS: GEN General lab', owner_group_id: 'TPS: Lab Supervisor', notes: 'Spare for the TPS stability suite' });
  await okModal(); await sign(page); await page.waitForTimeout(1200);
  check('Transferred: gone from CFL\'s register', !/Reagent refrigerator 1/.test(await page.locator('#g').innerText()));

  // ---- Audit icon on the equipment page
  await go(viscUrl.slice(viscUrl.indexOf('#')));
  await page.click('main h1 .auditbtn'); await page.waitForTimeout(800);
  const audit = await page.locator('.modal').innerText().catch(() => '');
  check('The audit trail of the equipment shows its tag, calibration and release with signatures', /TAG-/.test(audit) && /CAL-/.test(audit) && /Released by|Recorded by|Tagged out by/.test(audit));
  await shot('74_equipment_audit');

  check('No native browser dialogs', native === 0);
  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\nTOTAL: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
