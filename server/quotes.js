// Standalone quotes (migration 029): the quotation as the client receives it (PDF, made by the server with the same
// headless Chromium as the COA), and the data behind it. Used for projects' quotes too (same tables).
'use strict';
const COA = require('./coa');
const { esc, fmtDate } = COA;

const money = (v) => (v === null || v === undefined || v === '' ? '' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dOnly = (d) => { if (!d) return ''; const m = String(d instanceof Date ? d.toISOString() : d).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }) : fmtDate(d); };
const days = (n, unit) => `${n} ${unit === 'Business Days' ? 'business' : 'calendar'} day${Number(n) === 1 ? '' : 's'}`;

// Everything the quotation shows, from the record
async function data(db, vid) {
  const v = await db.one(`SELECT pv.*, p.project_code, p.project_name, p.purpose, p.kind, p.client_id, p.is_list_price_acceptance,
      COALESCE(cl.display_name, cl.legal_name) AS client_name, cl.legal_name AS client_legal_name, cl.billing_address,
      ou.full_name AS owner_name, qu.full_name AS quoted_by_name,
      NULLIF(btrim(COALESCE(qc.first_name, '') || ' ' || COALESCE(qc.last_name, '')), '') AS quote_contact_name, qc.email AS quote_contact_email,
      NULLIF(btrim(COALESCE(sc.first_name, '') || ' ' || COALESCE(sc.last_name, '')), '') AS sent_to_name
    FROM project_version pv JOIN project p ON p.id = pv.project_id JOIN client cl ON cl.id = p.client_id
    LEFT JOIN app_user ou ON ou.id = COALESCE(p.owner_id, p.created_by) LEFT JOIN app_user qu ON qu.id = pv.quoted_by
    LEFT JOIN contact qc ON qc.id = p.quote_contact_id LEFT JOIN contact sc ON sc.id = pv.sent_to_contact_id WHERE pv.id = $1`, [vid]);
  if (!v) throw new Error('Quote version not found');
  // a subcontracted test is shown as such (ISO 17025: the client is told which work is subcontracted; 031)
  const lines = await db.rows(`SELECT r.*, COALESCE(s.site_code, '') AS site_code,
      COALESCE(s.site_name, 'Our laboratory') || CASE WHEN q.is_subcontracted THEN ' (subcontracted within Tentamus)' ELSE '' END AS site_name
    FROM quote_line_review r JOIN test t ON t.test_code = r.test_code JOIN quoted_test_configuration q ON q.id = r.line_id LEFT JOIN lab_site s ON s.id = t.site_id
    WHERE r.project_version_id = $1 AND q.quoted_package_id IS NULL ORDER BY q.is_subcontracted, s.site_code NULLS LAST, r.test_name`, [vid]);
  const rush = await db.rows('SELECT * FROM quote_rush_term WHERE project_version_id = $1 ORDER BY schedule_name, rush_tat', [vid]);
  // packages (047): one line each, its tests listed under it
  const packages = await db.rows(`SELECT qp.*, (SELECT string_agg(t.test_name, ', ' ORDER BY q.created_at) FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
      WHERE q.quoted_package_id = qp.id AND q.status = 'Active') AS tests FROM quoted_package qp WHERE qp.project_version_id = $1 AND qp.status = 'Active' ORDER BY qp.created_at`, [vid]);
  // charges (058): kits, shipping, fees and discounts at this client's price
  const charges = await db.rows(`SELECT qc.quantity, qc.list_price, qc.unit_price, qc.note, ci.charge_name, ci.kind, charge_sign(ci.kind) AS sign
    FROM quoted_charge qc JOIN charge_item ci ON ci.id = qc.charge_item_id WHERE qc.project_version_id = $1 AND qc.status = 'Active' ORDER BY ci.kind = 'Discount', ci.charge_name`, [vid]);
  return { v, lines, rush, packages, charges };
}

