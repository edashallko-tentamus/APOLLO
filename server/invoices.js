// Invoicing (I-1, migration 036): the invoice or credit note as the client receives it (PDF, made by the server with
// the same headless Chromium as the COA), from the record. Retests and late rushes are spelled out on their lines.
'use strict';
const COA = require('./coa');
const { esc } = COA;

const money = (v) => { const n = Number(v || 0); return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const dOnly = (d) => { if (!d) return ''; const m = String(d instanceof Date ? d.toISOString() : d).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }) : String(d); };

async function data(db, id) {
  const inv = await db.one(`SELECT i.*, s.site_name, s.site_code, s.address AS site_address, s.invoice_remit_to, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name,
      c.legal_name, c.billing_address, c.payment_terms_days AS client_terms, cr.invoice_number AS credits_number, cr.invoice_date AS credits_date,
      COALESCE(i.invoice_number, i.draft_code) AS code
    FROM invoice i JOIN lab_site s ON s.id = i.site_id JOIN lab_order o ON o.id = i.lab_order_id JOIN client c ON c.id = i.client_id
    LEFT JOIN invoice cr ON cr.id = i.credit_of_id WHERE i.id = $1`, [id]);
  if (!inv) throw new Error('Invoice not found');
  const lines = await db.rows(`SELECT * FROM invoice_line WHERE invoice_id = $1 AND status = 'Active' ORDER BY line_no`, [id]);
  return { inv, lines };
}

