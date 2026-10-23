// The chain of custody and sample manifest (0.29.0, migration 051): one document per lab order, made when the order is
// submitted. The printed copy travels with the samples: the client (and any courier) sign "Relinquished by" on paper.
// Each receipt is signed in the LIMS: the receiver's handwritten signature and title go into a Received block, and the
// chain of custody as it stands then is kept as a PDF with the receipt.
'use strict';
const COA = require('./coa');
const QR = require('./qr');
const { esc, fmtDate, fmtDateTime } = COA;

async function data(db, orderId, { verifyBase = '' } = {}) {
  const o = await db.one(`SELECT o.*, c.client_code, COALESCE(c.display_name, c.legal_name) AS client_name, COALESCE(c.site_address, c.billing_address, '') AS client_address,
      si.site_code, si.site_name, si.address AS lab_address, si.time_zone, ct.first_name || ' ' || ct.last_name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone
    FROM lab_order o JOIN client c ON c.id = o.client_id JOIN lab_site si ON si.id = o.site_id LEFT JOIN contact ct ON ct.id = o.ordering_contact_id WHERE o.id = $1`, [orderId]);
  if (!o) throw new Error('Order not found');
  const doc = await db.one('SELECT * FROM custody_document WHERE lab_order_id = $1', [orderId]);
  const samples = await db.rows(`SELECT s.id, s.sample_code, s.client_sample_id, s.description, s.matrix, s.lot, s.metrc_id, s.number_of_units, s.quantity_received::text AS quantity, s.quantity_unit,
      s.serving_count::text AS serving_count, s.serving_count_unit, s.serving_size::text AS serving_size, s.serving_unit,
      s.preservation, s.condition, s.receipt_temperature::text AS temperature, s.received_at, s.logged_at, s.status::text AS status,
      (SELECT string_agg(t.test_name, ', ' ORDER BY t.test_name) FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled') AS tests
    FROM sample s WHERE s.lab_order_id = $1 AND s.status <> 'Cancelled' ORDER BY s.created_at, s.client_sample_id`, [orderId]);
  const events = doc ? await db.rows(`SELECT e.id, e.event_no, e.kind, e.event_at, e.sample_ids, e.delivered_by, e.tracking_no, e.temperature::text AS temperature, e.temperature_unit,
      e.condition, e.seals, e.note, e.signer_title, e.created_at, u.full_name AS by_name, f.mime_type AS sig_type, encode(f.content, 'base64') AS sig_b64, se.signed_at,
      th.equipment_code AS thermometer_code, th.equipment_name AS thermometer_name
    FROM custody_event e JOIN app_user u ON u.id = e.created_by LEFT JOIN document_file f ON f.id = e.signature_image_id LEFT JOIN signature_event se ON se.id = e.signature_id
    LEFT JOIN equipment th ON th.id = e.thermometer_id
    WHERE e.custody_document_id = $1 ORDER BY e.event_no`, [doc.id]) : [];
  const receipts = events.filter((e) => e.kind === 'Received');
  const receiptNo = new Map(); receipts.forEach((e, i) => (e.sample_ids || []).forEach((sid) => receiptNo.set(sid, i + 1)));
  return {
    coc_code: doc ? doc.coc_code : `COC-${o.order_code}`, made_at: doc ? doc.created_at : null, made_at_migration: doc ? doc.made_at_migration : false, time_zone: o.time_zone,
    lab: { code: o.site_code, name: o.site_name, address: o.lab_address || '' },
    client: { code: o.client_code, name: o.client_name, address: o.client_address, contact: o.contact_name || '', email: o.contact_email || '', phone: o.contact_phone || '' },
    order: { id: o.id, code: o.order_code, po: o.po_number || '', channel: o.submission_channel, submitted_at: o.submitted_at, notes: o.notes || '' },
    samples: samples.map((s) => ({ ...s, receipt: receiptNo.get(s.id) || null })),
    receipts: receipts.map((e, i) => ({ ...e, n: i + 1, signature: e.sig_b64 ? `data:${e.sig_type};base64,${e.sig_b64}` : null })),
    qr: QR.svg(`${verifyBase || ''}/#/orders/${o.id}`, { px: 2, label: 'Order link' }),
  };
}

