// P-1 Test packages and dated price changes (migration 047): packages in the Test catalogue, on quotes and on orders
// (cancelling one of its tests takes off only that test's share, shown first), and price changes from an effective date.
'use strict';

module.exports = function registerPackages({ route, tx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS }) {
  const r = route;
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  // ---------------------------------------------------------------- the catalogue
  r('GET', '/api/packages', async (c) => {
    const site = await currentSite(c);
    return { rows: await c.db.rows('SELECT * FROM test_package_view ORDER BY site_code, status, package_name'), site,
      can_edit: await hasPermission(c, 'catalog.edit') };
  });
  // the lab's tests that can go in a package (active, priced), with their analytes when priced by analyte
  r('GET', '/api/packages/options', async (c) => {
    const site = await currentSite(c);
    const tests = await c.db.rows(`SELECT t.id, t.test_code, t.test_name, e.pricing_mode::text AS pricing_mode, catalog_list_price(e.id) AS list_price,
        EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = t.id AND v.status = 'Effective') AS approved
      FROM test t JOIN test_catalog_entry e ON e.test_id = t.id WHERE t.site_id = $1 AND t.status = 'Active' ORDER BY t.test_name`, [site]);
    return { tests };
  });
  const packageOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Package not found');
    const p = await c.db.one('SELECT * FROM test_package_view WHERE id = $1', [id]);
    if (!p) throw new Error('Package not found');
    return p;
  };
  r('GET', '/api/packages/:id', async (c) => {
    const p = await packageOf(c, c.params.id);
    const lines = await c.db.rows('SELECT * FROM test_package_lines($1) ORDER BY sort_order, test_name', [p.id]);
    // each analyte-priced test's analytes: the catalogue's, with the package's exceptions
    const analytes = await c.db.rows(`SELECT i.id AS item_id, ap.analyte_id, a.analyte_name, ap.price AS catalogue_price, pa.id AS exception_id,
        COALESCE(pa.included, true) AS included
      FROM test_package_item i JOIN test_catalog_entry e ON e.test_id = i.test_id AND e.pricing_mode = 'Analyte Selection'
      JOIN test_analyte_price ap ON ap.catalog_entry_id = e.id AND ap.status = 'Active' JOIN analyte a ON a.id = ap.analyte_id
      LEFT JOIN test_package_analyte pa ON pa.item_id = i.id AND pa.analyte_id = ap.analyte_id
      WHERE i.package_id = $1 AND i.status = 'Active' ORDER BY a.analyte_name`, [p.id]);
    const problems = await c.db.rows('SELECT * FROM test_package_problems($1)', [p.id]);
    const quotes = await c.db.rows(`SELECT p.project_code, pv.id AS version_id, pv.version_no, pv.status::text AS status, COALESCE(cl.display_name, cl.legal_name) AS client_name, qp.package_price, qp.quantity
      FROM quoted_package qp JOIN project_version pv ON pv.id = qp.project_version_id JOIN project p ON p.id = pv.project_id JOIN client cl ON cl.id = p.client_id
      WHERE qp.package_id = $1 AND qp.status = 'Active' ORDER BY qp.created_at DESC LIMIT 50`, [p.id]);
    return { package: p, lines, analytes, problems, quotes, can_edit: await hasPermission(c, 'catalog.edit', p.site_id) };
  });
  // 049 (Alex, 2026-10-19): no pricing on the package itself; each test is priced in it and the price is their sum
  const headerVals = (b) => [String(b.package_name || '').trim(), b.description || null, !!b.show_in_public_catalogue];
  r('POST', '/api/packages', async (c) => {
    const site = await currentSite(c);
    const b = c.body || {};
    return tx({ ...c, siteId: site, reason: b.reason || 'New package' }, async (t) => {
      const p = await t.one(`INSERT INTO test_package (site_id, package_name, description, show_in_public_catalogue)
        VALUES ($1, $2, $3, $4) RETURNING id, package_code`, [site, ...headerVals(b)]);
      let n = 0;
      for (const id of (b.tests || []).filter(isUuid)) await t.query('INSERT INTO test_package_item (package_id, test_id, sort_order) VALUES ($1, $2, $3)', [p.id, id, ++n]);
      return p;
    });
  });
  // header and lines in one save (a Reason for Change: the catalogue's rule)
  r('PUT', '/api/packages/:id', async (c) => {
    const p = await packageOf(c, c.params.id);
    const b = c.body || {};
    return tx({ ...c, siteId: p.site_id, reason: b.reason }, async (t) => {
      if (b.header) {
        await t.query('UPDATE test_package SET package_name = $2, description = $3, show_in_public_catalogue = $4 WHERE id = $1', [p.id, ...headerVals(b.header)]);
      }
      for (const it of b.items || []) {
        if (isUuid(it.id)) {
          await t.query(`UPDATE test_package_item SET sort_order = COALESCE($2, sort_order), component_price = $3, status = COALESCE($4::record_status, status) WHERE id = $1 AND package_id = $5`,
            [it.id, num(it.sort_order), num(it.component_price), it.status || null, p.id]);
        } else if (isUuid(it.test_id)) {
          const mx = await t.one('SELECT COALESCE(max(sort_order), 0) + 1 AS n FROM test_package_item WHERE package_id = $1', [p.id]);
          await t.query('INSERT INTO test_package_item (package_id, test_id, sort_order, component_price) VALUES ($1, $2, $3, $4)', [p.id, it.test_id, num(it.sort_order) ?? mx.n, num(it.component_price)]);
        }
      }
      for (const a of b.analytes || []) {
        if (!isUuid(a.item_id) || !isUuid(a.analyte_id)) continue;
        await t.query(`INSERT INTO test_package_analyte (item_id, analyte_id, included) VALUES ($1, $2, $3)
          ON CONFLICT (item_id, analyte_id) DO UPDATE SET included = EXCLUDED.included`,
          [a.item_id, a.analyte_id, a.included !== false]);
      }
      return { ok: true };
    });
  });
  r('POST', '/api/packages/:id/retire', async (c) => {
    const p = await packageOf(c, c.params.id);
    return tx({ ...c, siteId: p.site_id, reason: (c.body || {}).reason }, (t) => t.query("UPDATE test_package SET status = 'Retired' WHERE id = $1", [p.id]).then(() => ({ ok: true })));
  });

  // ---------------------------------------------------------------- quotes
  const versionOf = async (c, vid) => {
    if (!isUuid(vid)) throw new Error('Quote not found');
    const v = await c.db.one(`SELECT pv.id, pv.status::text AS status, version_is_editable(pv.id) AS editable, p.site_id, p.kind, p.is_list_price_acceptance, p.client_id
      FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = $1`, [vid]);
    if (!v) throw new Error('Quote not found');
    return v;
  };
  r('GET', '/api/versions/:vid/packages', async (c) => {
    const v = await versionOf(c, c.params.vid);
    const rows = await c.db.rows(`SELECT qp.*, qp.status::text AS status, p.status::text AS package_status FROM quoted_package qp JOIN test_package p ON p.id = qp.package_id
      WHERE qp.project_version_id = $1 AND qp.status = 'Active' ORDER BY qp.created_at`, [v.id]);
    const parts = await c.db.rows(`SELECT q.id AS line_id, q.quoted_package_id, t.id AS test_id, t.test_code, t.test_name, q.list_price, q.final_price, q.quantity,
        e.pricing_mode::text AS pricing_mode, (SELECT count(*) FROM quoted_analyte_selection s WHERE s.line_id = q.id AND s.included)::int AS analytes_included,
        (SELECT count(*) FROM quoted_analyte_selection s WHERE s.line_id = q.id)::int AS analytes_total,
        (SELECT count(*) FROM specification sp WHERE sp.quoted_line_id = q.id AND sp.status = 'Active')::int AS spec_count, e.standard_tat, e.tat_unit::text AS tat_unit
      FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id JOIN test_catalog_entry e ON e.test_id = t.id
      WHERE q.project_version_id = $1 AND q.quoted_package_id IS NOT NULL AND q.status = 'Active' ORDER BY q.created_at`, [v.id]);
    for (const x of rows) x.tests = parts.filter((p) => p.quoted_package_id === x.id);
    // the packages this quote can take: its own lab's, active, with nothing stopping them
    const options = v.kind === 'Stability' || v.is_list_price_acceptance ? [] : await c.db.rows(`SELECT id, package_code, package_name, package_price, list_value, test_count, tests, errors
      FROM test_package_view WHERE site_id = $1 AND status = 'Active' ORDER BY package_name`, [v.site_id]);
    return { rows, options, editable: v.editable, allowed: v.kind !== 'Stability' && !v.is_list_price_acceptance };
  });
  r('POST', '/api/versions/:vid/packages', async (c) => {
    const v = await versionOf(c, c.params.vid);
    const b = c.body || {};
    if (!isUuid(b.package_id)) throw new Error('Choose a package');
    return tx({ ...c, reason: c.reason || 'Quote edited' }, (t) => t.one('SELECT add_package_to_quote($1, $2, $3) AS id', [v.id, b.package_id, Math.max(1, Number(b.quantity) || 1)]));
  });
  r('PUT', '/api/quoted-packages/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Package not found');
    const b = c.body || {};
    return tx({ ...c, reason: c.reason || 'Quote edited' }, (t) => t.query('SELECT set_quoted_package($1, $2, $3)', [c.params.id, num(b.package_price), num(b.quantity)]).then(() => ({ ok: true })));
  });
  r('POST', '/api/quoted-packages/:id/remove', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Package not found');
    return tx({ ...c, reason: c.reason || 'Quote edited' }, (t) => t.query('SELECT remove_quoted_package($1)', [c.params.id]).then(() => ({ ok: true })));
  });

  // ---------------------------------------------------------------- orders
  r('POST', '/api/orders/:id/add-package', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Order not found');
    const o = await c.db.one('SELECT site_id FROM lab_order WHERE id = $1', [c.params.id]);
    if (!o) throw new Error('Order not found');
    await checkSite(c, o.site_id);
    const b = c.body || {};
    if (!isUuid(b.quoted_package_id)) throw new Error('Choose a package');
    return tx(c, async (t) => {
      let n = 0;
      for (const s of (b.sample_ids || []).filter(isUuid)) { await t.one('SELECT order_package($1, $2) AS id', [s, b.quoted_package_id]); n++; }
      return { added: n };
    });
  });
  // what cancelling this test of a package takes off (option B: its share only; the other tests keep theirs)
  r('GET', '/api/requested-tests/:id/package-cancel', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Test not found');
    const x = await c.db.one(`SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = $1`, [c.params.id]);
    if (!x) throw new Error('Test not found');
    await checkSite(c, x.site_id);
    return (await c.db.one('SELECT * FROM package_cancel_preview($1)', [c.params.id])) || null;
  });
  r('POST', '/api/ordered-packages/:id/cancel', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Package not found');
    const x = await c.db.one('SELECT o.site_id FROM ordered_package op JOIN sample s ON s.id = op.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE op.id = $1', [c.params.id]);
    if (!x) throw new Error('Package not found');
    await checkSite(c, x.site_id);
    return tx({ ...c, reason: (c.body || {}).reason }, (t) => t.one('SELECT cancel_ordered_package($1) AS n', [c.params.id]));
  });

  // ---------------------------------------------------------------- dated price changes
  r('GET', '/api/price-changes', async (c) => {
    const site = await currentSite(c);
    const rows = await c.db.rows(`SELECT pc.*, u.full_name AS created_by_name, cu.full_name AS cancelled_by_name, site_today(pc.site_id) AS today,
        CASE WHEN pc.tests IS NULL THEN 'Every active test' ELSE (SELECT string_agg(t.test_name, ', ' ORDER BY t.test_name) FROM test t WHERE t.id = ANY (pc.tests)) END AS scope
      FROM catalog_price_change pc JOIN app_user u ON u.id = pc.created_by LEFT JOIN app_user cu ON cu.id = pc.cancelled_by
      WHERE pc.site_id = $1 ORDER BY pc.effective_on DESC, pc.created_at DESC`, [site]);
    const today = await c.db.one('SELECT site_today($1) AS d', [site]);
    return { rows, today: today.d, can_edit: await hasPermission(c, 'catalog.edit') };
  });
  // scheduled; one starting today is applied at once (in the same transaction)
  r('POST', '/api/price-changes', async (c) => {
    const site = await currentSite(c);
    const b = c.body || {};
    const pct = Number(b.pct);
    if (!Number.isFinite(pct) || pct === 0) throw new Error('Give the percentage to change the prices by (e.g. 3 or -5)');
    const tests = Array.isArray(b.tests) ? b.tests.filter(isUuid) : null;
    if (Array.isArray(b.tests) && !tests.length) throw new Error('Select the tests to change, or choose every test');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.effective_on || ''))) throw new Error('Give the date the new prices start');
    if (!String(b.reason || '').trim()) throw new Error('A Reason for Change is required for a price change');
    return tx({ ...c, siteId: site, reason: b.reason }, async (t) => {
      const pc = await t.one(`INSERT INTO catalog_price_change (site_id, tests, pct, rounding, include_packages, effective_on, reason)
        VALUES ($1, $2::uuid[], $3, $4, $5, $6, $7) RETURNING id, change_code, effective_on <= site_today(site_id) AS due`,
        [site, tests, pct, b.rounding === 'Dollar' ? 'Dollar' : 'Cent', b.include_packages !== false, b.effective_on, String(b.reason).trim()]);
      let applied = null;
      if (pc.due) applied = (await t.one('SELECT apply_catalog_price_change($1) AS n', [pc.id])).n;
      return { id: pc.id, change_code: pc.change_code, applied };
    });
  });
  r('POST', '/api/price-changes/:id/cancel', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Price change not found');
    const pc = await c.db.one('SELECT site_id FROM catalog_price_change WHERE id = $1', [c.params.id]);
    if (!pc) throw new Error('Price change not found');
    await checkSite(c, pc.site_id);
    return tx({ ...c, siteId: pc.site_id, reason: (c.body || {}).reason }, (t) => t.query("UPDATE catalog_price_change SET status = 'Cancelled' WHERE id = $1", [c.params.id]).then(() => ({ ok: true })));
  });

  AUDIT_SCOPES.test_package = `SELECT 'test_package', $1::uuid UNION ALL SELECT 'test_package_item', id FROM test_package_item WHERE package_id = $1
    UNION ALL SELECT 'test_package_analyte', a.id FROM test_package_analyte a JOIN test_package_item i ON i.id = a.item_id WHERE i.package_id = $1`;
  AUDIT_LISTS.packages = ['test_package', 'test_package_item', 'test_package_analyte'];
  AUDIT_LISTS.price_changes = ['catalog_price_change'];
};

// The hourly job: scheduled price changes whose day has come, each applied as the person who scheduled it
module.exports.applyDue = async (db) => {
  const due = await db.rows('SELECT * FROM catalog_price_change_due');
  let n = 0;
  for (const d of due) {
    try {
      await db.tx({ userId: d.created_by, siteId: d.site_id, reason: 'Scheduled price change ' + d.change_code }, (t) => t.one('SELECT apply_catalog_price_change($1) AS n', [d.id]));
      n++;
    } catch (e) {
      console.error(`Price change ${d.change_code} could not be applied: ${e.message}`);
      const sys = await db.one("SELECT id FROM app_user WHERE username = 'system'");
      await db.tx({ userId: sys.id, siteId: d.site_id, reason: 'The scheduled price change could not be applied' },
        (t) => t.query('UPDATE catalog_price_change SET last_error = $2 WHERE id = $1', [d.id, e.message.slice(0, 500)])).catch(() => {});
    }
  }
  return { n };
};
