// Lab setup additions (migration 030): the product name, each lab's images (logo, small logo, accreditation mark),
// the accreditation placeholders (in the Sites grid, routes.js) and the report templates. The rules are in the
// database (system_setting_rules, site_media_rules, report_template_rules).
'use strict';
const crypto = require('crypto');

module.exports = function registerLabSetup({ route, tx, upsertRows, checkSite, hasPermission, requireSystemAdmin, isUuid, AUDIT_LISTS }) {
  const r = route;

  // ---------------------------------------------------------------- the product name (public: the sign-in page shows it)
  r('GET', '/api/public/settings', async (c) => {
    const rows = await c.db.rows(`SELECT setting_key, setting_value FROM system_setting WHERE setting_key IN ('product_name')`).catch(() => []);
    return Object.fromEntries(rows.map((x) => [x.setting_key, x.setting_value]));
  });
  r('POST', '/api/settings', async (c) => {
    await requireSystemAdmin(c);
    const v = String(c.body.product_name || '').trim();
    if (!v) throw new Error('Type the product name');
    return tx({ ...c, reason: c.body.reason || 'Product name changed' }, (t) => t.query(`UPDATE system_setting SET setting_value = $1 WHERE setting_key = 'product_name'`, [v.slice(0, 60)]));
  });

  // ---------------------------------------------------------------- lab images
  r('GET', '/api/sites/:id/media', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Lab not found');
    await checkSite(c, c.params.id);
    return { rows: await c.db.rows(`SELECT m.id, m.kind, m.title, m.status::text AS status, m.created_at, u.full_name AS uploaded_by, f.file_name, f.mime_type, f.size_bytes, f.sha256
        FROM site_media m JOIN document_file f ON f.id = m.document_id JOIN app_user u ON u.id = m.created_by WHERE m.site_id = $1 ORDER BY m.status, m.kind, m.created_at DESC`, [c.params.id]),
      can_edit: await hasPermission(c, 'admin.lab', c.params.id) };
  });
  r('POST', '/api/sites/:id/media', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Lab not found');
    const b64 = String(c.body.b64 || '');
    if (!b64) throw new Error('Choose an image');
    const kind = c.body.kind;
    return tx({ ...c, siteId: c.params.id, reason: c.body.reason || `${kind} uploaded` }, async (t) => {
      if (kind !== 'Other') await t.query(`UPDATE site_media SET status = 'Inactive' WHERE site_id = $1 AND kind = $2 AND status = 'Active'`, [c.params.id, kind]);
      const buf = Buffer.from(b64, 'base64');
      const d = await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, $3, $4, decode($5, 'base64')) RETURNING id`,
        [String(c.body.file_name || 'image').slice(0, 200), c.body.mime_type || 'application/octet-stream', buf.length, crypto.createHash('sha256').update(buf).digest('hex'), b64]);
      return t.one('INSERT INTO site_media (site_id, kind, title, document_id) VALUES ($1, $2, $3, $4) RETURNING id', [c.params.id, kind, c.body.title || null, d.id]);
    });
  });
  r('POST', '/api/sites/media/:mid/retire', async (c) => {
    const m = await c.db.one('SELECT site_id FROM site_media WHERE id = $1', [c.params.mid]);
    if (!m) throw new Error('Image not found');
    return tx({ ...c, siteId: m.site_id, reason: c.body.reason || 'Image retired' }, (t) => t.query(`UPDATE site_media SET status = 'Inactive' WHERE id = $1`, [c.params.mid]));
  });
  // the image itself (any signed-in person: the header shows the lab's small logo)
  r('GET', '/api/sites/media/:mid/file', async (c) => {
    if (!isUuid(c.params.mid)) throw new Error('Image not found');
    const f = await c.db.one(`SELECT f.mime_type, encode(f.content, 'base64') AS b64 FROM site_media m JOIN document_file f ON f.id = m.document_id WHERE m.id = $1`, [c.params.mid]);
    if (!f) throw new Error('Image not found');
    return { __raw: true, body: Buffer.from(f.b64, 'base64'), type: f.mime_type, headers: { 'Cache-Control': 'private, max-age=300' } };
  });
  // a lab's current image of one kind (the header's small logo)
  r('GET', '/api/sites/:id/media-current', async (c) => {
    if (!isUuid(c.params.id)) return { id: null };
    const m = await c.db.one(`SELECT id FROM site_media WHERE site_id = $1 AND kind = $2 AND status = 'Active'`, [c.params.id, c.query.kind || 'Small logo']);
    return { id: m ? m.id : null };
  });

  // ---------------------------------------------------------------- report templates
  r('GET', '/api/report-templates', async (c) => {
    const rows = await c.db.rows(`SELECT rt.*, rt.status::text AS status, s.site_code,
        (SELECT count(*) FROM test_version tv WHERE tv.report_template_id = rt.id)::int AS used_by
      FROM report_template rt LEFT JOIN lab_site s ON s.id = rt.site_id ORDER BY rt.site_id NULLS FIRST, rt.template_code`);
    const labs = await c.db.rows(`SELECT id, site_code FROM lab_site WHERE status = 'Active' ORDER BY site_code`);
    const can = {};
    for (const l of labs) can[l.id] = await hasPermission(c, 'reports.templates', l.id);
    const me = await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]);
    return { rows, labs, can, sysadmin: !!(me && me.is_admin), layouts: ['Standard COA', 'COA with 1 photo', 'COA with 2 photos'] };
  });
  r('POST', '/api/report-templates', (c) => tx({ ...c, reason: c.body.reason || 'Report templates changed' }, async (t) => {
    const rows = (c.body.rows || []).map((x) => {
      const o = Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)); // only what was sent is changed
      if (o.options && typeof o.options === 'object') o.options = JSON.stringify(o.options);
      return o;
    });
    // one default per lab: clear the old default first
    for (const x of rows.filter((y) => y.is_default === true || y.is_default === 'true')) {
      const site = x.id ? (await t.one('SELECT site_id FROM report_template WHERE id = $1', [x.id])).site_id : (x.site_id || null);
      await t.query(`UPDATE report_template SET is_default = false WHERE is_default AND site_id IS NOT DISTINCT FROM $1 AND ($2::uuid IS NULL OR id <> $2)`, [site, x.id || null]);
    }
    return upsertRows(t, 'report_template', rows.map((x) => (x.id ? (({ site_id, ...rest }) => rest)(x) : x)), ['template_name', 'description', 'layout', 'site_id', 'is_default', 'options', 'status']);
  }));

  AUDIT_LISTS.report_templates = ['report_template'];
  AUDIT_LISTS.lab_media = ['site_media', 'system_setting'];
};