function html({ inv, lines }, { preview = false, corrected = null } = {}) {
  const credit = inv.kind === 'Credit note';
  const sign = credit ? -1 : 1;
  const draft = inv.status === 'Draft';
  const terms = inv.payment_terms_days !== null && inv.payment_terms_days !== undefined ? inv.payment_terms_days : inv.client_terms;
  const lateLine = (l) => (l.rush_ordered && Number(l.late_days) > 0
    ? `<div class="m late">Rush ordered: ${esc(l.rush_ordered)}, due ${esc(dOnly(l.due_date))}; reported ${esc(dOnly(l.completed_on))} (${l.late_days} working day${Number(l.late_days) === 1 ? '' : 's'} late).
       ${l.rush_billed !== l.rush_ordered ? `Billed ${l.rush_billed ? 'at the ' + esc(l.rush_billed) + ' rush rate' : 'without a rush fee'}.` : ''}</div>` : '');
  // 058: a charge (kit, shipping, fee, discount) has no test; its sample is shown when it was added for one
  const row = (l) => `<tr${l.retest_of_id ? ' class="retest"' : ''}>
      <td>${l.sample_code ? `<b>${esc(l.sample_code)}</b>` : (l.order_charge_id ? '<span class="m">Order</span>' : '')}${l.client_sample_id ? `<div class="m">${esc(l.client_sample_id)}</div>` : ''}</td>
      <td>${l.retest_of_id ? '<span class="tag">Retest</span> ' : ''}${esc(l.test_name)}${l.line_note ? `<div class="m">${esc(l.line_note)}</div>` : ''}${lateLine(l)}
        ${l.price_note ? `<div class="m">${esc(l.price_note)}</div>` : ''}</td>
      <td>${esc(dOnly(l.completed_on))}</td>
      <td class="n">${money(sign * l.list_price)}</td>
      <td class="n">${Number(l.list_price) - Number(l.price) ? money(sign * (Number(l.list_price) - Number(l.price))) : '-'}</td>
      <td class="n">${money(sign * l.price)}</td>
      <td class="n">${Number(l.rush_fee) ? money(sign * l.rush_fee) + `<div class="m">${esc(l.rush_billed || '')}</div>` : '-'}</td>
      <td class="n"><b>${money(l.amount)}</b></td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 10pt Helvetica, Arial, sans-serif; color: #1d2329; margin: 0; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1f3a2c; padding-bottom: 10px; margin-bottom: 14px; }
    .brand { font-size: 16pt; font-weight: 700; color: #1f3a2c; } .m { color: #5c6773; font-size: 8.5pt; margin-top: 2px; }
    h1 { margin: 0; font-size: 20pt; color: #1f3a2c; text-align: right; letter-spacing: .5px; } .meta { text-align: right; font-size: 9pt; line-height: 1.45; }
    .to { display: flex; gap: 40px; margin-bottom: 14px; } .to div { min-width: 200px; } .to b { display: block; color: #5c6773; font-size: 8.5pt; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; } th { background: #eef3f0; text-align: left; font-size: 8.5pt; padding: 5px; border-bottom: 1px solid #c8d3cc; }
    td { padding: 5px; border-bottom: 1px solid #e6ebe8; vertical-align: top; font-size: 9pt; } .n { text-align: right; white-space: nowrap; }
    tr.retest td { background: #fbf7ec; } .tag { background: #8a5a00; color: #fff; font-size: 7pt; padding: 1px 5px; border-radius: 3px; font-weight: 700; }
    .late { color: #8a3b12; }
    .tot { margin-left: auto; width: 300px; } .tot div { display: flex; justify-content: space-between; padding: 2px 0; }
    .tot .big { font-size: 13pt; font-weight: 700; color: #1f3a2c; border-top: 1px solid #c8d3cc; padding-top: 6px; margin-top: 4px; }
    h2 { font-size: 10.5pt; color: #1f3a2c; margin: 16px 0 4px; } .terms { font-size: 8.5pt; color: #5c6773; margin-top: 18px; border-top: 1px solid #e6ebe8; padding-top: 8px; }
    .banner { border: 2px solid #c68a00; color: #8a5a00; padding: 6px 10px; margin-bottom: 10px; font-weight: 700; }
    .reason { border-left: 3px solid #1f3a2c; padding: 4px 10px; margin: 6px 0 12px; background: #f6f8f7; }
  </style></head><body>
  ${preview || draft ? '<div class="banner">DRAFT: not issued. This is a preview for checking; the invoice number and date are given when it is issued.</div>' : ''}
  ${corrected ? `<div class="banner">CORRECTED COPY (${esc(dOnly(corrected.at))}): the PO number has changed from ${esc(corrected.old_value || 'none')} to ${esc(corrected.new_value || 'none')}. Nothing else on this invoice has changed.</div>` : ''}
  ${inv.catchup ? '<div class="banner">Catch-up invoice: work completed before invoicing moved into LIMS3, dated the Friday of the week its report was issued. Not sent to the client.</div>' : ''}
  <div class="head"><div><div class="brand">${esc(inv.site_name)}</div><div class="m">Tentamus North America${inv.site_address ? '<br>' + esc(inv.site_address) : ''}</div></div>
    <div><h1>${credit ? 'Credit note' : 'Invoice'}</h1><div class="meta">${esc(draft ? inv.draft_code + ' (draft)' : inv.invoice_number)}<br>
      Date: ${inv.invoice_date ? esc(dOnly(inv.invoice_date)) : 'when issued'}<br>
      ${credit ? `Credits invoice ${esc(inv.credits_number || '')}${inv.credits_date ? ' of ' + esc(dOnly(inv.credits_date)) : ''}` : `Due: ${inv.due_date ? esc(dOnly(inv.due_date)) : 'net ' + terms + ' days from the invoice date'}`}</div></div></div>
  <div class="to"><div><b>Bill to</b>${esc(inv.bill_to_name || inv.legal_name)}${(inv.bill_to_address || inv.billing_address) ? `<br><span class="m">${esc(inv.bill_to_address || inv.billing_address)}</span>` : ''}</div>
    <div><b>Order</b>${esc(inv.order_code)}${inv.po_number ? `<br>Your PO: ${esc(inv.po_number)}` : ''}</div>
    ${credit ? '' : `<div><b>Terms</b>${Number(terms) === 0 ? 'Due on receipt' : `Net ${esc(terms)} days`}</div>`}</div>
  ${credit && inv.reason ? `<div class="reason"><b>Reason:</b> ${esc(inv.reason)}</div>` : ''}
  <table><thead><tr><th>Sample</th><th>Test</th><th>Date</th><th class="n">List price</th><th class="n">Discount</th><th class="n">Price</th><th class="n">Rush</th><th class="n">Amount</th></tr></thead>
    <tbody>${lines.map(row).join('')}</tbody></table>
  <div class="tot">
    <div><span>List value</span><span>${money(inv.list_total)}</span></div>
    <div><span>Discounts</span><span>${money(-Number(inv.discount_total))}</span></div>
    <div><span>Rush fees</span><span>${money(inv.rush_total)}</span></div>
    <div class="big"><span>${credit ? 'Total credited' : 'Total due'}</span><span>${money(inv.total)}</span></div></div>
  ${inv.note ? `<h2>Note</h2><div>${esc(inv.note)}</div>` : ''}
  <div class="terms">${credit ? 'This credit note reduces the amount owed on the invoice named above.' : `<b>Payment.</b> ${inv.invoice_remit_to ? esc(inv.invoice_remit_to) : 'Please quote the invoice number with your payment. Payment details are available from our accounts team.'}`}
    Prices are in USD per sample and test, as quoted. Work is invoiced once its report has been issued${lines.some((l) => l.order_charge_id) ? '; kits, shipping and other charges when they are added' : ''}.${lines.some((l) => l.retest_of_id) ? ' Retests are listed with the test they repeat; a retest ordered by the laboratory for its own investigation is not charged.' : ''}</div>
  </body></html>`;
}

async function pdf(db, id, opts = {}) {
  const d = await data(db, id);
  const label = d.inv.status === 'Draft' ? `${d.inv.draft_code} · DRAFT, NOT ISSUED`
    : `${d.inv.invoice_number}${opts.corrected ? ' · corrected copy' : ''}${d.inv.catchup ? ' · catch-up copy from the record' : ''}`;
  const out = await COA.htmlToPdf(html(d, opts), `${label} · ${d.inv.site_name} · Tentamus North America`);
  return { ...out, data: d };
}

module.exports = { data, html, pdf, money };
