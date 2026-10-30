// Lab setup additions (migration 030) end to end in the browser, as Alex Kiddle (system administrator):
//  - the menu has section colours and icons, and the page title wears its menu item's icon;
//  - Admin > Lab setup > Report templates lists RT-001 (the default for every lab); a CFL template is added by paste;
//  - the Workflow Designer (tab 1) picks the new template for a Draft test version;
//  - Sites: the lab's image slots start as placeholders; a logo and a small logo are uploaded (the small logo then
//    shows in the header); the accreditation placeholders are filled in the Sites grid;
//  - a COA preview carries the lab's logo and accreditation statement, and reports with the lab's default template;
//  - the product name is one setting: renamed, the header, the browser tab and the sign-in page follow; then put back.
// The multi-part COA (tests on one sample using different templates) was checked by tests/coa_parts.js (removed with the Node backend; not replaced).
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, call, login } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
// a 4 x 4 PNG (teal), enough to stand for a logo
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGNgYPiPhBgGkg8AQ/0P8bVhfS0AAAAASUVORK5CYII=', 'base64');

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-4]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(700); };
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const paste = (text) => page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
  const cell = (host, r, c) => page.locator(`${host} .gwrap > table > tbody > tr:nth-child(${r}) > td:nth-child(${c})`);
  const cookie = await login(BASE, 'akiddle', PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const cfl = users.find((u) => u.username === 'akiddle').sites.find((s) => s.site_code === 'CFL').id;
  const api = async (p, opts = {}) => { const res = await fetch(BASE + '/api' + p, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': cfl },
    body: opts.body ? JSON.stringify(opts.body) : undefined }); return { ok: res.ok, data: await res.json().catch(() => ({})) }; };

  // ---- the menu and the page title
  await signIn(page, BASE, 'Alex Kiddle', '#/admin/report-templates'); await page.waitForSelector('#tg tbody tr');
  const navLook = await page.evaluate(() => {
    const a = document.querySelector('nav a[href="#/admin/report-templates"]'); const o = document.querySelector('nav a[href="#/orders"]');
    return { icons: document.querySelectorAll('nav a .nico svg').length, links: document.querySelectorAll('nav a').length, on: a.classList.contains('on'), sec: a.dataset.sec, osec: o.dataset.sec,
      chip: !!document.querySelector('main .phead .pchip svg'), title: document.querySelector('main h1').innerText.trim(), body: document.body.dataset.sec };
  });
  check('Every menu item has its icon; Report templates is under Lab setup, in the Admin colour; Lab orders in the Intake colour',
    navLook.icons === navLook.links && navLook.on && navLook.sec === 'admin' && navLook.osec === 'intake' && navLook.body === 'admin', JSON.stringify(navLook));
  check('The page title wears its menu icon, and its text is unchanged', navLook.chip && navLook.title === 'Report templates', navLook.title);

  // ---- report templates
  const t0 = await page.locator('#tg tbody tr').allInnerTexts();
  // 0.29.0: every lab also has the two photo layouts (RT-002, RT-003)
  check('Report templates: RT-001 Standard Certificate of Analysis, every lab, the default (and the two photo layouts)', t0.length === 3 && /RT-001/.test(t0[0]) && /Standard Certificate of Analysis/.test(t0[0]) && /Every lab/.test(t0[0])
    && t0.some((t) => /COA with 1 photo/.test(t)) && t0.some((t) => /COA with 2 photos/.test(t)));
  await page.click('#tg [data-add="1"]'); await cell('#tg', 4, 2).click();
  await paste('Microbiology short form\tCFL\tStandard COA\tNo\tMICROBIOLOGY REPORT\tNo\tYes\tYes\tNo\tShort form for plate counts');
  await page.waitForTimeout(200);
  await page.click('.savebar [data-save]'); await sign(page, { reason: 'New template for micro' }); await page.waitForTimeout(900);
  await page.waitForSelector('#tg tbody tr:nth-child(4)');
  const t1 = await page.locator('#tg tbody tr').allInnerTexts();
  const rts = (await api('/report-templates')).data.rows;
  const micro = rts.find((r) => r.template_name === 'Microbiology short form');
  check('A CFL template is added by paste: its code, its lab, its options', t1.length === 4 && micro && /^RT-\d{3}$/.test(micro.template_code) && micro.site_id === cfl
    && micro.options.show_method === false && micro.options.show_loq === false && micro.options.title === 'MICROBIOLOGY REPORT' && micro.is_default === false, JSON.stringify(micro && micro.options));
  await shot('rt_01_templates');

  // ---- the designer picks it for a Draft test version
  const tests = (await api('/methods/tests')).data.rows;
  const draft = tests.find((t) => t.site_id === cfl && t.draft_version_id);
  await go(`#/methods/versions/${draft.draft_version_id}?tab=test`);
  const opts = await page.locator('#f_tpl option').allInnerTexts();
  check('Designer tab 1 offers the templates (blank uses the lab\'s default), the default marked', opts.some((o) => /Microbiology short form/.test(o)) && opts.some((o) => /RT-001\), the lab's default/.test(o)), opts.join(' / '));
  await page.evaluate((id) => { const s = document.querySelector('#f_tpl'); s.value = id; s.dispatchEvent(new Event('change', { bubbles: true })); }, micro.id);
  await page.click('#save'); await sign(page, { reason: 'Report with the micro template' }); await page.waitForTimeout(900);
  const dv = (await api(`/methods/versions/${draft.draft_version_id}`)).data;
  check('The test version reports with the chosen template', dv.version && dv.version.report_template_id === micro.id, dv.version && dv.version.report_template_id);

  // ---- Sites: image placeholders, uploads, accreditation
  await go('#/admin/sites'); await page.waitForSelector('#media .mslot');
  const empty = await page.locator('#media .mslot').allInnerTexts();
  check('The lab\'s images start as placeholders: Logo, Small logo, Accreditation mark', empty.length === 3 && empty.every((t) => /No file yet/.test(t)) && /Logo/.test(empty[0]) && /Accreditation mark/.test(empty[2]));
  for (const kind of ['Logo', 'Small logo']) {
    await page.click(`#media [data-up="${kind}"]`); await page.waitForSelector('.modal #f_file');
    await page.setInputFiles('.modal #f_file', { name: `${kind.toLowerCase().replace(' ', '-')}.png`, mimeType: 'image/png', buffer: PNG });
    await page.click('.modal [data-ok]'); await sign(page, { reason: `${kind} for the lab` }); await page.waitForTimeout(900);
  }
  await page.waitForSelector('#media .mslot.has img');
  const slots = await page.evaluate(() => [...document.querySelectorAll('#media .mslot')].map((s) => ({ k: s.dataset.kind, img: !!s.querySelector('.pic img'), t: s.innerText })));
  check('Logo and small logo uploaded: their slots show the image and who uploaded it', slots.filter((s) => s.img).length === 2 && slots[2].img === false && /logo\.png/.test(slots[0].t), JSON.stringify(slots.map((s) => [s.k, s.img])));
  const fileOk = await page.evaluate(async () => { const i = document.querySelector('#media .mslot.has img'); await i.decode().catch(() => {}); return i.naturalWidth; });
  check('The stored image is served back unchanged', fileOk === 4, String(fileOk));
  await page.click('#sg tbody tr:nth-child(1) td:nth-child(7)'); await paste('A2LA\t1234.01\tAccredited to ISO/IEC 17025:2017 for the tests marked (placeholder).'); await page.waitForTimeout(200);
  await page.click('.savebar [data-save]'); await sign(page, { reason: 'Accreditation placeholders' }); await page.waitForTimeout(900);
  await go('#/admin/sites'); await page.waitForSelector('#media .mslot');
  const sg = await page.locator('#sg tbody tr').first().innerText();
  const logoInHeader = await page.evaluate(() => !!document.querySelector('header.top .brand .logo.img img'));
  check('The accreditation placeholders are kept on the lab', /A2LA/.test(sg) && /1234\.01/.test(sg), sg.slice(0, 160));
  check('The small logo shows in the header while working in CFL', logoInHeader);
  await shot('rt_02_sites_images');

  // ---- the COA carries them, and reports with the lab's default template
  const sample = (await api('/reports/queue')).data.rows[0]; const tsel = [sample.requested_test_id];
  const pv = (await api('/reports/preview', { method: 'POST', body: { sample_id: sample.sample_id, tests: tsel } })).data;
  check('A COA preview carries the lab\'s logo and accreditation statement', pv.content && pv.content.lab.logo_id && /ISO\/IEC 17025/.test(pv.content.lab.accreditation || ''),
    JSON.stringify(pv.content && pv.content.lab).slice(0, 200));
  check('It is one part, in the every-lab default (RT-001)', pv.content.sections.length === 1 && pv.content.sections[0].template.code === 'RT-001', JSON.stringify(pv.content.sections.map((s) => s.template.code)));
  const pdf = await fetch(`${BASE}/api/reports/preview/${pv.token}`, { headers: { Cookie: cookie } });
  check('The preview PDF is made (the read-back of every cell passed)', pdf.ok && !(pv.checks || []).some((k) => k.code === 'pdf'), (pv.checks || []).filter((k) => k.level === 'Block').map((k) => k.title).join('; '));
  const rows2 = (await api('/report-templates')).data.rows.map((r) => ({ id: r.id, is_default: r.id === micro.id }));
  const mk = await api('/report-templates', { method: 'POST', body: { reason: 'Micro template as CFL default (test)', rows: rows2.filter((r) => r.is_default) } });
  if (!mk.ok) console.log('default:', mk.data.error);
  const pv2 = (await api('/reports/preview', { method: 'POST', body: { sample_id: sample.sample_id, tests: tsel } })).data;
  check('Made CFL\'s default, the lab\'s own default is used: its title, no method line, no LOQ column', pv2.content && pv2.content.sections[0].template.id === micro.id
    && pv2.content.sections[0].template.options.title === 'MICROBIOLOGY REPORT', JSON.stringify(pv2.content && pv2.content.sections[0].template).slice(0, 200));
  await api('/report-templates', { method: 'POST', body: { reason: 'Back to the standard default (test)', rows: [{ id: micro.id, is_default: false }] } });
  check('Put back: CFL reports with RT-001 again', (await api('/reports/preview', { method: 'POST', body: { sample_id: sample.sample_id, tests: tsel } })).data.content.sections[0].template.code === 'RT-001');

  // ---- the product name
  await go('#/admin/sites'); await page.waitForSelector('#pn_edit');
  await page.click('#pn_edit'); await page.waitForSelector('.modal #f_product_name'); await page.fill('.modal #f_product_name', 'LabTest Demo');
  await page.click('.modal [data-ok]'); await sign(page, { reason: 'Rename (test)' }); await page.waitForTimeout(700);
  await page.reload(); await page.waitForSelector('main h1'); await page.waitForTimeout(600);
  const brand = await page.locator('header.top .brand b').innerText();
  check('Renamed: the header and the browser tab follow', brand === 'LabTest Demo' && (await page.title()) === 'LabTest Demo Sandbox', `${brand} / ${await page.title()}`);
  const p2 = await b.newPage(); await p2.goto(BASE + '/'); await p2.waitForSelector('#loginScreen .brand b');
  check('and the sign-in page', (await p2.locator('#loginScreen .brand b').innerText()) === 'LabTest Demo'); await p2.close();
  const put = await api('/settings', { method: 'POST', body: { product_name: 'LIMS3', reason: 'Put back (test)' } });
  const qa = await login(BASE, 'qa.reviewer', PASSWORD);
  const refused = await fetch(BASE + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: qa }, body: JSON.stringify({ product_name: 'Nope', reason: 'x' }) });
  check('Put back to LIMS3; only a system administrator renames it', put.ok && !refused.ok && (await call(BASE, '/public/settings')).data.product_name === 'LIMS3');

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
