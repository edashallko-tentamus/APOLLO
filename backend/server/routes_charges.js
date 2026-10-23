// 0.36.0 (migration 058): service lines, the test picker (service line > type > department, any test of the lab at
// its list price, the client's quoted tests first), miscellaneous charges in the catalogue, on quotes and on lab orders.
// Thin: every rule lives in the database.
'use strict';

module.exports = function registerCharges({ route, tx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS }) {
  const r = route;
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const orderOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Order not found');
    const o = await c.db.one('SELECT id, site_id, client_id, order_code, status::text AS status FROM lab_order WHERE id = $1', [id]);
    if (!o) throw new Error('Order not found');
    await checkSite(c, o.site_id);
    return o;
  };

  // ---------------------------------------------------------------- service lines (shared by every lab)
  r('GET', '/api/service-lines', async (c) => {
    const site = await currentSite(c);
    const lines = await c.db.rows('SELECT * FROM service_line ORDER BY sort_order, line_name');
    const types = await c.db.rows(`SELECT t.*, sl.line_name, (SELECT count(*) FROM test x WHERE x.service_line_type_id = t.id AND x.site_id = $1 AND x.status = 'Active')::int AS test_count
      FROM service_line_type t JOIN service_line sl ON sl.id = t.service_line_id ORDER BY sl.sort_order, sl.line_name, t.sort_order, t.type_name`, [site]);
    return { lines, types, can_edit: await hasPermission(c, 'catalog.edit') };
  });
  r('POST', '/api/service-lines', (c) => {
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    return tx({ ...c, reason: c.reason || 'Service lines changed' }, async (t) => {
      for (const x of rows) {
        if (!String(x.line_name || '').trim()) continue;
        if (isUuid(x.id)) await t.query('UPDATE service_line SET line_name = $2, sort_order = $3, status = $4 WHERE id = $1', [x.id, x.line_name.trim(), parseInt(x.sort_order, 10) || 0, x.status || 'Active']);
        else await t.query('INSERT INTO service_line (line_name, sort_order) VALUES ($1, $2)', [x.line_name.trim(), parseInt(x.sort_order, 10) || 0]);
      }
    });
  });
  r('POST', '/api/service-lines/types', (c) => {
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    return tx({ ...c, reason: c.reason || 'Service line types changed' }, async (t) => {
      for (const x of rows) {
        if (!String(x.type_name || '').trim()) continue;
        if (isUuid(x.id)) await t.query('UPDATE service_line_type SET type_name = $2, sort_order = $3, status = $4 WHERE id = $1', [x.id, x.type_name.trim(), parseInt(x.sort_order, 10) || 0, x.status || 'Active']);
        else {
          if (!isUuid(x.service_line_id)) throw new Error(`Choose the service line of "${x.type_name}"`);
          await t.query('INSERT INTO service_line_type (service_line_id, type_name, sort_order) VALUES ($1, $2, $3)', [x.service_line_id, x.type_name.trim(), parseInt(x.sort_order, 10) || 0]);
        }
      }
    });
  });
  // the lab's tests and their service line type (fill down and paste on the Service lines tab)
  r('GET', '/api/service-lines/tests', async (c) => {
    const site = await currentSite(c);
    return c.db.rows(`SELECT t.id, t.test_code, t.test_name, t.service_line_type_id, d.department_name, sl.line_name, slt.type_name
      FROM test t LEFT JOIN department d ON d.id = t.department_id LEFT JOIN service_line_type slt ON slt.id = t.service_line_type_id LEFT JOIN service_line sl ON sl.id = slt.service_line_id
      WHERE t.site_id = $1 AND t.status = 'Active' ORDER BY t.test_name`, [site]);
  });
  r('POST', '/api/service-lines/tests', (c) => {
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    return tx({ ...c, reason: c.reason || 'Service line types of tests' }, async (t) => {
      for (const x of rows) {
        if (!isUuid(x.id)) continue;
        await t.query('UPDATE test SET service_line_type_id = $2 WHERE id = $1 AND service_line_type_id IS DISTINCT FROM $2::uuid', [x.id, isUuid(x.service_line_type_id) ? x.service_line_type_id : null]);
      }
    });
  });
  // the client's service lines (what the picker opens on)
  r('GET', '/api/clients/:id/service-lines', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Client not found');
    return c.db.rows(`SELECT sl.id, sl.line_name, (csl.id IS NOT NULL AND csl.status = 'Active') AS chosen FROM service_line sl
      LEFT JOIN client_service_line csl ON csl.service_line_id = sl.id AND csl.client_id = $1 WHERE sl.status = 'Active' ORDER BY sl.sort_order, sl.line_name`, [c.params.id]);
  });
  r('PUT', '/api/clients/:id/service-lines', (c) => {
    if (!isUuid(c.params.id)) throw new Error('Client not found');
    const ids = (Array.isArray(c.body.ids) ? c.body.ids : []).filter(isUuid);
    return tx({ ...c, reason: c.reason || 'Client service lines changed' }, async (t) => {
      await t.query(`UPDATE client_service_line SET status = 'Inactive' WHERE client_id = $1 AND status = 'Active' AND NOT (service_line_id = ANY ($2::uuid[]))`, [c.params.id, ids]);
      for (const id of ids) {
        await t.query(`INSERT INTO client_service_line (client_id, service_line_id) VALUES ($1, $2)
          ON CONFLICT (client_id, service_line_id) DO UPDATE SET status = 'Active' WHERE client_service_line.status <> 'Active'`, [c.params.id, id]);
      }
    });
  });

  // ---------------------------------------------------------------- the test picker on a lab order
  // One read: the lab's orderable tests with their service line, type and department, the client's price (quote, else
  // list price), and why a test cannot be ordered; the screen drills down without asking again.
  r('GET', '/api/orders/:id/picker', async (c) => {
    const o = await orderOf(c, c.params.id);
    const tests = await c.db.rows(`WITH q AS (
        SELECT DISTINCT ON (ol.test_id) ol.test_id, ol.line_id, ol.final_price, ol.project_code FROM orderable_lines($1) ol
         JOIN quoted_test_configuration x ON x.id = ol.line_id JOIN project_version pv ON pv.id = x.project_version_id
         ORDER BY ol.test_id, pv.accepted_at DESC NULLS LAST, ol.final_price)
      SELECT t.id, t.test_code, t.test_name, e.description, e.standard_tat, e.tat_unit::text AS tat_unit, e.rush_schedule_id, catalog_list_price(e.id) AS list_price,
             q.final_price AS quote_price, q.project_code, d.id AS department_id, d.department_name, slt.id AS type_id, slt.type_name, sl.id AS line_id, sl.line_name,
             catalogue_order_problem($2, t.id) AS problem, e.pricing_mode::text AS pricing_mode
        FROM test t JOIN test_catalog_entry e ON e.test_id = t.id LEFT JOIN q ON q.test_id = t.id
        LEFT JOIN department d ON d.id = t.department_id LEFT JOIN service_line_type slt ON slt.id = t.service_line_type_id LEFT JOIN service_line sl ON sl.id = slt.service_line_id
       WHERE t.site_id = $2 AND t.status = 'Active' AND t.serving_role IS NULL
       ORDER BY (q.test_id IS NULL), t.test_name`, [o.client_id, o.site_id]);
    const lines = await c.db.rows(`SELECT sl.id, sl.line_name, sl.sort_order, EXISTS (SELECT 1 FROM client_service_line csl WHERE csl.client_id = $1 AND csl.service_line_id = sl.id AND csl.status = 'Active') AS client_line
      FROM service_line sl WHERE sl.status = 'Active' ORDER BY sl.sort_order, sl.line_name`, [o.client_id]);
    const elsewhere = await c.db.rows(`SELECT DISTINCT ol.test_name, ls.site_code FROM orderable_lines($1) ol JOIN test tt ON tt.id = ol.test_id JOIN lab_site ls ON ls.id = tt.site_id
      WHERE tt.site_id <> $2 ORDER BY ls.site_code, ol.test_name`, [o.client_id, o.site_id]);
    return { tests, lines, elsewhere };
  });
  // order tests from the picker on the chosen samples: the quote's price when the client has one, else the list price
  r('POST', '/api/orders/:id/catalogue-tests', async (c) => {
    const o = await orderOf(c, c.params.id);
    const samples = (Array.isArray(c.body.sample_ids) ? c.body.sample_ids : []).filter(isUuid);
    const tests = (Array.isArray(c.body.test_ids) ? c.body.test_ids : []).filter(isUuid);
    if (!samples.length) throw new Error('Choose the samples to add the tests to');
    if (!tests.length) throw new Error('Choose the tests to add');
    const tier = isUuid(c.body.rush_tier_id) ? c.body.rush_tier_id : null;
    return tx(c, async (t) => {
      let added = 0; let skipped = 0; let listPrice = 0;
      for (const s of samples) {
        const ok = await t.one('SELECT 1 AS x FROM sample WHERE id = $1 AND lab_order_id = $2', [s, o.id]);
        if (!ok) throw new Error('That sample is on another order');
        for (const test of tests) {
          const exists = await t.one(`SELECT 1 AS x FROM requested_test WHERE sample_id = $1 AND test_id = $2 AND status <> 'Cancelled' AND retest_of_id IS NULL`, [s, test]);
          if (exists) { skipped++; continue; }
          // a rush tier only on tests of its schedule
          const useTier = tier && (await t.one('SELECT 1 AS x FROM test_catalog_entry e JOIN rush_fee_tier tr ON tr.schedule_id = e.rush_schedule_id WHERE e.test_id = $1 AND tr.id = $2', [test, tier])) ? tier : null;
          const x = await t.one('SELECT order_catalogue_test($1, $2, $3) AS id', [s, test, useTier]);
          added++;
          if ((await t.one('SELECT catalogue_order FROM requested_test WHERE id = $1', [x.id])).catalogue_order) listPrice++;
        }
      }
      return { added, skipped, list_price: listPrice };
    });
  });

  // ---------------------------------------------------------------- the catalogue of charges
  r('GET', '/api/charge-items', async (c) => {
    const site = await currentSite(c);
    const me = await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]);
    const rows = await c.db.rows(`SELECT ci.*, ls.site_code, sl.line_name,
        (SELECT count(*) FROM order_charge oc WHERE oc.charge_item_id = ci.id)::int AS used
      FROM charge_item ci LEFT JOIN lab_site ls ON ls.id = ci.site_id LEFT JOIN service_line sl ON sl.id = ci.service_line_id
      WHERE ci.site_id IS NULL OR ci.site_id = $1 ORDER BY ci.status, ci.kind = 'Discount', ci.charge_name`, [site]);
    return { rows, can_edit: await hasPermission(c, 'catalog.edit'), is_admin: !!(me && me.is_admin), site };
  });
  r('POST', '/api/charge-items', async (c) => {
    const site = await currentSite(c);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    return tx({ ...c, reason: c.reason || 'Charges changed' }, async (t) => {
      for (const x of rows) {
        if (!String(x.charge_name || '').trim()) continue;
        const v = [String(x.charge_name).trim(), x.kind || 'Other', x.description || null, num(x.price) ?? 0, isUuid(x.service_line_id) ? x.service_line_id : null, x.status || 'Active'];
        if (isUuid(x.id)) {
          await t.query('UPDATE charge_item SET charge_name = $2, kind = $3, description = $4, price = $5, service_line_id = $6, status = $7 WHERE id = $1', [x.id, ...v]);
        } else {
          await t.query('INSERT INTO charge_item (charge_name, kind, description, price, service_line_id, status, site_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [...v, x.scope === 'Every lab' ? null : site]);
        }
      }
    });
  });

  // ---------------------------------------------------------------- charges on a quote or project version
  const versionOf = async (c, vid) => {
    if (!isUuid(vid)) throw new Error('Quote not found');
    const v = await c.db.one(`SELECT pv.id, p.site_id, p.client_id, version_is_editable(pv.id) AS editable FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = $1`, [vid]);
    if (!v) throw new Error('Quote not found');
    return v;
  };
  r('GET', '/api/versions/:vid/charges', async (c) => {
    const v = await versionOf(c, c.params.vid);
    const site = v.site_id || await currentSite(c);
    const rows = await c.db.rows(`SELECT qc.*, ci.charge_code, ci.charge_name, ci.kind, ci.description, qc.quantity * qc.unit_price * charge_sign(ci.kind) AS line_total
      FROM quoted_charge qc JOIN charge_item ci ON ci.id = qc.charge_item_id WHERE qc.project_version_id = $1 AND qc.status = 'Active' ORDER BY ci.kind = 'Discount', ci.charge_name`, [v.id]);
    const items = await c.db.rows(`SELECT id, charge_code, charge_name, kind, price FROM charge_item WHERE status = 'Active' AND (site_id IS NULL OR site_id = $1) ORDER BY kind = 'Discount', charge_name`, [site]);
    return { rows, items, editable: v.editable };
  });
  r('POST', '/api/versions/:vid/charges', async (c) => {
    const v = await versionOf(c, c.params.vid);
    const b = c.body || {};
    if (!isUuid(b.charge_item_id)) throw new Error('Choose the charge');
    return tx({ ...c, reason: c.reason || 'Quote edited' }, (t) => t.one(`INSERT INTO quoted_charge (project_version_id, charge_item_id, quantity, unit_price, note)
      VALUES ($1, $2, $3, COALESCE($4, (SELECT price FROM charge_item WHERE id = $2)), $5) RETURNING id`, [v.id, b.charge_item_id, parseInt(b.quantity, 10) || 1, num(b.unit_price), b.note || null]));
  });
  r('PUT', '/api/quoted-charges/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Charge not found');
    const b = c.body || {};
    return tx({ ...c, reason: c.reason || 'Quote edited' }, async (t) => {
      if (b.remove) { await t.query(`UPDATE quoted_charge SET status = 'Inactive' WHERE id = $1`, [c.params.id]); return { ok: true }; }
      await t.query('UPDATE quoted_charge SET quantity = COALESCE($2, quantity), unit_price = COALESCE($3, unit_price), note = $4 WHERE id = $1',
        [c.params.id, parseInt(b.quantity, 10) || null, num(b.unit_price), b.note === undefined ? null : b.note || null]);
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- charges on a lab order
  r('GET', '/api/orders/:id/charges', async (c) => {
    const o = await orderOf(c, c.params.id);
    const rows = await c.db.rows(`SELECT oc.*, ci.charge_code, ci.charge_name, ci.kind, s.sample_code, oc.quantity * oc.unit_price AS amount,
        (SELECT COALESCE(i.invoice_number, i.draft_code) FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id WHERE l.id = charge_invoice_line(oc.id)) AS invoice_code,
        (SELECT l.invoice_id FROM invoice_line l WHERE l.id = charge_invoice_line(oc.id)) AS invoice_id,
        charge_billing_closed(oc.id) AS credited, p.project_code
      FROM order_charge oc JOIN charge_item ci ON ci.id = oc.charge_item_id LEFT JOIN sample s ON s.id = oc.sample_id
      LEFT JOIN quoted_charge qc ON qc.id = oc.quoted_charge_id LEFT JOIN project_version pv ON pv.id = qc.project_version_id LEFT JOIN project p ON p.id = pv.project_id
      WHERE oc.lab_order_id = $1 ORDER BY oc.status, oc.created_at`, [o.id]);
    const items = await c.db.rows(`SELECT ci.id, ci.charge_code, ci.charge_name, ci.kind, ci.price, cp.unit_price AS client_price, cp.project_code
      FROM charge_item ci LEFT JOIN LATERAL client_charge_price($2, ci.id) cp ON true
      WHERE ci.status = 'Active' AND (ci.site_id IS NULL OR ci.site_id = $1) ORDER BY ci.kind = 'Discount', ci.charge_name`, [o.site_id, o.client_id]);
    return { rows, items, can_edit: await hasPermission(c, 'orders.edit', o.site_id) };
  });
  r('POST', '/api/orders/:id/charges', async (c) => {
    const o = await orderOf(c, c.params.id);
    const b = c.body || {};
    if (!isUuid(b.charge_item_id)) throw new Error('Choose the charge');
    return tx({ ...c, reason: c.reason || null }, (t) => t.one(`INSERT INTO order_charge (lab_order_id, sample_id, charge_item_id, quantity, unit_price, note)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, charge_no`, [o.id, isUuid(b.sample_id) ? b.sample_id : null, b.charge_item_id, parseInt(b.quantity, 10) || 1, num(b.unit_price), b.note || null]));
  });
  r('PUT', '/api/order-charges/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Charge not found');
    const oc = await c.db.one('SELECT lab_order_id FROM order_charge WHERE id = $1', [c.params.id]);
    if (!oc) throw new Error('Charge not found');
    await orderOf(c, oc.lab_order_id);
    const b = c.body || {};
    return tx({ ...c, reason: c.reason }, async (t) => {
      if (b.cancel) await t.query(`UPDATE order_charge SET status = 'Cancelled' WHERE id = $1`, [c.params.id]);
      else await t.query('UPDATE order_charge SET quantity = COALESCE($2, quantity), unit_price = COALESCE($3, unit_price), note = $4 WHERE id = $1',
        [c.params.id, parseInt(b.quantity, 10) || null, num(b.unit_price), b.note || null]);
      return { ok: true };
    });
  });

  AUDIT_SCOPES.charges = `SELECT 'order_charge', id FROM order_charge WHERE lab_order_id = $1`;
  AUDIT_LISTS.charges = ['charge_item', 'quoted_charge', 'order_charge'];
  AUDIT_LISTS.service_lines = ['service_line', 'service_line_type', 'client_service_line'];
};
