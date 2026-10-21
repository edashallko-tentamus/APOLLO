// Invoicing (I-1, migration 036): Billing. Work ready to invoice (its COA issued), claimed into the reviewer's own
// draft per lab order; the draft checked (price, late rush, PO, note) and issued (signed "Invoiced by"); the PDF made
// and attached in the issuing transaction, emailed to the client's billing contacts and queued for the lab's
// QuickBooks Online company; credit notes (signed "Credited by"); the order's billing; settings (payment terms,
// the accounting connection). Thin: every rule lives in the database.
'use strict';
const { page, wantsPage } = require('./paging');
const INV = require('./invoices');

module.exports = function registerInvoicing({ route, tx, signedTx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS }) {
  const r = route;
  const needView = async (c, site) => {
    if (!(await hasPermission(c, 'invoicing.view', site)) && !(await hasPermission(c, 'invoicing.issue', site))) {
      throw new Error('You do not have permission to see invoicing in this lab (invoicing.view). Ask your lab administrator.');
    }
  };
  const perms = async (c, site) => ({ can_issue: await hasPermission(c, 'invoicing.issue', site), can_release_any: await hasPermission(c, 'admin.users', site) });
  const invoiceOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Invoice not found');
    const i = await c.db.one('SELECT * FROM invoice_view WHERE id = $1', [id]);
    if (!i) throw new Error('Invoice not found');
    await checkSite(c, i.site_id);
    await needView(c, i.site_id);
    return i;
  };
  const uuids = (a) => (Array.isArray(a) ? a.filter(isUuid) : []);

  // the PDF for an issued invoice, made inside the issuing transaction, attached and sent
  async function attachAndSend(t, id) {
    const p = await INV.pdf(t, id);
    const d = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, 'application/pdf', $2, $3, decode($4, 'base64')) RETURNING id`,
      [`${p.data.inv.invoice_number}.pdf`, p.buf.length, p.sha256, p.buf.toString('base64')]);
    await t.query('SELECT record_invoice_document($1, $2, $3)', [id, d.id, p.sha256]);
    const s = await t.one('SELECT send_invoice($1) AS n', [id]);
    return { id, invoice_number: p.data.inv.invoice_number, emails: Number(s.n) };
  }

  // Ready to invoice (this lab)
  r('GET', '/api/billing/ready', async (c) => {
    const site = await currentSite(c);
    await needView(c, site);
    const rows = await c.db.rows(`SELECT requested_test_id, sample_id, sample_code, client_sample_id, lab_order_id, order_code, po_number, client_id, client_name,
        test_code, test_name, list_price, price, discount, rush_fee, rush_status, rush_tier_name, due_date, completed_on, late_days, amount, is_retest, retest_of,
        oos_code, was_retested, billing_status, (stability_pull_id IS NOT NULL) AS stability
      FROM invoice_ready_view WHERE site_id = $1 ORDER BY completed_on, order_code, sample_code, test_name`, [site]);
    return { rows, ...(await perms(c, site)), me: c.userId };
  });

  // Drafts and issued invoices (this lab): mine, everyone's drafts, issued (last N days), the QuickBooks queue
  r('GET', '/api/billing/invoices', async (c) => {
    const site = await currentSite(c);
    await needView(c, site);
    const tab = String(c.query.tab || 'issued');
    const days = Math.min(Math.max(parseInt(c.query.days, 10) || 120, 1), 3660);
    let rows;
    if (tab === 'mine') rows = await c.db.rows(`SELECT * FROM invoice_view WHERE site_id = $1 AND status = 'Draft' AND claimed_by = $2 ORDER BY created_at`, [site, c.userId]);
    else if (tab === 'drafts') rows = await c.db.rows(`SELECT * FROM invoice_view WHERE site_id = $1 AND status = 'Draft' ORDER BY created_at`, [site]);
    else if (tab === 'queue') rows = await c.db.rows(`SELECT p.id AS push_id, p.status AS push_status, p.entity, p.provider, p.attempts, p.last_error, p.sent_at AS pushed_at, p.created_at AS queued_at,
        i.id, i.code, i.kind, i.client_name, i.order_code, i.invoice_date, i.total FROM accounting_push p JOIN invoice_view i ON i.id = p.invoice_id
        WHERE p.site_id = $1 ORDER BY p.created_at DESC LIMIT 500`, [site]);
    else if (wantsPage(c)) {
      // issued invoices and credit notes, one page at a time, newest first (0.35.0)
      const d = await page(c, { sql: `SELECT * FROM invoice_view WHERE site_id = $1 AND status = 'Issued'`, params: [site],
        filters: { all: 'true', invoices: `kind::text = 'Invoice'`, credits: `kind::text <> 'Invoice'`, unpaid: `kind::text = 'Invoice' AND COALESCE(credited, 0) = 0` },
        search: ['code', 'invoice_number', 'client_name', 'order_code', 'po_number', 'issued_by_name'], ids: ['code', 'invoice_number', 'order_code'],
        order: 'ORDER BY invoice_date DESC, invoice_number DESC',
        aggregate: `COALESCE(sum(total) FILTER (WHERE kind::text = 'Invoice'), 0) AS invoiced, COALESCE(-sum(total) FILTER (WHERE kind::text <> 'Invoice'), 0) AS credited, count(*) FILTER (WHERE kind::text = 'Invoice')::int AS invoices` });
      return { ...d, ...(await perms(c, site)), me: c.userId };
    } else rows = await c.db.rows(`SELECT * FROM invoice_view WHERE site_id = $1 AND status = 'Issued' AND invoice_date >= site_today($1) - $2::int
        ORDER BY invoice_date DESC, invoice_number DESC LIMIT 2000`, [site, days]);
    return { rows, ...(await perms(c, site)), me: c.userId };
  });

  r('POST', '/api/billing/claim', async (c) => {
    await currentSite(c);
    const tests = uuids(c.body.tests);
    const out = await tx({ ...c, reason: c.reason || 'Work claimed for invoicing' }, (t) => t.one('SELECT claim_invoice_work($1::uuid[], $2) AS ids', [tests, c.body.note || null]));
    const ids = Array.isArray(out.ids) ? out.ids : String(out.ids || '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
    return { invoices: ids };
  });

  r('GET', '/api/billing/invoices/:id', async (c) => {
    const i = await invoiceOf(c, c.params.id);
    const lines = await c.db.rows(`SELECT l.*, rt.sample_id, s.lab_order_id, (SELECT x.oos_code FROM oos_investigation x JOIN requested_test r2 ON r2.oos_investigation_id = x.id WHERE r2.id = l.requested_test_id) AS oos_code,
        (SELECT ci.invoice_number FROM invoice_line cl JOIN invoice ci ON ci.id = cl.invoice_id WHERE cl.credits_line_id = l.id AND ci.status = 'Issued') AS credited_by
      FROM invoice_line l JOIN requested_test rt ON rt.id = l.requested_test_id JOIN sample s ON s.id = rt.sample_id
      WHERE l.invoice_id = $1 AND l.status = 'Active' ORDER BY l.line_no`, [i.id]);
    if (i.status === 'Draft') {
      for (const l of lines) {
        if (l.rush_ordered || Number(l.late_days) > 0) l.rush_options = await c.db.rows('SELECT * FROM invoice_rush_options($1, $2)', [l.requested_test_id, l.completed_on]);
      }
    }
    const credits = await c.db.rows(`SELECT id, code, invoice_date, total, reason FROM invoice_view WHERE credit_of_id = $1 AND status = 'Issued' ORDER BY issued_at`, [i.id]);
    const emails = await c.db.rows(`SELECT id, to_address, subject, created_at FROM email_outbox WHERE document_id = $1 AND $1 IS NOT NULL ORDER BY created_at`, [i.document_id]);
    const push = await c.db.one('SELECT id, status, entity, provider, payload, attempts, last_error, sent_at, created_at FROM accounting_push WHERE invoice_id = $1', [i.id]);
    return { invoice: i, lines, credits, emails, push, ...(await perms(c, i.site_id)), me: c.userId };
  });

  r('PUT', '/api/billing/invoices/:id', async (c) => {
    const i = await invoiceOf(c, c.params.id);
    await tx({ ...c, reason: c.reason || 'Draft invoice checked' }, (t) => t.query('SELECT update_invoice_draft($1, $2, $3, $4)', [i.id, c.body.po_number || '', c.body.note || '', c.body.internal_note || '']));
  });
  r('POST', '/api/billing/lines/:id/price', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Invoice line not found');
    const l = await c.db.one('SELECT invoice_id FROM invoice_line WHERE id = $1', [c.params.id]);
    if (!l) throw new Error('Invoice line not found');
    await invoiceOf(c, l.invoice_id);
    const price = Number(c.body.price);
    if (!Number.isFinite(price)) throw new Error('Type the price');
    await tx({ ...c, reason: c.reason || 'Invoice price corrected' }, (t) => t.query('SELECT set_invoice_line_price($1, $2, $3)', [c.params.id, price, c.body.note || '']));
  });
  r('POST', '/api/billing/lines/:id/rush', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Invoice line not found');
    const l = await c.db.one('SELECT invoice_id FROM invoice_line WHERE id = $1', [c.params.id]);
    if (!l) throw new Error('Invoice line not found');
    await invoiceOf(c, l.invoice_id);
    await tx({ ...c, reason: c.reason || 'Rush billed at the tier met' }, (t) => t.query('SELECT set_invoice_line_rush($1, $2, $3)', [c.params.id, isUuid(c.body.tier_id) ? c.body.tier_id : null, c.body.note || '']));
  });
  r('POST', '/api/billing/lines/remove', async (c) => {
    const lines = uuids(c.body.lines);
    if (lines.length) {
      const one = await c.db.one('SELECT invoice_id FROM invoice_line WHERE id = $1', [lines[0]]);
      if (one) await invoiceOf(c, one.invoice_id);
    }
    const n = await tx({ ...c, reason: c.reason || 'Taken off the draft invoice' }, (t) => t.one('SELECT remove_invoice_lines($1::uuid[]) AS n', [lines]));
    return { removed: Number(n.n) };
  });
  r('POST', '/api/billing/invoices/:id/release', async (c) => {
    const i = await invoiceOf(c, c.params.id);
    await tx({ ...c, reason: c.reason || 'Draft invoice released' }, (t) => t.query('SELECT release_invoice_draft($1)', [i.id]));
  });

  // Issue checked drafts: one signature ("Invoiced by"); each PDF made, attached, emailed and queued in the same transaction
  r('POST', '/api/billing/issue', async (c) => {
    const ids = uuids(c.body.ids);
    if (!ids.length) throw new Error('Choose the draft invoices to issue');
    for (const id of ids) await invoiceOf(c, id);
    const sent = await signedTx({ ...c, reason: c.reason || 'Invoice issued' }, { meaning: 'Invoiced by', action: `Issued ${ids.length} invoice${ids.length > 1 ? 's' : ''}`, module: 'Invoicing' }, async (t) => {
      await t.query('SELECT issue_invoices($1::uuid[])', [ids]);
      const out = [];
      for (const id of ids) out.push(await attachAndSend(t, id));
      return out;
    });
    return { issued: sent };
  });

  // Credit an issued invoice (all its lines or some); the work invoiced again or not
  r('POST', '/api/billing/invoices/:id/credit', async (c) => {
    const i = await invoiceOf(c, c.params.id);
    const lines = Array.isArray(c.body.lines) && c.body.lines.length ? uuids(c.body.lines) : null;
    const why = String(c.body.credit_reason || '').trim();
    const out = await signedTx({ ...c, reason: c.reason || 'Credit note issued' }, { meaning: 'Credited by', action: `Credit note for ${i.invoice_number}`, module: 'Invoicing' }, async (t) => {
      const cn = await t.one('SELECT credit_invoice($1, $2::uuid[], $3, $4) AS id', [i.id, lines, !!c.body.rebill, why]);
      return attachAndSend(t, cn.id);
    });
    return { credit_note: out };
  });

  // The PDF: as issued (stored), or for a draft or a catch-up invoice made from the record
  r('GET', '/api/billing/invoices/:id/pdf', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    const i = await invoiceOf(c, c.params.id);
    if (i.document_id) {
      const d = await c.db.one(`SELECT encode(content, 'base64') AS b64 FROM document_file WHERE id = $1`, [i.document_id]);
      return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${i.code}.pdf"` } };
    }
    const p = await INV.pdf(c.db, i.id, { preview: i.status === 'Draft' });
    return { __raw: true, body: p.buf, type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${i.code}${i.status === 'Draft' ? ' draft' : ''}.pdf"` } };
  });

  // The order's billing (order page; later the client portal)
  r('GET', '/api/orders/:id/billing', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Order not found');
    const o = await c.db.one('SELECT id, site_id FROM lab_order WHERE id = $1', [c.params.id]);
    if (!o) throw new Error('Order not found');
    await checkSite(c, o.site_id);
    if (!(await hasPermission(c, 'invoicing.view', o.site_id)) && !(await hasPermission(c, 'invoicing.issue', o.site_id))) return { allowed: false };
    const tests = await c.db.rows('SELECT * FROM order_billing($1)', [o.id]);
    const invoices = await c.db.rows(`SELECT id, code, kind, status, invoice_date, total, claimed_by_name, catchup, credits_number FROM invoice_view
      WHERE lab_order_id = $1 AND status IN ('Draft','Issued') ORDER BY COALESCE(invoice_date, created_at::date), code`, [o.id]);
    return { allowed: true, tests, invoices };
  });

  // Settings: clients' payment terms (invoicing.issue), the lab's accounting connection and remit-to (system administrators)
  r('GET', '/api/billing/settings', async (c) => {
    const site = await currentSite(c);
    await needView(c, site);
    const conn = await c.db.one('SELECT * FROM accounting_connection WHERE site_id = $1', [site]);
    const lab = await c.db.one('SELECT id, site_code, site_name, invoice_remit_to FROM lab_site WHERE id = $1', [site]);
    const clients = await c.db.rows(`SELECT c.id, c.client_code, COALESCE(c.display_name, c.legal_name) AS client_name, c.payment_terms_days,
        (SELECT string_agg(ct.email, ', ') FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id WHERE cc.client_id = c.id AND cc.status = 'Active' AND 'BILLING' = ANY (cc.roles)) AS billing_emails
      FROM client c WHERE NOT c.is_internal AND c.account_status <> 'Inactive' ORDER BY 3`);
    const me = await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]);
    return { connection: conn, lab, clients, ...(await perms(c, site)), is_admin: !!(me && me.is_admin) };
  });
  r('POST', '/api/billing/settings/terms', async (c) => {
    await currentSite(c);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    await tx({ ...c, reason: c.reason || 'Payment terms changed' }, async (t) => {
      for (const x of rows) {
        if (!isUuid(x.id)) continue;
        await t.query('SELECT set_client_payment_terms($1, $2)', [x.id, parseInt(x.payment_terms_days, 10)]);
      }
    });
  });
  r('PUT', '/api/billing/settings/connection', async (c) => {
    const site = await currentSite(c);
    const b = c.body || {};
    await tx({ ...c, reason: c.reason || 'Accounting connection changed' }, async (t) => {
      await t.query(`UPDATE accounting_connection SET provider = COALESCE($2, provider), company_name = NULLIF(btrim($3), ''), company_id = NULLIF(btrim($4), ''),
          environment = COALESCE($5, environment), item_name = COALESCE(NULLIF(btrim($6), ''), item_name) WHERE site_id = $1`,
        [site, b.provider || null, b.company_name || '', b.company_id || '', b.environment || null, b.item_name || '']);
      if (b.invoice_remit_to !== undefined) await t.query('UPDATE lab_site SET invoice_remit_to = NULLIF(btrim($2), \'\') WHERE id = $1', [site, b.invoice_remit_to]);
    });
  });

  AUDIT_SCOPES.invoice = `SELECT 'invoice', $1::uuid UNION ALL SELECT 'invoice_line', id FROM invoice_line WHERE invoice_id = $1
    UNION ALL SELECT 'accounting_push', id FROM accounting_push WHERE invoice_id = $1`;
  AUDIT_CHECKS.invoice = async (c, id) => { await invoiceOf(c, id); };
  AUDIT_LISTS.billing = ['invoice', 'invoice_line', 'accounting_push', 'accounting_connection', 'accounting_customer'];
};
