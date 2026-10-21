// 0.29.0 (migration 051): the chain of custody and sample manifest, signed receipts, receipt photos (4:3), the photo
// report layouts and the QR code. The Intake Tech makes an order of two samples by API; submitting it makes its chain
// of custody (printed as a PDF); one sample is received and signed in the browser (their handwritten signature is placed
// in the Received area, and the signed copy is kept), the other in a second receipt; photos are added from the order's
// grid (cropped to 4:3 in the browser), one marked for the report; a scan of the client's paper copy is attached.
// Alex (no signature on file) is told so; a lab that requires signed receipts hides "Log without signing" and the
// database refuses logging any other way. QA makes a CFL template "COA with 2 photos" the lab default: Report
// Finalization blocks a sample without its two photos, then passes once they are marked; the default is put back.
// Run on a freshly reset database.
const path = require('path'); const fs = require('fs'); const zlib = require('zlib');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, login, call } = require('./auth');
const PASSWORD = require('./test-credentials.json').password;
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

// a plain PNG (not 4:3: the photo dialog crops it), with a band so the crop is visible
function png(w, h, rgb) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const band = y > h * 0.7; raw[o] = band ? 120 : rgb[0]; raw[o + 1] = band ? 110 : rgb[1]; raw[o + 2] = band ? 100 : rgb[2]; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function as(who, lab = 'CFL') {
  const cookie = await login(BASE, who, PASSWORD);
  const users = (await call(BASE, '/users', { cookie })).data;
  const site = users.find((u) => u.username === who).sites.find((s) => s.site_code === lab).id;
  const f = async (p, body, method) => {
    const res = await fetch(BASE + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookie, 'x-site-id': site }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json().catch(() => ({})) : Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new Error(`${who} ${p}: ${data.error}`);
    return data;
  };
  f.site = site; return f;
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
  const intake = await as('intake'); const qa = await as('qa.reviewer'); const pm = await as('projmgr'); const alex = await as('akiddle');

  // ---- set-up: an order of two samples for Acme, by API, still a Draft
  const acme = (await intake('/clients')).find((c) => c.client_code === 'CL-00005');
  const ordering = (await intake('/order-setup/' + acme.id)).contacts[0].id;
  const ord = await intake('/orders', { row: { client_id: acme.id, ordering_contact_id: ordering, submission_channel: 'Paper', po_number: 'E2E-COC' } });
  await intake(`/orders/${ord.id}/samples`, { rows: [{ client_sample_id: 'COC-A', description: 'Whey protein, tub', matrix: 'Powder', number_of_units: 2, quantity_received: 500, quantity_unit: 'g' },
    { client_sample_id: 'COC-B', description: 'Whey protein, retain', matrix: 'Powder', number_of_units: 1 }] });
  let od = await intake('/orders/' + ord.id);
  const line = od.orderable[0];
  await intake(`/orders/${ord.id}/add-test`, { sample_ids: od.samples.map((s) => s.id), line_id: line.line_id });
  check('A Draft order has no chain of custody yet', !(await intake(`/orders/${ord.id}/custody`)).document);

  // ---- 1. submitting makes the chain of custody; it prints
  await signIn(page, BASE, 'Intake Tech (demo)', '#/orders/' + ord.id);
  await go('#/orders/' + ord.id);
  check('The order page has a Chain of custody card (Submit to make it)', /Submit the order to make its chain of custody/.test(await page.locator('#ocus').innerText()));
  await page.click('#submit'); await page.waitForTimeout(1200); await page.waitForSelector('#ocus h2');
  const coc = `COC-${od.order.order_code}`;
  check('Submitting the order makes chain of custody ' + coc, (await page.locator('#ocus').innerText()).includes(coc));
  const href = await page.getAttribute('#cocpdf', 'href');
  const printed = await page.evaluate(async (h) => { const r = await fetch(h); return { ok: r.ok, type: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength }; }, href);
  check('Print chain of custody gives a PDF (the manifest, with blank Relinquished by boxes)', printed.ok && /pdf/.test(printed.type) && printed.n > 20000, JSON.stringify(printed));
  check('"Receive and sign (2)" is the main button; "Log samples without signing" is still offered (the lab does not require signed receipts)',
    /Receive and sign \(2\)/.test(await page.locator('#receive').innerText()) && (await page.locator('#log').count()) === 1);

  // ---- 2. receive COC-A only, signed
  const sampleRows = page.locator('#sg > .gwrap > table > tbody > tr:not(.gdetail)');
  await sampleRows.nth(1).locator('.chk').first().click(); await page.waitForTimeout(200);
  await page.click('#receive'); await page.waitForSelector('.modal #f_received_at');
  check('The receive dialog names the sample being received', /COC-A/.test(await page.locator('.modal .intro').innerText()) && !/COC-B/.test(await page.locator('.modal .intro').innerText()));
  await page.fill('.modal #f_delivered_by', 'FedEx'); await page.fill('.modal #f_tracking_no', '7712 3456 0001'); await page.fill('.modal #f_temperature', '3.8');
  // since 0.34.0 a temperature names its thermometer (seed_039's demo receiving thermometer)
  await page.evaluate(() => { const s = document.querySelector('.modal #f_thermometer_id'); s.value = [...s.options].find((o) => /Receiving thermometer/.test(o.text)).value; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.evaluate(() => { const s = document.querySelector('.modal #f_seals'); s.value = 'Intact'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('.modal #f_note', 'Cooler with two ice packs');
  await page.click('.modal [data-ok]');
  const bad = await sign(page, { password: 'not-my-password-1', expectError: true });
  check('A wrong password does not sign the receipt', /not correct/i.test(bad), bad);
  await page.fill('.sigmodal #f_spass', PASSWORD); await page.click('.sigmodal [data-ok]'); await page.waitForTimeout(2500);
  check('Receiving logs the sample and signs receipt 1', /1 sample received and logged; receipt 1 signed/.test(await toasts()), await toasts());
  await page.waitForSelector('#ocus .grid, #ocus table');
  const cocText = await page.locator('#ocus').innerText();
  check('The receipt is listed: who, the sample, FedEx and its tracking number, 3.8 °C, seals intact', /Intake Tech \(demo\)/.test(cocText) && /FedEx, 7712 3456 0001/.test(cocText) && /3\.8/.test(cocText) && /seals intact/.test(cocText), cocText.replace(/\s+/g, ' ').slice(0, 300));
  od = await intake('/orders/' + ord.id);
  const sa = od.samples.find((s) => s.client_sample_id === 'COC-A'); const sb = od.samples.find((s) => s.client_sample_id === 'COC-B');
  check('COC-A is logged (sample ID), COC-B is still expected', sa.status === 'Logged' && /^CFL\d{9}$/.test(sa.sample_code) && sb.status === 'Expected', `${sa.status} ${sa.sample_code} ${sb.status}`);
  check('Its receipt temperature and condition went onto the sample', Number(sa.receipt_temperature) === 3.8 && sa.condition === 'Acceptable', `${sa.receipt_temperature} ${sa.condition}`);
  await shot('c01_order_custody');
  const cus = await intake(`/orders/${ord.id}/custody`);
  const signedPdf = await intake(`/custody/events/${cus.events[0].id}/file`);
  check('The signed chain of custody is kept with the receipt (a PDF)', Buffer.isBuffer(signedPdf) && signedPdf.slice(0, 4).toString() === '%PDF');

  // ---- 3. a second receipt (by API), then the paper copy
  await intake(`/orders/${ord.id}/receive`, { sample_ids: [sb.id], delivered_by: 'Client in person', condition: 'Acceptable', signature: { username: 'intake', password: PASSWORD } });
  const cus2 = await intake(`/orders/${ord.id}/custody`);
  check('A second delivery is its own receipt (receipt 2)', cus2.events.filter((e) => e.kind === 'Received').length === 2 && cus2.events[1].event_no === 2);
  let refused = '';
  try { await intake(`/orders/${ord.id}/receive`, { sample_ids: [sb.id], signature: { username: 'intake', password: PASSWORD } }); } catch (e) { refused = e.message; }
  check('A sample already received cannot be received again', /still expected/.test(refused), refused);
  await go('#/orders/' + ord.id);
  await page.click('#cocpaper'); await page.waitForSelector('.modal #f_file');
  await page.setInputFiles('.modal #f_file', { name: 'coc-scan.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.fill('.modal #f_note', 'Signed by the client at drop-off'); await page.click('.modal [data-ok]'); await page.waitForTimeout(1200);
  check('The client\'s signed paper copy is attached (a Paper copy event)', /Paper copy/.test(await page.locator('#ocus').innerText()));

  // ---- 4. photos from the order grid: cropped to 4:3 in the browser, one marked Report photo 1
  const photoBtn = sampleRows.nth(0).locator('button', { hasText: 'Add…' });
  check('Each sample has a Photos button in the order grid', (await photoBtn.count()) === 1);
  await photoBtn.click(); await page.waitForSelector('.modal #f_ph');
  await page.setInputFiles('.modal #f_ph', [{ name: 'tub.png', mimeType: 'image/png', buffer: png(1000, 900, [200, 180, 140]) }, { name: 'label.png', mimeType: 'image/png', buffer: png(900, 1200, [150, 190, 220]) }]);
  await page.waitForSelector('.modal .phitem:nth-child(2)');
  const dims = await page.evaluate(() => [...document.querySelectorAll('.modal .phitem img')].map((i) => [i.naturalWidth, i.naturalHeight]));
  check('Both photos are cropped to 4:3 before upload (1000 x 900 and 900 x 1200 in)', dims.length === 2 && dims.every(([w, h]) => Math.abs(w * 3 - h * 4) <= 3), JSON.stringify(dims));
  await page.locator('.modal .phitem').nth(0).locator('.phcap').fill('Tub as received');
  await page.locator('.modal .phitem').nth(0).locator('.phslot').selectOption('1');
  await page.click('.modal [data-ok]'); await page.waitForTimeout(1500);
  check('The photos are added and counted in the grid', /2 photos/.test(await sampleRows.nth(0).innerText()));
  let tooWide = '';
  try { await intake(`/samples/${sa.id}/photos`, { photos: [{ base64: png(1000, 400, [0, 0, 0]).toString('base64') }] }); } catch (e) { tooWide = e.message; }
  check('The server refuses a photo that is not 4:3', /crop it to 4:3/.test(tooWide), tooWide);
  await go('#/samples/' + sa.id);
  const phText = await page.locator('#phcard').innerText();
  check('The sample page shows its photos, Report photo 1 with its caption', /Photos \(2\)/.test(phText) && /Report photo 1/.test(phText) && /Tub as received/.test(phText));
  await shot('c02_sample_photos');

  // ---- 5. the photo layouts; Report Finalization needs the photos
  await go('#/admin/report-templates').catch(() => {});
  const tpl = await qa('/report-templates');
  check('Every lab has "Certificate of Analysis with 1 photo" and "with 2 photos"', ['COA with 1 photo', 'COA with 2 photos'].every((l) => tpl.rows.some((r) => r.layout === l && !r.site_id)) && tpl.layouts.length === 3);
  const cfl = tpl.labs.find((l) => l.site_code === 'CFL').id;
  await qa('/report-templates', { reason: 'Photo reports for the test', rows: [{ template_name: 'CFL COA with photos (e2e)', layout: 'COA with 2 photos', site_id: cfl, is_default: true, status: 'Active',
    options: { show_method: true, show_test_version: true, show_tested_dates: true, show_loq: true, title: 'CERTIFICATE OF ANALYSIS' } }] });
  const mine = (await qa('/report-templates')).rows.find((r) => r.template_name === 'CFL COA with photos (e2e)');
  const q = await pm('/reports/queue'); const qrows = q.rows || q;
  const vc = qrows.filter((r) => r.client_sample_id === 'VC-2302');
  let pv = await pm('/reports/preview', { sample_id: vc[0].sample_id, tests: vc.map((r) => r.requested_test_id || r.id) });
  const blk = pv.checks.find((x) => x.code === 'photos');
  check('With CFL\'s default now "COA with 2 photos", the release check blocks VC-2302 without its photos', blk && blk.level === 'Block' && /Report photo 1/.test(blk.detail), blk && blk.detail);
  const pmApi = intake;
  await pmApi(`/samples/${vc[0].sample_id}/photos`, { photos: [{ base64: png(800, 600, [230, 220, 200]).toString('base64'), caption: 'Bottle', report_slot: 1 }, { base64: png(800, 600, [210, 225, 235]).toString('base64'), caption: 'Label', report_slot: 2 }] });
  pv = await pm('/reports/preview', { sample_id: vc[0].sample_id, tests: vc.map((r) => r.requested_test_id || r.id) });
  const ok = pv.checks.find((x) => x.code === 'photos');
  check('Once two photos are marked, the check passes and the content names them (slot 1 and 2)', ok && ok.level === 'Pass' && pv.content.photos.length === 2 && pv.content.photos.map((p) => p.slot).join() === '1,2');
  check('The preview PDF is made with the photos and the QR code', !!pv.token && !pv.checks.some((x) => x.code === 'pdf'));
  check('The verification link (encoded in the QR code) is in the content', /\/verify\.html\?c=/.test(pv.content.verify_url));
  await qa('/report-templates', { reason: 'Back to the standard COA', rows: [{ id: mine.id, is_default: false, status: 'Inactive' }] });
  check('(clean-up) CFL is back on the every-lab default', !(await qa('/report-templates')).rows.some((r) => r.site_id === cfl && r.is_default && r.status === 'Active'));

  // ---- 6. no signature on file; a lab that requires signed receipts
  const o2 = await alex('/orders', { row: { client_id: acme.id, ordering_contact_id: ordering, po_number: 'E2E-COC-2' } });
  await alex(`/orders/${o2.id}/samples`, { rows: [{ client_sample_id: 'COC-C', matrix: 'Powder' }] });
  const s2 = (await alex('/orders/' + o2.id)).samples;
  await alex(`/orders/${o2.id}/add-test`, { sample_ids: s2.map((s) => s.id), line_id: line.line_id });
  await signIn(page, BASE, 'Alex Kiddle', '#/orders/' + o2.id); await go('#/orders/' + o2.id);
  await page.click('#receive'); await page.waitForSelector('.modal h3');
  check('Without a handwritten signature on file, Receive and sign says so (Alex)', /signature is not on file/.test(await page.locator('.modal h3').innerText()));
  await page.click('.modal [data-ok]');
  const sites = (await alex('/sites')); const cflRow = (sites.rows || sites).find((x) => x.site_code === 'CFL');
  await alex('/sites/bulk', { rows: [{ id: cflRow.id, custody_signature_required: true }], reason: 'Signed receipts only (test)' });
  await go('#/orders/' + o2.id);
  check('Where the lab requires signed receipts, "Log samples without signing" is gone', (await page.locator('#log').count()) === 0 && (await page.locator('#receive').count()) === 1);
  let req = '';
  try { await alex(`/orders/${o2.id}/log`, { sample_ids: s2.map((s) => s.id) }); } catch (e) { req = e.message; }
  check('and the database refuses logging any other way', /only when they are received/.test(req), req);
  await alex('/sites/bulk', { rows: [{ id: cflRow.id, custody_signature_required: false }], reason: 'Back as it was (test)' });

  // ---- 7. who may: the Executive (view only) cannot receive
  const ex = await as('exec'); let exErr = '';
  try { await ex(`/orders/${o2.id}/receive`, { sample_ids: s2.map((s) => s.id), signature: { username: 'exec', password: PASSWORD } }); } catch (e) { exErr = e.message; }
  check('The Executive (view only, no orders.edit) cannot receive samples', /permission|not allowed|cannot|orders\.edit/i.test(exErr) && !/handwritten/.test(exErr), exErr);
  await signIn(page, BASE, 'Intake Tech (demo)', '#/orders/' + ord.id); await go('#/orders/' + ord.id);
  await page.click('main h1 .auditbtn'); await page.waitForTimeout(1200);
  const aud = await page.locator('.modal').innerText().catch(() => '');
  check('The order\'s audit trail lists the chain of custody and the photos', /Chain of custody/.test(aud) && /Photo of/.test(aud), aud.slice(0, 200).replace(/\s+/g, ' '));

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('No native browser dialogs', native === 0);
  await b.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed} of ${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
