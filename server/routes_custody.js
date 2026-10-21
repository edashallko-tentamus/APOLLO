// The chain of custody, receipts and sample photos (0.29.0, migration 051)
'use strict';
const CUS = require('./custody');

module.exports = function registerCustody({ route, signedTx, tx, checkSite, hasPermission, isUuid, AUDIT_SCOPES }) {
  const base = () => (process.env.LIMS_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const orderSite = async (c, id) => {
    if (!isUuid(id)) throw new Error('Order not found');
    const o = await c.db.one('SELECT id, site_id, order_code FROM lab_order WHERE id = $1', [id]);
    if (!o) throw new Error('Order not found');
    await checkSite(c, o.site_id);
    return o;
  };
  const sampleSite = async (c, id) => {
    if (!isUuid(id)) throw new Error('Sample not found');
    const s = await c.db.one('SELECT s.id, s.lab_order_id, o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = $1', [id]);
    if (!s) throw new Error('Sample not found');
    await checkSite(c, s.site_id);
    return s;
  };
  const file = (b64) => Buffer.from(String(b64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  const raw = (d, name) => ({ __raw: true, body: Buffer.from(d.b64, 'base64'), type: d.mime_type, headers: { 'Content-Disposition': `inline; filename="${String(name || d.file_name || 'file').replace(/[^\w.\- ]/g, '_')}"` } });

  // the order's chain of custody: its receipts, the paper copies, who may receive
  route('GET', '/api/orders/:id/custody', async (c) => {
    const o = await orderSite(c, c.params.id);
    const doc = await c.db.one('SELECT * FROM custody_document WHERE lab_order_id = $1', [o.id]);
    const events = doc ? await c.db.rows('SELECT id, event_no, kind, event_at, delivered_by, tracking_no, temperature::text AS temperature, condition, seals, note, by_name, sample_codes, sample_count, document_id, created_at FROM custody_event_view WHERE custody_document_id = $1 ORDER BY event_no', [doc.id]) : [];
    const me = await c.db.one('SELECT title, signature_document_id IS NOT NULL AS has_sig FROM app_user WHERE id = $1', [c.userId]);
    const lab = await c.db.one('SELECT custody_signature_required FROM lab_site WHERE id = $1', [o.site_id]);
    return { document: doc, events, can_receive: await hasPermission(c, 'orders.edit'), my_signature: !!(me && me.has_sig && me.title), required: !!(lab && lab.custody_signature_required) };
  });
  // the chain of custody as it stands now (printed to travel with the samples)
  route('GET', '/api/orders/:id/custody.pdf', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    const o = await orderSite(c, c.params.id);
    const d = await CUS.data(c.db, o.id, { verifyBase: base() });
    const p = await CUS.pdf(d);
    return { __raw: true, body: p.buf, type: 'application/pdf', headers: { 'Content-Disposition': `inline; filename="${d.coc_code}.pdf"` } };
  });
  // Receive and sign: the receiver's signature ("Received by") logs the samples and adds the receipt; the chain of
  // custody as it now stands, with their handwritten signature, is kept as a PDF with the receipt
  route('POST', '/api/orders/:id/receive', async (c) => {
    const o = await orderSite(c, c.params.id);
    const b = c.body || {};
    const ids = (Array.isArray(b.sample_ids) ? b.sample_ids : []).filter(isUuid);
    const temp = b.temperature === '' || b.temperature === null || b.temperature === undefined ? null : Number(b.temperature);
    if (temp !== null && !Number.isFinite(temp)) throw new Error('The temperature is a number (°C)');
    return signedTx({ ...c, reason: null }, { meaning: 'Received by', action: `Received ${ids.length} sample(s) of ${o.order_code} and signed the chain of custody`, module: 'Intake' }, async (t) => {
      const ev = await t.one('SELECT receive_samples($1, $2::uuid[], $3::timestamptz, $4, $5, $6, $7, $8, $9) AS id',
        [o.id, ids, b.received_at || null, b.delivered_by || null, b.tracking_no || null, temp, b.condition || null, b.seals || null, b.note || null]);
      const d = await CUS.data(t, o.id, { verifyBase: base() });
      const p = await CUS.pdf(d);
      const f = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, 'application/pdf', $2, $3, decode($4, 'base64')) RETURNING id`,
        [`${d.coc_code}-receipt-${d.receipts.length}.pdf`, p.buf.length, p.sha256, p.buf.toString('base64')]);
      await t.query('SELECT record_custody_pdf($1, $2, $3)', [ev.id, f.id, p.sha256]);
      const n = await t.one('SELECT count(*)::int AS n FROM sample WHERE id = ANY($1::uuid[]) AND logged_at IS NOT NULL', [ids]);
      return { id: ev.id, logged: n.n, receipt: d.receipts.length };
    });
  });
  // a receipt's signed PDF, or a paper copy's scan
  route('GET', '/api/custody/events/:id/file', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    if (!isUuid(c.params.id)) throw new Error('File not found');
    const d = await c.db.one(`SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, cd.site_id FROM custody_event e JOIN custody_document cd ON cd.id = e.custody_document_id
      JOIN document_file f ON f.id = e.document_id WHERE e.id = $1`, [c.params.id]);
    if (!d) throw new Error('File not found');
    await checkSite(c, d.site_id);
    return raw(d);
  });
  // the scan of the copy the client signed (Relinquished by)
  route('POST', '/api/orders/:id/custody/paper', async (c) => {
    const o = await orderSite(c, c.params.id);
    const b = c.body || {}; const buf = file(b.base64);
    if (!buf.length) throw new Error('Choose the scanned file');
    if (buf.length > 15 * 1024 * 1024) throw new Error('The scan is larger than 15 MB');
    const mime = ['application/pdf', 'image/png', 'image/jpeg'].includes(b.mime_type) ? b.mime_type : null;
    if (!mime) throw new Error('Attach a PDF, PNG or JPEG scan');
    return tx({ ...c, reason: b.note || 'Paper copy of the chain of custody' }, async (t) => {
      const doc = await t.one('SELECT make_custody_document($1) AS id', [o.id]);
      const sha = require('crypto').createHash('sha256').update(buf).digest('hex');
      const f = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, $3, $4, decode($5, 'base64')) RETURNING id`,
        [b.file_name || 'chain-of-custody-scan', mime, buf.length, sha, buf.toString('base64')]);
      return t.one(`INSERT INTO custody_event (custody_document_id, event_no, kind, event_at, note, document_id, sha256) VALUES ($1, 0, 'Paper copy', clock_timestamp(), $2, $3, $4) RETURNING id`,
        [doc.id, b.note || null, f.id, sha]);
    });
  });

  // ---------------------------------------------------------------- photos (4:3), taken or uploaded at receipt
  route('GET', '/api/samples/:id/photos', async (c) => {
    const s = await sampleSite(c, c.params.id);
    const rows = await c.db.rows(`SELECT p.id, p.caption, p.taken_at, p.report_slot, p.width_px, p.height_px, p.status, p.created_at, u.full_name AS by_name
      FROM sample_photo p JOIN app_user u ON u.id = p.created_by WHERE p.sample_id = $1 ORDER BY p.status, p.report_slot NULLS LAST, p.taken_at`, [s.id]);
    const need = await c.db.one('SELECT sample_report_photos_missing($1) AS problem', [s.id]);
    return { rows, problem: need ? need.problem : null, can_edit: await hasPermission(c, 'orders.edit') };
  });
  route('POST', '/api/samples/:id/photos', async (c) => {
    const s = await sampleSite(c, c.params.id);
    const list = Array.isArray(c.body.photos) ? c.body.photos : [];
    if (!list.length) throw new Error('Choose a photo');
    if (list.length > 10) throw new Error('Add at most 10 photos at a time');
    const prepared = list.map((p, i) => {
      const buf = file(p.base64); const size = CUS.imageSize(buf);
      if (!size) throw new Error(`Photo ${i + 1} is not a JPEG or PNG image`);
      if (buf.length > 6 * 1024 * 1024) throw new Error(`Photo ${i + 1} is larger than 6 MB`);
      if (Math.abs(size.w * 3 - size.h * 4) > Math.max(size.w, size.h) * 0.03) throw new Error(`Photo ${i + 1} is ${size.w} x ${size.h}: crop it to 4:3 (the photo dialog does this)`);
      return { buf, size, caption: p.caption || null, slot: [1, 2].includes(Number(p.report_slot)) ? Number(p.report_slot) : null, taken_at: p.taken_at || null, name: p.file_name || `photo-${i + 1}` };
    });
    return tx({ ...c, reason: c.body.reason || 'Sample photos at receipt' }, async (t) => {
      const ids = [];
      for (const p of prepared) {
        if (p.slot) await t.query('UPDATE sample_photo SET report_slot = NULL WHERE sample_id = $1 AND report_slot = $2 AND status = $3', [s.id, p.slot, 'Active']);
        const sha = require('crypto').createHash('sha256').update(p.buf).digest('hex');
        const f = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, $3, $4, decode($5, 'base64')) RETURNING id`,
          [p.name, p.size.type, p.buf.length, sha, p.buf.toString('base64')]);
        const r = await t.one(`INSERT INTO sample_photo (sample_id, document_id, width_px, height_px, caption, taken_at, report_slot) VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, clock_timestamp()), $7) RETURNING id`,
          [s.id, f.id, p.size.w, p.size.h, p.caption, p.taken_at, p.slot]);
        ids.push(r.id);
      }
      return { ids };
    });
  });
  // caption, place on the report (Report photo 1 / 2 / none), or retire
  route('PUT', '/api/photos/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Photo not found');
    const p = await c.db.one('SELECT p.*, o.site_id FROM sample_photo p JOIN sample s ON s.id = p.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE p.id = $1', [c.params.id]);
    if (!p) throw new Error('Photo not found');
    await checkSite(c, p.site_id);
    const b = c.body || {};
    const slot = b.report_slot === undefined ? p.report_slot : [1, 2].includes(Number(b.report_slot)) ? Number(b.report_slot) : null;
    const status = b.retire ? 'Inactive' : p.status;
    if (b.retire && !b.reason) throw new Error('Give the reason for retiring the photo');
    return tx({ ...c, reason: b.reason || 'Photo details' }, async (t) => {
      if (slot && slot !== p.report_slot) await t.query('UPDATE sample_photo SET report_slot = NULL WHERE sample_id = $1 AND report_slot = $2 AND status = $3 AND id <> $4', [p.sample_id, slot, 'Active', p.id]);
      await t.query('UPDATE sample_photo SET caption = $2, report_slot = $3, status = $4 WHERE id = $1', [p.id, b.caption === undefined ? p.caption : (b.caption || null), slot, status]);
      return { ok: true };
    });
  });
  route('GET', '/api/photos/:id/file', async (c) => {
    if (c.query.s) c.siteId = c.query.s;
    if (!isUuid(c.params.id)) throw new Error('Photo not found');
    const d = await c.db.one(`SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, o.site_id FROM sample_photo p JOIN document_file f ON f.id = p.document_id
      JOIN sample s ON s.id = p.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE p.id = $1`, [c.params.id]);
    if (!d) throw new Error('Photo not found');
    await checkSite(c, d.site_id);
    return raw(d);
  });

  // the audit icon: the chain of custody and photos with the order and the sample
  const cus = (where) => ` UNION ALL SELECT 'custody_document', d.id FROM custody_document d WHERE ${where} UNION ALL SELECT 'custody_event', e.id FROM custody_event e JOIN custody_document d ON d.id = e.custody_document_id WHERE ${where}`;
  AUDIT_SCOPES.order += cus('d.lab_order_id = $1') + ` UNION ALL SELECT 'sample_photo', p.id FROM sample_photo p JOIN sample s ON s.id = p.sample_id WHERE s.lab_order_id = $1`;
  AUDIT_SCOPES.sample += ` UNION ALL SELECT 'sample_photo', p.id FROM sample_photo p WHERE p.sample_id = $1`;
};
