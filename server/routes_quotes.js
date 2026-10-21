// Standalone quotes (migration 029). A quote is a project of kind 'Quote', so the quote page, its lines, analytes,
// rush terms and specifications use the project routes in routes.js (/api/versions/...). Here: the quote list (with
// the project quotes), a new quote, sending it to the client (PDF + email with an accept/decline link), accepting or
// rejecting from the list, the PDF, and the client's page (no sign-in).
'use strict';
const { page, wantsPage } = require('./paging');
const Q = require('./quotes');

module.exports = function registerQuotes({ route, tx, currentSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS }) {
  const r = route;
  const base = () => (process.env.LIMS_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const versionOf = async (c, vid) => {
    if (!isUuid(vid)) throw new Error('Quote not found');
    const v = await c.db.one(`SELECT pv.id, pv.status::text AS status, pv.valid_until, pv.project_id, p.client_id, p.project_code, p.quote_contact_id, p.kind
      FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = $1`, [vid]);
    if (!v) throw new Error('Quote not found');
    return v;
  };

  // the list: every quote's and project's latest version (filters and "My open quotes" on the page)
  r('GET', '/api/quotes', async (c) => {
    const extra = { labs: await c.db.rows(`SELECT id, site_code, site_name FROM lab_site WHERE status = 'Active' ORDER BY site_code`),
      me: c.userId, can_edit: await hasPermission(c, 'quotes.edit') };
    if (!wantsPage(c)) return { rows: await c.db.rows(`SELECT * FROM quote_list_view ORDER BY COALESCE(sent_at, quoted_at, version_created_at) DESC`), ...extra };
    // one page at a time (0.35.0): the tab (mine / all), type, lab and who prepared it narrow the list; the status chips are the filters
    const q = c.query; const params = []; const where = [];
    const add = (cond, v) => { params.push(v); where.push(cond.replace('?', '$' + params.length)); };
    if (q.tab !== 'all') { add('owner_id = ?', c.userId); where.push('is_open'); }
    if (['Quote', 'Project', 'Stability'].includes(q.ty)) add('kind::text = ?', q.ty);
    if (isUuid(q.lab)) add(`site_ids::text LIKE '%' || ? || '%'`, q.lab);
    if (q.tab === 'all' && isUuid(q.own)) add('owner_id = ?', q.own);
    const sql = `SELECT *, COALESCE(sent_at, quoted_at, version_created_at) AS list_at FROM quote_list_view ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
    const d = await page(c, { sql, params,
      filters: q.tab !== 'all' ? { open: 'true' } : { open: 'is_open', waiting: `status::text = 'Quoted' AND NOT past_valid`, Accepted: `status::text = 'Accepted'`,
        Rejected: `status::text = 'Rejected'`, expired: `status::text = 'Expired' OR past_valid`, all: 'true' },
      search: ['project_code', 'project_name', 'client_name', 'owner_name', 'quote_contact_name', 'sent_to_name'],
      ids: ['project_code'], order: 'ORDER BY list_at DESC, project_code DESC' });
    const owners = await c.db.rows(`SELECT DISTINCT owner_id AS id, owner_name AS name FROM quote_list_view WHERE owner_id IS NOT NULL ORDER BY owner_name`);
    return { ...d, ...extra, owners };
  });

  // a new quote for a client (and the contact it is for); the first version starts as a Draft
  r('POST', '/api/quotes', (c) => tx({ ...c, reason: c.body.reason || 'New quote' }, async (t) => {
    const b = c.body || {};
    if (!isUuid(b.client_id)) throw new Error('Choose the client');
    const cl = await t.one('SELECT COALESCE(display_name, legal_name) AS name FROM client WHERE id = $1', [b.client_id]);
    const p = await t.one(`INSERT INTO project (client_id, project_name, purpose, kind, quote_contact_id) VALUES ($1, $2, $3, 'Quote', $4) RETURNING id, project_code`,
      [b.client_id, String(b.project_name || '').trim() || `Quote for ${cl.name}`, b.purpose || null, isUuid(b.quote_contact_id) ? b.quote_contact_id : null]);
    const v = await t.one('SELECT new_project_version($1) AS id', [p.id]);
    return { id: p.id, version_id: v.id, project_code: p.project_code };
  }));
  r('PUT', '/api/quotes/:id', (c) => tx({ ...c, reason: c.body.reason || 'Quote details changed' }, async (t) => {
    const b = c.body || {};
    await t.query(`UPDATE project SET project_name = COALESCE(NULLIF(btrim($2), ''), project_name), quote_contact_id = $3, owner_id = COALESCE($4, owner_id) WHERE id = $1 AND kind = 'Quote'`,
      [c.params.id, b.project_name || '', isUuid(b.quote_contact_id) ? b.quote_contact_id : null, isUuid(b.owner_id) ? b.owner_id : null]);
    return { ok: true };
  }));
  // who may own quotes (the people with quotes.edit somewhere)
  r('GET', '/api/quotes/people', async (c) => c.db.rows(`SELECT DISTINCT u.id, u.full_name FROM app_user u
     WHERE u.is_active AND NOT u.is_automated AND (u.is_admin OR EXISTS (SELECT 1 FROM group_member m JOIN group_permission gp ON gp.group_id = m.group_id AND gp.status = 'Active'
       WHERE m.user_id = u.id AND m.status = 'Active' AND gp.permission_code = 'quotes.edit')) ORDER BY u.full_name`));

  // the catalogue by lab, for the quote page's lab tabs. ?v=<version>: each test at the client's price on that quote
  // (another network lab's test is subcontracted: its price less the quoting lab's discount, plus its markup; 031)
  r('GET', '/api/quotes/catalog', async (c) => {
    const q = isUuid(c.query.v) ? await c.db.one(`SELECT p.site_id, s.subcontract_discount_pct AS d, s.subcontract_markup_pct AS m FROM project_version pv JOIN project p ON p.id = pv.project_id
      LEFT JOIN lab_site s ON s.id = p.site_id WHERE pv.id = $1`, [c.query.v]) : null;
    return c.db.rows(`SELECT tc.test_id, tc.test_code, tc.test_name, tc.pricing_mode, tc.list_price AS catalogue_price, tc.standard_tat, tc.tat_unit,
        tc.rush_schedule, t.site_id, s.site_code, s.site_name,
        ($1::uuid IS NOT NULL AND t.site_id IS NOT NULL AND t.site_id <> $1::uuid) AS subcontracted,
        CASE WHEN $1::uuid IS NOT NULL AND t.site_id IS NOT NULL AND t.site_id <> $1::uuid THEN (subcontract_price(tc.list_price, $2, $3)).price ELSE tc.list_price END AS list_price,
        EXISTS (SELECT 1 FROM test_version tv WHERE tv.test_id = t.id AND tv.status = 'Effective') AS orderable
      FROM test_catalogue tc JOIN test t ON t.id = tc.test_id LEFT JOIN lab_site s ON s.id = t.site_id
      WHERE tc.test_status = 'Active' ORDER BY tc.test_name`, [q ? q.site_id : null, q ? q.d : 20, q ? q.m : 30]);
  });

  // send to the client: issue it first if it is still a Draft, make the PDF, then record and queue the email
  r('POST', '/api/quotes/versions/:vid/send', async (c) => {
    const v = await versionOf(c, c.params.vid);
    const b = c.body || {};
    if (!isUuid(b.contact_id)) throw new Error('Choose who to send the quote to');
    const site = await currentSite(c);
    if (['Draft', 'Submitted for Quote'].includes(v.status)) {
      await tx({ ...c, reason: 'Quote issued' }, (t) => t.query(`UPDATE project_version SET status = 'Quoted', valid_until = $2 WHERE id = $1`, [v.id, b.valid_until || null]));
    } else if (v.status !== 'Quoted') throw new Error(`This version is ${v.status}: start a new version to send a new quote`);
    const pdf = await Q.pdf(c.db, v.id);
    return tx({ ...c, reason: 'Quote sent to the client' }, async (t) => {
      const d = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, 'application/pdf', $2, $3, decode($4, 'base64')) RETURNING id`,
        [`${pdf.data.v.project_code} v${pdf.data.v.version_no} quotation.pdf`, pdf.buf.length, pdf.sha256, pdf.buf.toString('base64')]);
      const m = await t.one('SELECT send_quote($1, $2, $3, $4, $5, $6, $7) AS id', [v.id, b.contact_id, d.id, pdf.sha256, site, b.message || '', base()]);
      const tok = await t.one('SELECT client_token FROM project_version WHERE id = $1', [v.id]);
      return { email_id: m.id, link: `${base()}/quote-response.html?t=${tok.client_token}` };
    });
  });
  // accept or reject from the list or the quote page (the lab records the client's answer)
  r('POST', '/api/quotes/versions/:vid/decide', async (c) => {
    const v = await versionOf(c, c.params.vid);
    const b = c.body || {};
    if (b.decision === 'Accepted') {
      return tx({ ...c, reason: b.reason || 'Client accepted the quote' }, (t) => t.query(`UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = $2,
        client_response_note = NULLIF(btrim($3), '') WHERE id = $1`, [v.id, isUuid(b.contact_id) ? b.contact_id : null, b.note || '']));
    }
    if (b.decision === 'Rejected') {
      if (!String(b.note || '').trim()) throw new Error('Say why the quote was rejected (price, turnaround, went elsewhere...)');
      return tx({ ...c, reason: 'Client rejected the quote' }, (t) => t.query(`UPDATE project_version SET status = 'Rejected', rejected_reason = btrim($2) WHERE id = $1`, [v.id, b.note]));
    }
    throw new Error('Accept or reject the quote');
  });
  // the quotation PDF: the one last sent, or a preview of the version as it stands
  r('GET', '/api/quotes/versions/:vid/pdf', async (c) => {
    const v = await versionOf(c, c.params.vid);
    const sent = await c.db.one(`SELECT encode(f.content, 'base64') AS b64, f.file_name FROM project_version pv JOIN document_file f ON f.id = pv.quote_document_id WHERE pv.id = $1`, [v.id]);
    const fresh = !sent || c.query.fresh;
    const buf = fresh ? (await Q.pdf(c.db, v.id, { preview: ['Draft', 'Submitted for Quote'].includes(v.status) })).buf : Buffer.from(sent.b64, 'base64');
    return { __raw: true, body: buf, type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${v.project_code} quotation.pdf"` } };
  });

  // the client's page (no sign-in): the quotation behind the link, and their answer recorded as the system
  r('GET', '/api/public/quote/:token', async (c) => {
    const tok = String(c.params.token || '').slice(0, 80);
    const v = await c.db.one('SELECT id FROM project_version WHERE client_token = $1', [tok]);
    if (!v) return { found: false };
    const d = await Q.data(c.db, v.id);
    const x = d.v;
    return { found: true, quote_code: x.project_code, version_no: x.version_no, status: x.status, client_name: x.client_legal_name, contact: x.sent_to_name,
      prepared_by: x.owner_name, quoted_at: x.quoted_at, valid_until: x.valid_until, valid_until_text: Q.dOnly(x.valid_until),
      expired: !!(x.valid_until && String(x.valid_until).slice(0, 10) < new Date().toISOString().slice(0, 10)),
      decided_via: x.decided_via, response_name: x.client_response_name, notes: x.notes,
      lines: d.lines.map((l) => ({ test_name: l.test_name, lab: l.site_name, quantity: l.quantity, list_price: l.list_price, final_price: l.final_price, line_total: l.line_total,
        tat: `${l.standard_tat} ${l.tat_unit === 'Business Days' ? 'business' : 'calendar'} days`, analytes: l.pricing_mode === 'Analyte Selection' ? `${l.analytes_included} of ${l.analytes_total} analytes` : '' })),
      total: d.lines.reduce((s, l) => s + Number(l.line_total || 0), 0) };
  });
  r('GET', '/api/public/quote/:token/pdf', async (c) => {
    const v = await c.db.one(`SELECT pv.id, p.project_code, encode(f.content, 'base64') AS b64 FROM project_version pv JOIN project p ON p.id = pv.project_id
      JOIN document_file f ON f.id = pv.quote_document_id WHERE pv.client_token = $1`, [String(c.params.token || '').slice(0, 80)]);
    if (!v) throw new Error('Not found');
    return { __raw: true, body: Buffer.from(v.b64, 'base64'), type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${v.project_code} quotation.pdf"` } };
  });
  r('POST', '/api/public/quote/:token', async (c) => {
    const sys = await c.db.one(`SELECT id FROM app_user WHERE username = 'system'`);
    const out = await c.db.tx({ userId: sys.id, reason: 'Client answer through the quote link' }, (t) => t.one('SELECT record_quote_response($1, $2, $3, $4) AS code',
      [String(c.params.token || '').slice(0, 80), c.body.decision || '', String(c.body.name || '').slice(0, 200), String(c.body.note || '').slice(0, 2000)]));
    return { ok: true, quote_code: out.code };
  });

  AUDIT_SCOPES.quote = `SELECT 'project', $1::uuid UNION ALL SELECT 'project_version', id FROM project_version WHERE project_id = $1
    UNION ALL SELECT 'quoted_test_configuration', q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id WHERE pv.project_id = $1
    UNION ALL SELECT 'quote_rush_term', r.id FROM quote_rush_term r JOIN project_version pv ON pv.id = r.project_version_id WHERE pv.project_id = $1`;
  AUDIT_LISTS.quotes = ['project', 'project_version', 'quoted_test_configuration', 'email_outbox'];
};