function html({ v, lines, rush, packages = [], charges = [] }, { preview = false } = {}) {
  const total = lines.reduce((s, l) => s + Number(l.line_total || 0), 0) + packages.reduce((s, p) => s + Number(p.package_price) * Number(p.quantity), 0);
  const listTotal = lines.reduce((s, l) => s + Number(l.list_price) * Number(l.quantity), 0) + packages.reduce((s, p) => s + Number(p.list_price) * Number(p.quantity), 0);
  const pkgRows = packages.map((p) => `<tr class="pkg"><td><b>${esc(p.package_name)}</b> <span class="m">(${esc(p.package_code)}, package)</span><div class="m">Includes: ${esc(p.tests || '')}</div></td>
    <td class="n">${p.quantity}</td><td class="n">${money(p.list_price)}</td><td class="n">${money(p.package_price)}</td>
    <td class="n">${Number(p.list_price) > 0 && Number(p.package_price) < Number(p.list_price) ? ((1 - p.package_price / p.list_price) * 100).toFixed(1) + '%' : '-'}</td><td class="n">${money(p.package_price * p.quantity)}</td><td></td></tr>`).join('');
  const labs = [...new Set(lines.map((l) => l.site_name))];
  const byLab = labs.length > 1;
  const scheds = [...new Set(rush.map((r) => r.schedule_name))];
  const row = (l) => `<tr><td><b>${esc(l.test_name)}</b>${l.pricing_mode === 'Analyte Selection' ? `<div class="m">${l.analytes_included} of ${l.analytes_total} analytes</div>` : ''}${l.special_instructions ? `<div class="m">${esc(l.special_instructions)}</div>` : ''}</td>
    <td class="n">${l.quantity}</td><td class="n">${money(l.list_price)}</td><td class="n">${money(l.final_price)}</td>
    <td class="n">${l.final_price === null ? '' : Number(l.discount_pct || 0) ? Number(l.discount_pct).toFixed(1) + '%' : '-'}</td><td class="n">${money(l.line_total)}</td>
    <td>${esc(days(l.standard_tat, l.tat_unit))}</td></tr>`;
  const body = byLab ? labs.map((lab) => { const ls = lines.filter((l) => l.site_name === lab); const sub = ls.reduce((s, l) => s + Number(l.line_total || 0), 0);
    return `<tr class="lab"><td colspan="7">${esc(lab)}</td></tr>${ls.map(row).join('')}<tr class="sub"><td colspan="5" class="n">Subtotal, ${esc(lab)}</td><td class="n">${money(sub)}</td><td></td></tr>`; }).join('')
    : lines.map(row).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 10pt Helvetica, Arial, sans-serif; color: #1d2329; margin: 0; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #1f3a2c; padding-bottom: 10px; margin-bottom: 14px; }
    .brand { font-size: 17pt; font-weight: 700; color: #1f3a2c; } .m { color: #5c6773; font-size: 8.5pt; }
    h1 { margin: 0; font-size: 18pt; color: #1f3a2c; text-align: right; } .meta { text-align: right; font-size: 9pt; }
    .to { display: flex; gap: 40px; margin-bottom: 14px; } .to div { min-width: 200px; } .to b { display: block; color: #5c6773; font-size: 8.5pt; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; } th { background: #eef3f0; text-align: left; font-size: 8.5pt; padding: 5px; border-bottom: 1px solid #c8d3cc; }
    td { padding: 5px; border-bottom: 1px solid #e6ebe8; vertical-align: top; font-size: 9pt; } .n { text-align: right; white-space: nowrap; }
    tr.lab td { background: #f6f8f7; font-weight: 700; color: #1f3a2c; } tr.sub td { font-weight: 700; border-bottom: 1px solid #c8d3cc; }
    .tot { display: flex; justify-content: flex-end; gap: 24px; font-size: 10pt; } .tot .big { font-size: 13pt; font-weight: 700; color: #1f3a2c; }
    h2 { font-size: 11pt; color: #1f3a2c; margin: 16px 0 4px; } .terms { font-size: 8.5pt; color: #5c6773; margin-top: 18px; border-top: 1px solid #e6ebe8; padding-top: 8px; }
    .draft { border: 2px solid #c68a00; color: #8a5a00; padding: 6px 10px; margin-bottom: 10px; font-weight: 700; }
  </style></head><body>
  ${preview ? '<div class="draft">PREVIEW: not issued. Prices are final only when the quotation is issued.</div>' : ''}
  <div class="head"><div><div class="brand">Tentamus North America</div><div class="m">Laboratory testing services${labs.length ? ' · ' + esc(labs.join(' · ')) : ''}</div></div>
    <div><h1>Quotation</h1><div class="meta">${esc(v.project_code)} · version ${v.version_no}<br>Issued: ${v.quoted_at ? esc(fmtDate(v.quoted_at)) : 'not yet issued'}<br>Valid until: ${v.valid_until ? esc(dOnly(v.valid_until)) : 'no expiry date'}</div></div></div>
  <div class="to"><div><b>Prepared for</b>${esc(v.client_legal_name)}${v.quote_contact_name ? `<br>Attn: ${esc(v.quote_contact_name)}` : ''}${v.billing_address ? `<br><span class="m">${esc(v.billing_address)}</span>` : ''}</div>
    <div><b>Prepared by</b>${esc(v.owner_name || '')}</div>
    ${v.kind === 'Project' ? `<div><b>Project</b>${esc(v.project_name)}${v.purpose ? `<br><span class="m">${esc(v.purpose)}</span>` : ''}</div>` : v.project_name ? `<div><b>Reference</b>${esc(v.project_name)}</div>` : ''}</div>
  <table><thead><tr><th>Test</th><th class="n">Qty</th><th class="n">List price</th><th class="n">Your price</th><th class="n">Discount</th><th class="n">Line total</th><th>Standard turnaround</th></tr></thead>
    <tbody>${pkgRows}${body}</tbody></table>
  <div class="tot"><span>List value ${money(listTotal)}</span><span>You save ${money(listTotal - total)}</span><span class="big">Total ${money(total)}</span></div>
  ${charges.length ? `<h2>Other charges</h2><table><thead><tr><th>Charge</th><th class="n">Qty</th><th class="n">List price</th><th class="n">Your price</th><th class="n">Total</th></tr></thead><tbody>
    ${charges.map((x) => `<tr><td><b>${esc(x.charge_name)}</b> <span class="m">(${esc(x.kind)})</span>${x.note ? `<div class="m">${esc(x.note)}</div>` : ''}</td><td class="n">${x.quantity}</td>
      <td class="n">${money(x.sign * x.list_price)}</td><td class="n">${money(x.sign * x.unit_price)}</td><td class="n">${money(x.sign * x.unit_price * x.quantity)}</td></tr>`).join('')}</tbody></table>
    <p class="m">Charges are invoiced when they are added to an order (for example, shipping when a kit is sent); a discount is taken off the invoice it is added to.</p>` : ''}
  ${scheds.length ? `<h2>Rush options</h2><table><thead><tr><th>Schedule</th><th>Tier</th><th>Turnaround</th><th class="n">Surcharge</th><th class="n">Your rush discount</th></tr></thead><tbody>
    ${rush.map((r) => `<tr><td>${esc(r.schedule_name)}</td><td>${esc(r.tier_name)}</td><td>${esc(days(r.rush_tat, r.tat_unit))}</td>
      <td class="n">${r.surcharge_type === 'Flat' ? money(r.surcharge_value) : Number(r.surcharge_value) + '% of price'}</td><td class="n">${Number(r.discount_pct) ? Number(r.discount_pct) + '%' : '-'}</td></tr>`).join('')}</tbody></table>` : ''}
  ${v.notes ? `<h2>Notes</h2><div>${esc(v.notes)}</div>` : ''}
  <div class="terms"><b>Terms.</b> Prices are per sample in USD. Testing is performed against an accepted quotation at the prices shown; each test is performed at the laboratory named. Standard turnaround is the maximum, counted from the day samples are logged (Day 0); samples received after a test's cutoff time start the next working day.</div>
  </body></html>`;
}

async function pdf(db, vid, opts = {}) {
  const d = await data(db, vid);
  if (d.v.kind === 'Stability') { // a stability quote (migration 032): the study matrix, dates and price by year
    const S = require('./stability');
    const sd = { ...d, design: await S.design(db, vid) };
    const out = await COA.htmlToPdf(S.quoteHtml(sd, opts), `${d.v.project_code} v${d.v.version_no} · stability study · Tentamus North America${opts.preview ? ' · PREVIEW, NOT ISSUED' : ''}`);
    return { ...out, data: d };
  }
  const out = await COA.htmlToPdf(html(d, opts), `${d.v.project_code} v${d.v.version_no} · Tentamus North America${opts.preview ? ' · PREVIEW, NOT ISSUED' : ''}`);
  return { ...out, data: d };
}

module.exports = { data, html, pdf, money, dOnly };
