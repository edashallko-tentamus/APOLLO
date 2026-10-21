// Waste classifications (0.30.0, migration 052): the controlled list (Admin > Lab setup > Waste classifications) and the
// choices for an inventory item. Shared ones (every lab) are kept by system administrators, each lab's own by
// inventory.lists (Lab Supervisor, QA, General Manager).
'use strict';

module.exports = function registerWaste({ route, tx, currentSite, hasPermission, isUuid, AUDIT_LISTS }) {
  // Postgres array text from the wire client, or an array, or "a, b" typed in a grid
  const list = (v) => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    const s = String(v ?? '').trim(); if (!s) return [];
    if (s.startsWith('{') && s.endsWith('}')) return s.slice(1, -1).split(',').map((x) => x.replace(/^"|"$/g, '').replace(/\\(.)/g, '$1').trim()).filter(Boolean);
    return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  };
  const out = (r) => ({ ...r, hazard_classes: list(r.hazard_classes), default_for: list(r.default_for) });
  // arrays go to the database as Postgres array text: PGlite cannot send a JavaScript array as an enum array
  // (chemical_type[]: "malformed array literal"), as for the inventory's enum arrays (Claude Code, 0.31.1)
  const pgArr = (a) => '{' + (a || []).map((x) => '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';

  route('GET', '/api/waste', async (c) => {
    const site = await currentSite(c);
    const rows = (await c.db.rows(`SELECT * FROM waste_classification_view WHERE site_id IS NULL OR site_id = $1 ORDER BY site_id NULLS FIRST, sort_order, waste_code`, [site])).map(out);
    const lab = await c.db.one('SELECT id, site_code FROM lab_site WHERE id = $1', [site]);
    const me = await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]);
    const types = (await c.db.one('SELECT enum_range(NULL::chemical_type)::text AS t')).t;
    const hazards = (await c.db.one('SELECT waste_hazard_classes()::text AS h')).h;
    return { rows, lab, can_edit: await hasPermission(c, 'inventory.lists'), sysadmin: !!(me && me.is_admin), item_types: list(types), hazard_classes: list(hazards) };
  });
  // the active classifications an item at this lab may take
  route('GET', '/api/waste/options', async (c) => {
    const site = await currentSite(c);
    return (await c.db.rows(`SELECT id, waste_code, waste_name, needs_review, hazard_classes, default_for, site_id FROM waste_classification
      WHERE status = 'Active' AND (site_id IS NULL OR site_id = $1) ORDER BY needs_review DESC, sort_order, waste_name`, [site])).map(out);
  });
  route('POST', '/api/waste', async (c) => {
    const site = await currentSite(c);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    return tx({ ...c, reason: c.body.reason || null }, async (t) => {
      const ids = [];
      for (const r of rows) {
        const f = {};
        for (const k of ['waste_name', 'epa_codes', 'waste_stream', 'container', 'disposal_instructions', 'segregation', 'needs_review', 'sort_order', 'status']) if (r[k] !== undefined) f[k] = r[k] === '' ? null : r[k];
        if (r.hazard_classes !== undefined) f.hazard_classes = list(r.hazard_classes);
        if (r.default_for !== undefined) f.default_for = list(r.default_for);
        if (r.id) {
          if (!isUuid(r.id)) throw new Error('Waste classification not found');
          const keys = Object.keys(f); if (!keys.length) continue;
          const set = keys.map((k, i) => `${k} = $${i + 2}${k === 'default_for' ? '::chemical_type[]' : k === 'hazard_classes' ? '::text[]' : ''}`).join(', ');
          await t.query(`UPDATE waste_classification SET ${set} WHERE id = $1`, [r.id, ...keys.map((k) => (k === 'default_for' || k === 'hazard_classes' ? pgArr(f[k]) : f[k]))]);
          ids.push(r.id);
        } else {
          if (!f.waste_name) throw new Error('Give the waste classification a name');
          const every = r.site_id === null || r.lab === 'Every lab' || r.every_lab === true;
          const x = await t.one(`INSERT INTO waste_classification (site_id, waste_name, hazard_classes, epa_codes, waste_stream, container, disposal_instructions, segregation, default_for, needs_review, sort_order)
            VALUES ($1, $2, $3::text[], $4, $5, $6, $7, $8, $9::chemical_type[], $10, $11) RETURNING id`,
          [every ? null : site, f.waste_name, pgArr(f.hazard_classes), f.epa_codes || null, f.waste_stream || null, f.container || null, f.disposal_instructions || null, f.segregation || null,
            pgArr(f.default_for), !!f.needs_review, Number(f.sort_order) || 100]);
          ids.push(x.id);
        }
      }
      return { ids };
    });
  });
  AUDIT_LISTS.waste = ['waste_classification'];
};