function html(d) {
  const tz = d.time_zone;
  // the serving size the client shared (0.34.0)
  const num = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));
  const reporting = (s) => [s.serving_size ? `Serving ${s.serving_count ? `${num(s.serving_count)} ${s.serving_count_unit || ''} = ` : ''}${num(s.serving_size)} ${s.serving_unit || ''}`.replace(/\s+/g, ' ').trim() : ''].filter(Boolean);
  const rows = d.samples.map((s, i) => `<tr><td class="r">${i + 1}</td><td>${esc(s.client_sample_id || '')}${s.description ? `<div class="sub">${esc(s.description)}</div>` : ''}${reporting(s).map((x) => `<div class="sub">${esc(x)}</div>`).join('')}</td>
    <td>${esc(s.matrix || '')}${s.lot ? `<div class="sub">Lot ${esc(s.lot)}</div>` : ''}${s.metrc_id ? `<div class="sub">METRC ${esc(s.metrc_id)}</div>` : ''}</td><td class="r">${esc(s.number_of_units ?? '')}</td>
    <td>${s.quantity ? esc(`${Number(s.quantity)} ${s.quantity_unit || ''}`) : ''}</td><td>${esc(s.preservation || '')}</td><td class="t">${esc(s.tests || '')}</td>
    <td><b>${esc(s.sample_code || '')}</b>${s.receipt ? `<div class="sub">Receipt ${s.receipt}</div>` : s.logged_at ? '<div class="sub">Logged, no signed receipt</div>' : ''}</td>
    <td>${esc(s.condition || '')}${s.temperature ? `<div class="sub">${esc(Number(s.temperature))} °C</div>` : ''}</td></tr>`).join('');
  const blank = (label) => `<div class="box"><div class="bl">${label}</div><div class="line"><span>Signature</span></div><div class="pair"><div class="line"><span>Printed name</span></div><div class="line"><span>Date and time</span></div></div></div>`;
  const received = d.receipts.map((e) => `<div class="box rcv"><div class="bl">Received by the laboratory: receipt ${e.n} (${(e.sample_ids || []).length} sample${(e.sample_ids || []).length === 1 ? '' : 's'})</div>
      <div class="sig">${e.signature ? `<img src="${e.signature}" alt="Signature of ${esc(e.by_name)}">` : ''}</div>
      <div class="line filled"><b>${esc(e.by_name)}</b>${e.signer_title ? `, ${esc(e.signer_title)}` : ''}<span>Signed electronically ${esc(fmtDateTime(e.signed_at || e.created_at, tz))}</span></div>
      <div class="kv2"><div><span>Received</span>${esc(fmtDateTime(e.event_at, tz))}</div><div><span>Delivered by</span>${esc(e.delivered_by || '')}${e.tracking_no ? ` (${esc(e.tracking_no)})` : ''}</div>
      <div><span>Temperature</span>${e.temperature ? esc(`${Number(e.temperature)} ${e.temperature_unit}`) : ''}${e.thermometer_code ? `<div class="sub">Thermometer ${esc(e.thermometer_code)} ${esc(e.thermometer_name || '')}</div>` : ''}</div><div><span>Condition</span>${esc(e.condition || '')}</div><div><span>Custody seals</span>${esc(e.seals || '')}</div></div>
      ${e.note ? `<div class="sub">${esc(e.note)}</div>` : ''}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.coc_code)}</title><style>
    body { font: 9pt/1.3 "Helvetica Neue", Arial, sans-serif; color: #1d2329; margin: 0; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #1f3a2c; padding-bottom: 8px; }
    .lab { font-size: 14pt; font-weight: 700; color: #1f3a2c; } .addr { color: #5c6773; white-space: pre-line; }
    .title { text-align: right; display: flex; gap: 10px; align-items: flex-start; } .title .t { font-size: 13pt; font-weight: 700; } .title .v { color: #5c6773; margin-top: 2px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 10px 0; }
    h4 { margin: 0 0 3px; font-size: 8pt; text-transform: uppercase; letter-spacing: .5px; color: #5c6773; }
    table.kv td { padding: 1px 8px 1px 0; vertical-align: top; } table.kv td:first-child { color: #5c6773; font-weight: 600; width: 34%; }
    table.m { width: 100%; border-collapse: collapse; } table.m th { background: #eef2f0; text-align: left; font-size: 7.5pt; padding: 4px 5px; border: 1px solid #c9d3cf; }
    table.m td { border: 1px solid #d9e0dd; padding: 4px 5px; vertical-align: top; } .r { text-align: right; } td.t { font-size: 8pt; }
    .sub { font-size: 7.5pt; color: #5c6773; }
    .boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; break-inside: avoid; }
    .box { border: 1px solid #9fb0a8; border-radius: 3px; padding: 6px 8px; break-inside: avoid; } .bl { font-weight: 700; color: #1f3a2c; margin-bottom: 4px; }
    .line { border-bottom: 1px solid #1d2329; height: 26px; position: relative; margin-top: 4px; } .line span { position: absolute; bottom: -12px; left: 0; font-size: 7pt; color: #5c6773; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .line.filled { height: auto; padding-bottom: 2px; margin-bottom: 4px; } .line.filled span { position: static; display: block; font-size: 7pt; color: #5c6773; }
    .rcv .sig img { height: 42px; max-width: 220px; object-fit: contain; display: block; }
    .kv2 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px 8px; margin-top: 4px; } .kv2 span { display: block; font-size: 7pt; color: #5c6773; }
    .rule { margin-top: 10px; font-size: 7.5pt; color: #333; }
  </style></head><body>
  <div class="top"><div><div class="lab">${esc(d.lab.name)}</div><div class="addr">${esc(d.lab.address)}</div></div>
    <div class="title"><div><div class="t">CHAIN OF CUSTODY AND SAMPLE MANIFEST</div><div class="v">${esc(d.coc_code)} · Order ${esc(d.order.code)}</div>
      <div class="v">${d.order.submitted_at ? 'Submitted ' + esc(fmtDateTime(d.order.submitted_at, tz)) : ''}</div></div>${d.qr}</div></div>
  <div class="grid"><div><h4>Client</h4><table class="kv"><tr><td>Client</td><td>${esc(d.client.name)} (${esc(d.client.code)})</td></tr><tr><td>Address</td><td>${esc(d.client.address)}</td></tr>
      <tr><td>Contact</td><td>${esc(d.client.contact)}${d.client.phone ? ', ' + esc(d.client.phone) : ''}${d.client.email ? '<br>' + esc(d.client.email) : ''}</td></tr></table></div>
    <div><h4>Order</h4><table class="kv"><tr><td>Order</td><td>${esc(d.order.code)}</td></tr><tr><td>PO</td><td>${esc(d.order.po)}</td></tr><tr><td>Submitted by</td><td>${esc(d.order.channel || '')}</td></tr>
      <tr><td>Samples</td><td>${d.samples.length}, ${d.samples.reduce((n, s) => n + (Number(s.number_of_units) || 0), 0) || '?'} container(s)</td></tr>${d.order.notes ? `<tr><td>Notes</td><td>${esc(d.order.notes)}</td></tr>` : ''}</table></div></div>
  <table class="m"><thead><tr><th>#</th><th>Client sample ID</th><th>Matrix</th><th>Containers</th><th>Quantity</th><th>Preservation</th><th>Tests requested</th><th>Lab sample ID</th><th>Condition on receipt</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="9">No samples yet</td></tr>'}</tbody></table>
  <div class="boxes">${blank('Relinquished by (client)')}${blank('Received by (courier), if shipped')}${blank('Relinquished by (courier)')}${received || '<div class="box"><div class="bl">Received by the laboratory</div><div class="sub">Signed in the LIMS when the samples are received.</div></div>'}</div>
  <div class="rule">Each person who relinquishes or receives the samples signs this form. The laboratory's receipt is signed electronically; the signed copy is kept with the order in the LIMS.${d.made_at_migration ? ' This chain of custody was made when the LIMS started keeping them (the order was submitted before).' : ''}</div>
  </body></html>`;
}

async function pdf(d) {
  return COA.htmlToPdf(html(d), `${d.coc_code} · Order ${d.order.code} · ${d.lab.code}`, { landscape: true });
}

// Image size from the file itself (PNG IHDR, JPEG SOF): the photo's 4:3 shape is checked on what was uploaded
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504E47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'image/png' };
  if (buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const m = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
      if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'image/jpeg' };
      i += 2 + len;
    }
  }
  return null;
}

module.exports = { data, html, pdf, imageSize };
