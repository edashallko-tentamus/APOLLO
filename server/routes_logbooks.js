// Electronic logbooks (L-1, migration 034; L-2, migration 035). The logbooks of the lab and what is due; a logbook's
// page (its entries, recording entries in a grid signed once, its design versions and the equipment it covers); an
// entry's page (values, its failure and the batches and studies it flags, corrections, return, void); QA's Logbook
// review (approve entries, signed); the equipment flags of a batch in QC Review and their acceptance; logbook entries
// shown on the equipment, lot and stability study pages. Thin: every rule lives in the database.
'use strict';

module.exports = function registerLogbooks({ route, tx, signedTx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS }) {
  const r = route;
  const perms = async (c, site) => ({
    can_design: await hasPermission(c, 'logbook.design', site), can_record: await hasPermission(c, 'logbook.record', site),
    can_review: await hasPermission(c, 'logbook.review', site),
  });
  const ENTRY_COLS = `e.id, e.entry_code, e.logbook_id, e.version_id, e.site_id, e.entry_at, e.entry_local, e.equipment_id, e.lot_id, e.sample_id, e.entry_values,
    e.result, to_jsonb(e.problems) AS problems, e.failure_reason, e.valid_until, e.status, e.approved_by, e.approved_at, e.review_id, e.approved_in_batch_id,
    e.returned_note, e.void_reason, e.created_lot_id, e.created_at, e.created_by, e.modified_at, e.record_version, e.recorded_signature_id,
    e.logbook_code, e.logbook_name, e.kind, e.subject, e.review_frequency, e.review_route, e.signing, e.version_no, e.site_code, e.equipment_code, e.equipment_name,
    e.lot_code, e.lot_name, e.sample_code, e.recorded_by_name, e.modified_by_name, e.approved_by_name, e.review_due, e.overdue, e.expired,
    e.approved_in_batch_code, e.created_lot_code,
    (SELECT jsonb_build_object('kind', x.sensor_kind, 'start', x.period_start, 'end', x.period_end, 'summary', x.sensor_summary, 'link_id', x.sensor_link_id,
        'sensor', (SELECT s.external_id || COALESCE(' ' || s.sensor_name, '') FROM sensor_link s WHERE s.id = x.sensor_link_id))
       FROM logbook_entry x WHERE x.id = e.id AND x.source = 'Sensor feed') AS sensor`;   // 0.25.0: entries from the sensor feed
  const logbookOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Logbook not found');
    const l = await c.db.one('SELECT * FROM logbook_view WHERE id = $1', [id]);
    if (!l) throw new Error('Logbook not found');
    await checkSite(c, l.site_id);
    return l;
  };
  const entryOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Entry not found');
    const e = await c.db.one(`SELECT ${ENTRY_COLS} FROM logbook_entry_view e WHERE e.id = $1`, [id]);
    if (!e) throw new Error('Entry not found');
    await checkSite(c, e.site_id);
    return e;
  };
  const fieldsOf = (db, versionIds) => db.rows(`SELECT id, version_id, field_key, label, field_type, unit, limit_min, limit_max, equipment_limits, choices, required, formula,
      publish, help, sort_order FROM logbook_field WHERE version_id = ANY($1::uuid[]) AND status = 'Active' ORDER BY sort_order, label`, [versionIds.filter(Boolean)]);
  const choicesOf = (f) => (Array.isArray(f.choices) ? f.choices : f.choices ? String(f.choices).replace(/^\{|\}$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')) : null);
  // Equipment and Lot fields hold ids: their codes for the screen
  async function decorate(db, entries, fields) {
    const ids = new Set();
    for (const e of entries) for (const f of fields) if (['Equipment', 'Lot'].includes(f.field_type) && e.entry_values && e.entry_values[f.field_key]) ids.add(e.entry_values[f.field_key]);
    const list = [...ids].filter(isUuid);
    const names = {};
    if (list.length) {
      for (const x of await db.rows(`SELECT id, equipment_code || ' ' || equipment_name AS t FROM equipment WHERE id = ANY($1::uuid[])
          UNION ALL SELECT id, lot_code || COALESCE(' ' || item_name, '') FROM inventory_lot WHERE id = ANY($1::uuid[])`, [list])) names[x.id] = x.t;
    }
    for (const e of entries) {
      e.display = {};
      for (const f of fields.filter((x) => x.version_id === e.version_id)) {
        const v = e.entry_values ? e.entry_values[f.field_key] : undefined;
        if (v === undefined || v === null) continue;
        e.display[f.field_key] = ['Equipment', 'Lot'].includes(f.field_type) ? (names[v] || v) : v;
      }
    }
    return entries;
  }
  const fmtN = (v) => { const n = Number(v); if (!Number.isFinite(n)) return String(v); return Math.abs(n) >= 1e6 || (Math.abs(n) < 1e-3 && n !== 0) ? n.toExponential(3) : String(Number(n.toPrecision(6))); };
  const summary = (e, fields) => fields.filter((f) => f.version_id === e.version_id && e.display && e.display[f.field_key] !== undefined)
    .map((f) => `${f.label}: ${typeof e.display[f.field_key] === 'number' ? fmtN(e.display[f.field_key]) : e.display[f.field_key]}${f.unit && typeof e.display[f.field_key] === 'number' ? ' ' + f.unit : ''}`).join('; ');

  // ---------------------------------------------------------------- the lab's logbooks and what is due
  r('GET', '/api/logbooks', async (c) => {
    const site = await currentSite(c);
    const [rows, due, toReview] = await Promise.all([
      c.db.rows(`SELECT * FROM logbook_view WHERE site_id = $1 ORDER BY status, logbook_code`, [site]),
      c.db.rows(`SELECT * FROM logbook_due_view WHERE site_id = $1 AND due ORDER BY logbook_code, equipment_code`, [site]),
      c.db.one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE overdue)::int AS late FROM logbook_entry_view WHERE site_id = $1 AND status IN ('Recorded','Returned') AND review_route = 'Logbook'`, [site]),
    ]);
    return { rows, due, to_review: toReview.n, overdue: toReview.late, ...(await perms(c, site)) };
  });
  const SETTINGS = ['logbook_name', 'kind', 'subject', 'entry_frequency', 'review_frequency', 'signing', 'review_route', 'validity_hours', 'creates_lot', 'lot_name', 'lot_unit', 'description', 'status'];
  const settingsOf = (b) => {
    const o = {};
    for (const k of SETTINGS) if (b[k] !== undefined) o[k] = b[k] === '' ? null : b[k];
    if (o.creates_lot !== undefined) o.creates_lot = o.creates_lot === true || o.creates_lot === 'true' || o.creates_lot === 'yes';
    if (o.validity_hours !== undefined && o.validity_hours !== null) o.validity_hours = Number(o.validity_hours);
    return o;
  };
  r('POST', '/api/logbooks', async (c) => {
    const site = await currentSite(c);
    const o = settingsOf(c.body || {});
    if (!String(o.logbook_name || '').trim()) throw new Error('Name the logbook');
    return tx({ ...c, reason: c.body.reason || 'New logbook' }, async (t) => {
      const keys = Object.keys(o).filter((k) => o[k] !== null && k !== 'status');
      const x = await t.one(`INSERT INTO logbook (site_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => '$' + (i + 2)).join(', ')}) RETURNING id, logbook_code`, [site, ...keys.map((k) => o[k])]);
      return x;
    });
  });

  // ---------------------------------------------------------------- QA: Logbook review
  r('GET', '/api/logbooks/review', async (c) => {
    const site = await currentSite(c);
    const rows = await c.db.rows(`SELECT ${ENTRY_COLS} FROM logbook_entry_view e WHERE e.site_id = $1 AND e.status IN ('Recorded','Returned') AND e.review_route = 'Logbook'
        ORDER BY e.overdue DESC, e.logbook_code, e.entry_at`, [site]);
    const fields = (await fieldsOf(c.db, [...new Set(rows.map((x) => x.version_id))])).map((f) => ({ ...f, choices: choicesOf(f) }));
    await decorate(c.db, rows, fields);
    rows.forEach((x) => { x.summary = summary(x, fields); });
    return { rows, me: c.userId, ...(await perms(c, site)) };
  });
  r('POST', '/api/logbooks/review/approve', async (c) => {
    const site = await currentSite(c);
    const ids = (Array.isArray(c.body.ids) ? c.body.ids : []).filter(isUuid);
    if (!ids.length) throw new Error('Choose the entries to approve');
    return signedTx({ ...c, siteId: site, reason: c.body.reason || 'Logbook entries approved by QA' },
      { meaning: 'Approved by', action: `QA approval of ${ids.length} logbook entr${ids.length === 1 ? 'y' : 'ies'}`, module: 'Logbooks' },
      async (t) => ({ approved: (await t.one('SELECT approve_logbook_entries($1::uuid[], $2) AS n', [ids, c.body.comment || null])).n }));
  });

  // stability excursions of a study (registered before /api/logbooks/:id)
  r('GET', '/api/logbooks/excursions', async (c) => {
    if (!isUuid(c.query.study)) return { rows: [] };
    const st = await c.db.one('SELECT id, site_id FROM stability_study WHERE id = $1', [c.query.study]);
    if (!st) throw new Error('Study not found');
    await checkSite(c, st.site_id);
    return { rows: await c.db.rows(`SELECT logbook_entry_id, entry_code, logbook_name, equipment_id, equipment_code, equipment_name, entry_at, to_jsonb(problems) AS problems, failure_reason,
        status, storage_code, rack_code, condition_name, window_end FROM stability_excursion_view WHERE study_id = $1 ORDER BY entry_at DESC`, [st.id]) };
  });

  // ---------------------------------------------------------------- a logbook
  r('GET', '/api/logbooks/:id', async (c) => {
    const l = await logbookOf(c, c.params.id);
    const versions = await c.db.rows(`SELECT v.*, au.full_name AS approved_by_name, cu.full_name AS created_by_name FROM logbook_version v
        LEFT JOIN app_user au ON au.id = v.approved_by JOIN app_user cu ON cu.id = v.created_by WHERE v.logbook_id = $1 ORDER BY v.version_no DESC`, [l.id]);
    const eff = versions.find((v) => v.status === 'Effective'); const draft = versions.find((v) => v.status === 'Draft');
    const q = c.query || {};
    const cond = ['e.logbook_id = $1']; const args = [l.id];
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { args.push(q.from); cond.push(`left(e.entry_local, 10) >= $${args.length}`); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { args.push(q.to); cond.push(`left(e.entry_local, 10) <= $${args.length}`); }
    if (isUuid(q.equipment)) { args.push(q.equipment); cond.push(`e.equipment_id = $${args.length}`); }
    if (q.status && q.status !== 'All') { args.push(q.status); cond.push(`e.status = $${args.length}`); } else if (!q.status) cond.push(`e.status <> 'Voided'`);
    const [entries, equipment, due, problems, labEquipment, lots] = await Promise.all([
      c.db.rows(`SELECT ${ENTRY_COLS} FROM logbook_entry_view e WHERE ${cond.join(' AND ')} ORDER BY e.entry_at DESC LIMIT 500`, args),
      c.db.rows(`SELECT le.id, le.equipment_id, le.limits, le.notes, le.status, e.equipment_code, e.equipment_name, e.admin_status::text AS admin_status, t.type_name,
            sc.condition_name, sc.temperature_c, sc.temperature_tol, sc.humidity_pct, sc.humidity_tol
          FROM logbook_equipment le JOIN equipment e ON e.id = le.equipment_id JOIN equipment_type t ON t.id = e.equipment_type_id
          LEFT JOIN stability_chamber ch ON ch.equipment_id = e.id AND ch.status = 'Active' LEFT JOIN stability_condition sc ON sc.id = ch.condition_id
         WHERE le.logbook_id = $1 AND le.status = 'Active' ORDER BY e.equipment_name`, [l.id]),
      c.db.rows('SELECT * FROM logbook_due_view WHERE logbook_id = $1 ORDER BY equipment_code', [l.id]),
      draft ? c.db.rows('SELECT * FROM logbook_version_problems($1)', [draft.id]) : [],
      c.db.rows(`SELECT e.id, e.equipment_code, e.equipment_name, e.type_name, e.availability, e.calibration_status FROM equipment_view e
          WHERE e.site_id = $1 AND e.admin_status <> 'Retired' ORDER BY e.equipment_name`, [l.site_id]),
      c.db.rows(`SELECT l.id, l.lot_code, COALESCE(l.item_name, '') AS item_name, l.expiration_date, l.status::text AS status FROM inventory_lot l
          WHERE l.site_id = $1 AND l.receipt_status = 'Received' AND l.status = 'Available' AND NOT ('Consumable' = ANY(l.chemical_types) AND cardinality(l.chemical_types) = 1)
          ORDER BY l.item_name, l.lot_code`, [l.site_id]),
    ]);
    const fields = (await fieldsOf(c.db, [eff && eff.id, draft && draft.id])).map((f) => ({ ...f, choices: choicesOf(f) }));
    // fields of older versions, for entries made against them
    const older = [...new Set(entries.map((e) => e.version_id))].filter((v) => v !== (eff && eff.id) && v !== (draft && draft.id));
    const oldFields = older.length ? (await fieldsOf(c.db, older)).map((f) => ({ ...f, choices: choicesOf(f) })) : [];
    await decorate(c.db, entries, [...fields, ...oldFields]);
    return { logbook: l, versions, effective_id: eff ? eff.id : null, draft_id: draft ? draft.id : null, fields, old_fields: oldFields, equipment, entries, due, problems,
      opts: { equipment: labEquipment, lots }, ...(await perms(c, l.site_id)) };
  });
  r('POST', '/api/logbooks/:id/settings', async (c) => {
    const l = await logbookOf(c, c.params.id);
    const o = settingsOf(c.body || {});
    const keys = Object.keys(o);
    if (!keys.length) return { ok: true };
    return tx({ ...c, reason: c.body.reason || 'Logbook settings changed' }, async (t) => {
      await t.query(`UPDATE logbook SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [l.id, ...keys.map((k) => o[k])]);
      return { ok: true };
    });
  });
  r('POST', '/api/logbooks/:id/new-version', async (c) => {
    const l = await logbookOf(c, c.params.id);
    return tx({ ...c, reason: c.body.reason || 'New logbook version' }, async (t) => ({ id: (await t.one('SELECT new_logbook_version($1, $2) AS id', [l.id, c.body.summary || null])).id }));
  });
  const FIELD_COLS = ['field_key', 'label', 'field_type', 'unit', 'limit_min', 'limit_max', 'equipment_limits', 'choices', 'required', 'formula', 'publish', 'help', 'sort_order', 'status'];
  r('POST', '/api/logbooks/:id/fields', async (c) => {
    const l = await logbookOf(c, c.params.id);
    const draft = await c.db.one(`SELECT id FROM logbook_version WHERE logbook_id = $1 AND status = 'Draft'`, [l.id]);
    if (!draft) throw new Error('Start a new version first: the Effective design is locked');
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    return tx({ ...c, reason: c.body.reason || 'Logbook design changed' }, async (t) => {
      for (const x of rows) {
        const o = {};
        for (const k of FIELD_COLS) if (x[k] !== undefined) o[k] = x[k] === '' ? null : x[k];
        if (o.choices !== undefined && o.choices !== null) {
          const list = Array.isArray(o.choices) ? o.choices : String(o.choices).split(/[;,]/);
          o.choices = '{' + list.map((s) => String(s).trim()).filter(Boolean).map((s) => '"' + s.replace(/["\\]/g, '') + '"').join(',') + '}';
        }
        for (const k of ['equipment_limits', 'required', 'publish']) if (o[k] !== undefined && o[k] !== null) o[k] = o[k] === true || o[k] === 'true' || o[k] === 'yes';
        for (const k of ['limit_min', 'limit_max', 'sort_order']) if (o[k] !== undefined && o[k] !== null) o[k] = Number(o[k]);
        if (x.id) {
          if (!isUuid(x.id)) throw new Error('Unknown field');
          const keys = Object.keys(o); if (!keys.length) continue;
          await t.query(`UPDATE logbook_field SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND version_id = $2`, [x.id, draft.id, ...keys.map((k) => o[k])]);
        } else {
          const keys = Object.keys(o).filter((k) => o[k] !== null);
          await t.query(`INSERT INTO logbook_field (version_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => '$' + (i + 2)).join(', ')})`, [draft.id, ...keys.map((k) => o[k])]);
        }
      }
      return { saved: rows.length };
    });
  });
  r('POST', '/api/logbooks/:id/approve', async (c) => {
    const l = await logbookOf(c, c.params.id);
    const draft = await c.db.one(`SELECT id, version_no FROM logbook_version WHERE logbook_id = $1 AND status = 'Draft'`, [l.id]);
    if (!draft) throw new Error('There is no Draft to approve');
    return signedTx({ ...c, reason: c.body.reason || 'Logbook design approved' }, { meaning: 'Approved by', action: `Design version ${draft.version_no} of ${l.logbook_code} ${l.logbook_name}`, module: 'Logbooks' },
      async (t) => { await t.query('SELECT approve_logbook_version($1)', [draft.id]); return { ok: true }; });
  });
  r('POST', '/api/logbooks/:id/equipment', async (c) => {
    const l = await logbookOf(c, c.params.id);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    return tx({ ...c, reason: c.body.reason || 'Equipment covered by the logbook changed' }, async (t) => {
      for (const x of rows) {
        const limits = x.limits && typeof x.limits === 'object' ? JSON.stringify(x.limits) : undefined;
        if (x.id) {
          if (!isUuid(x.id)) throw new Error('Unknown row');
          const sets = []; const args = [x.id, l.id];
          if (limits !== undefined) { args.push(limits); sets.push(`limits = $${args.length}::jsonb`); }
          if (x.notes !== undefined) { args.push(x.notes || null); sets.push(`notes = $${args.length}`); }
          if (x.status !== undefined) { args.push(x.status); sets.push(`status = $${args.length}`); }
          if (sets.length) await t.query(`UPDATE logbook_equipment SET ${sets.join(', ')} WHERE id = $1 AND logbook_id = $2`, args);
        } else {
          if (!isUuid(x.equipment_id)) throw new Error('Choose the equipment');
          await t.query('INSERT INTO logbook_equipment (logbook_id, equipment_id, limits, notes) VALUES ($1, $2, COALESCE($3::jsonb, \'{}\'), $4)', [l.id, x.equipment_id, limits ?? null, x.notes || null]);
        }
      }
      return { saved: rows.length };
    });
  });

  // ---------------------------------------------------------------- recording entries: one save (and one signature) for the rows
  const resolve = async (t, site, kind, v) => {
    const s = String(v ?? '').trim(); if (!s) return null;
    if (kind === 'equipment') {
      const x = await t.one(`SELECT id FROM equipment WHERE site_id = $1 AND (id::text = $2 OR lower(equipment_code) = lower($2) OR lower(equipment_name) = lower($2)) LIMIT 1`, [site, s]);
      if (!x) throw new Error(`No equipment "${s}" at this lab`); return x.id;
    }
    if (kind === 'lot') {
      const x = await t.one(`SELECT id FROM inventory_lot WHERE site_id = $1 AND (id::text = $2 OR lower(lot_code) = lower($2)) LIMIT 1`, [site, s]);
      if (!x) throw new Error(`No lot "${s}" at this lab`); return x.id;
    }
    const x = await t.one(`SELECT s.id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = $1 AND (s.id::text = $2 OR lower(s.sample_code) = lower($2)) LIMIT 1`, [site, s]);
    if (!x) throw new Error(`No sample "${s}" at this lab`); return x.id;
  };
  const toLocal = (v) => { const s = String(v || '').trim(); if (!s) return null; const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/); if (!m) throw new Error(`"${s}": write the date and time as YYYY-MM-DD HH:MM`); return `${m[1]} ${m[2].padStart(2, '0')}:${m[3]}`; };
  async function insertEntries(t, l, rows) {
    const made = [];
    for (let i = 0; i < rows.length; i += 1) {
      const x = rows[i];
      try {
        const at = toLocal(x.entry_at);
        const eq = l.subject === 'Equipment' ? await resolve(t, l.site_id, 'equipment', x.equipment_id || x.equipment) : null;
        const lot = l.subject === 'Lot' && !l.creates_lot ? await resolve(t, l.site_id, 'lot', x.lot_id || x.lot) : null;
        const smp = l.subject === 'Sample' ? await resolve(t, l.site_id, 'sample', x.sample_id || x.sample) : null;
        const vals = x.values && typeof x.values === 'object' ? x.values : {};
        const e = await t.one(`INSERT INTO logbook_entry (logbook_id, entry_at, equipment_id, lot_id, sample_id, entry_values, failure_reason)
            VALUES ($1, CASE WHEN $2::text IS NULL THEN clock_timestamp() ELSE ($2::timestamp AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = $8)) END, $3, $4, $5, $6::jsonb, $7)
            RETURNING id, entry_code, result, lot_id`, [l.id, at, eq, lot, smp, JSON.stringify(vals), x.failure_reason || null, l.site_id]);
        made.push(e);
      } catch (err) { throw new Error(`Row ${i + 1}: ${err.message}`); }
    }
    return made;
  }
  r('POST', '/api/logbooks/:id/entries', async (c) => {
    const l = await logbookOf(c, c.params.id);
    const rows = Array.isArray(c.body.rows) ? c.body.rows : [];
    if (!rows.length) throw new Error('Nothing to record');
    const go = async (t) => {
      const made = await insertEntries(t, l, rows);
      // the lots made by the entries (an AFTER INSERT trigger makes them, so RETURNING does not see them yet)
      const lots = l.creates_lot && made.length
        ? await t.rows(`SELECT l.id, l.lot_code FROM logbook_entry e JOIN inventory_lot l ON l.id = e.created_lot_id WHERE e.id = ANY($1::uuid[]) ORDER BY l.lot_code`, [made.map((x) => x.id)]) : [];
      return { made: made.map((x) => x.entry_code), failed: made.filter((x) => x.result === 'Fail').map((x) => x.entry_code), lots };
    };
    const ctx = { ...c, reason: c.body.reason || 'Logbook entries recorded' };
    if (l.signing === 'Signature') return signedTx(ctx, { meaning: 'Recorded by', action: `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} in ${l.logbook_code} ${l.logbook_name}`, module: 'Logbooks' }, go);
    return tx(ctx, go);
  });

  // ---------------------------------------------------------------- an entry
  r('GET', '/api/logbooks/entries/:id', async (c) => {
    const e = await entryOf(c, c.params.id);
    const fields = (await fieldsOf(c.db, [e.version_id])).map((f) => ({ ...f, choices: choicesOf(f) }));
    await decorate(c.db, [e], fields);
    const [failure, flags, excursions, review, logbook] = await Promise.all([
      c.db.one('SELECT window_start, window_end FROM equipment_failure_view WHERE logbook_entry_id = $1', [e.id]),
      c.db.rows(`WITH w AS (SELECT * FROM equipment_failure_view WHERE logbook_entry_id = $1),
          b AS (SELECT DISTINCT r.batch_id FROM entry_equipment q JOIN step_run r ON r.id = q.step_run_id, w
                 WHERE q.equipment_id = w.equipment_id AND q.status = 'Active' AND q.created_at > w.window_start AND q.created_at < COALESCE(w.window_end, 'infinity'::timestamptz)
                UNION SELECT DISTINCT r.batch_id FROM incubation_load il JOIN step_run r ON r.id = il.step_run_id, w
                 WHERE il.equipment_id = w.equipment_id AND il.status = 'Active' AND COALESCE(il.time_out, clock_timestamp()) > w.window_start AND il.time_in < COALESCE(w.window_end, 'infinity'::timestamptz))
        SELECT tb.id AS batch_id, tb.batch_code, tb.status::text AS batch_status, f.step_name, f.accepted, f.justification, f.accepted_by_name, f.used_at
          FROM b JOIN test_batch tb ON tb.id = b.batch_id CROSS JOIN LATERAL batch_equipment_flags(b.batch_id) f WHERE f.logbook_entry_id = $1 ORDER BY tb.batch_code`, [e.id]),
      c.db.rows('SELECT study_id, study_code, storage_code, rack_code, condition_name FROM stability_excursion_view WHERE logbook_entry_id = $1 ORDER BY study_code', [e.id]),
      e.review_id ? c.db.one('SELECT r.*, u.full_name AS by_name FROM logbook_review r JOIN app_user u ON u.id = r.created_by WHERE r.id = $1', [e.review_id]) : null,
      c.db.one('SELECT * FROM logbook WHERE id = $1', [e.logbook_id]),
    ]);
    const lim = await c.db.rows('SELECT f.field_key, x.lo, x.hi FROM logbook_field f CROSS JOIN LATERAL logbook_limits(f.id, $2) x WHERE f.version_id = $1 AND f.status = \'Active\'', [e.version_id, e.equipment_id]);
    const limits = Object.fromEntries(lim.map((x) => [x.field_key, { lo: x.lo, hi: x.hi }]));
    // L-2: the results that used it (migration 035); absent before it
    let uses = [];
    try { uses = await c.db.rows('SELECT * FROM logbook_entry_uses($1)', [e.id]); } catch (_) { uses = []; }
    return { entry: e, fields, limits, failure, flags, excursions, review, logbook, uses, can_resolve: await hasPermission(c, 'testing.review', e.site_id), ...(await perms(c, e.site_id)), me: c.userId };
  });
  r('POST', '/api/logbooks/entries/:id/correct', async (c) => {
    const e = await entryOf(c, c.params.id);
    const vals = c.body.values && typeof c.body.values === 'object' ? c.body.values : null;
    if (!vals) throw new Error('Nothing to correct');
    const go = async (t) => {
      const at = toLocal(c.body.entry_at);
      await t.query(`UPDATE logbook_entry SET entry_values = $2::jsonb, failure_reason = $3,
          entry_at = CASE WHEN $4::text IS NULL THEN entry_at ELSE ($4::timestamp AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = site_id)) END WHERE id = $1`,
      [e.id, JSON.stringify(vals), c.body.failure_reason || null, at]);
      return { ok: true };
    };
    if (!String(c.body.reason || '').trim()) throw new Error('Give the reason for the correction');
    if (e.signing === 'Signature') return signedTx(c, { meaning: 'Changed by', action: `Correct ${e.entry_code} (${e.logbook_code})`, module: 'Logbooks' }, go);
    return tx(c, go);
  });
  r('POST', '/api/logbooks/entries/:id/return', async (c) => {
    const e = await entryOf(c, c.params.id);
    return tx({ ...c, reason: c.body.reason || 'Returned for correction by QA' }, async (t) => { await t.query('SELECT return_logbook_entry($1, $2)', [e.id, c.body.note || '']); return { ok: true }; });
  });
  r('POST', '/api/logbooks/entries/:id/void', async (c) => {
    const e = await entryOf(c, c.params.id);
    const why = String(c.body.void_reason || c.body.reason || '').trim();
    const go = async (t) => { await t.query('SELECT void_logbook_entry($1, $2)', [e.id, why]); return { ok: true }; };
    const ctx = { ...c, reason: c.body.reason || 'Logbook entry voided' };
    if (e.signing === 'Signature') return signedTx(ctx, { meaning: 'Changed by', action: `Void ${e.entry_code} (${e.logbook_code})`, module: 'Logbooks' }, go);
    return tx(ctx, go);
  });

  // ---------------------------------------------------------------- equipment flags in QC Review
  r('GET', '/api/testing/batches/:id/equipment-flags', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Batch not found');
    const b = await c.db.one('SELECT id, site_id, status::text AS status FROM test_batch WHERE id = $1', [c.params.id]);
    if (!b) throw new Error('Batch not found');
    await checkSite(c, b.site_id);
    const rows = await c.db.rows(`SELECT f.*, to_char(f.entry_at, 'YYYY-MM-DD HH24:MI') AS entry_at_text FROM batch_equipment_flags($1) f`, [b.id]);
    return { rows };
  });
  r('POST', '/api/testing/batches/:id/accept-flag', async (c) => {
    if (!isUuid(c.params.id) || !isUuid(c.body.logbook_entry_id)) throw new Error('Not found');
    const b = await c.db.one('SELECT id, site_id FROM test_batch WHERE id = $1', [c.params.id]);
    if (!b) throw new Error('Batch not found');
    await checkSite(c, b.site_id);
    return tx({ ...c, reason: c.body.reason || 'Equipment flag accepted by the reviewer' }, async (t) => {
      await t.query('SELECT accept_equipment_flag($1, $2, $3)', [b.id, c.body.logbook_entry_id, c.body.justification || '']);
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- the bench and QC Review (L-2, migration 035)
  const batchSite = async (c, id) => {
    if (!isUuid(id)) throw new Error('Batch not found');
    const b = await c.db.one('SELECT id, site_id, status::text AS status FROM test_batch WHERE id = $1', [id]);
    if (!b) throw new Error('Batch not found');
    await checkSite(c, b.site_id);
    return b;
  };
  // the usable logbook entries of the lab's lots (offered when a lot has several)
  r('GET', '/api/testing/batches/:id/lot-entries', async (c) => {
    const b = await batchSite(c, c.params.id);
    return { rows: await c.db.rows(`SELECT x.*, l.lot_code FROM inventory_lot l CROSS JOIN LATERAL lot_value_entries(l.id) x
        WHERE l.site_id = $1 AND l.status = 'Available' AND x.usable ORDER BY l.lot_code, x.entry_at DESC`, [b.site_id]) };
  });
  r('POST', '/api/testing/step-runs/:id/scan-aliquot', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Step not found');
    const run = await c.db.one('SELECT r.id, b.site_id FROM step_run r JOIN test_batch b ON b.id = r.batch_id WHERE r.id = $1', [c.params.id]);
    if (!run) throw new Error('Step not found');
    await checkSite(c, run.site_id);
    const code = String(c.body.code || '').trim();
    if (!code) throw new Error('Scan the aliquot\'s barcode');
    return tx({ ...c, reason: c.body.reason || `Weight from aliquot ${code.toUpperCase()}` }, async (t) => ({ label: (await t.one('SELECT scan_aliquot($1, $2) AS x', [run.id, code])).x }));
  });
  r('GET', '/api/testing/batches/:id/aliquots', async (c) => {
    const b = await batchSite(c, c.params.id);
    return { rows: await c.db.rows('SELECT * FROM batch_aliquots($1)', [b.id]) };
  });
  // a reviewer resolves a result flagged by a logbook correction
  r('POST', '/api/logbooks/flags/:id/resolve', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Flag not found');
    const f = await c.db.one('SELECT f.id, b.site_id FROM logbook_result_flag f JOIN test_result tr ON tr.id = f.test_result_id JOIN test_batch b ON b.id = tr.batch_id WHERE f.id = $1', [c.params.id]);
    if (!f) throw new Error('Flag not found');
    await checkSite(c, f.site_id);
    return tx({ ...c, reason: c.body.reason || 'Logbook correction reviewed for a result' }, async (t) => { await t.query('SELECT resolve_logbook_flag($1, $2)', [f.id, c.body.note || '']); return { ok: true }; });
  });

  // ---------------------------------------------------------------- logbook entries on other pages
  r('GET', '/api/logbooks/for-equipment/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Equipment not found');
    const eq = await c.db.one('SELECT id, site_id FROM equipment WHERE id = $1', [c.params.id]);
    if (!eq) throw new Error('Equipment not found');
    await checkSite(c, eq.site_id);
    const [logbooks, entries, open] = await Promise.all([
      c.db.rows(`SELECT l.id, l.logbook_code, l.logbook_name, l.kind, l.entry_frequency,
            (SELECT x.result FROM logbook_entry x WHERE x.logbook_id = l.id AND x.equipment_id = $1 AND x.status <> 'Voided' ORDER BY x.entry_at DESC LIMIT 1) AS last_result,
            (SELECT max(x.entry_at) FROM logbook_entry x WHERE x.logbook_id = l.id AND x.equipment_id = $1 AND x.status <> 'Voided') AS last_entry_at,
            (SELECT d.due FROM logbook_due_view d WHERE d.logbook_id = l.id AND d.equipment_id = $1) AS due
          FROM logbook l JOIN logbook_equipment le ON le.logbook_id = l.id AND le.status = 'Active' WHERE le.equipment_id = $1 ORDER BY l.logbook_code`, [eq.id]),
      c.db.rows(`SELECT ${ENTRY_COLS} FROM logbook_entry_view e WHERE e.equipment_id = $1 AND e.status <> 'Voided' ORDER BY e.entry_at DESC LIMIT 40`, [eq.id]),
      c.db.rows(`SELECT logbook_entry_id, entry_code, logbook_name, entry_at, to_jsonb(problems) AS problems, failure_reason FROM equipment_failure_view
          WHERE equipment_id = $1 AND window_end IS NULL ORDER BY entry_at DESC`, [eq.id]),
    ]);
    const fields = (await fieldsOf(c.db, [...new Set(entries.map((x) => x.version_id))]));
    await decorate(c.db, entries, fields);
    entries.forEach((x) => { x.summary = summary(x, fields); });
    return { logbooks, entries, open_failures: open };
  });
  r('GET', '/api/logbooks/for-lot/:id', async (c) => {
    if (!isUuid(c.params.id)) throw new Error('Lot not found');
    const lot = await c.db.one('SELECT id, site_id FROM inventory_lot WHERE id = $1', [c.params.id]);
    if (!lot) throw new Error('Lot not found');
    await checkSite(c, lot.site_id);
    const entries = await c.db.rows(`SELECT ${ENTRY_COLS} FROM logbook_entry_view e WHERE (e.lot_id = $1 OR e.created_lot_id = $1) AND e.status <> 'Voided' ORDER BY e.entry_at DESC LIMIT 40`, [lot.id]);
    const fields = (await fieldsOf(c.db, [...new Set(entries.map((x) => x.version_id))]));
    await decorate(c.db, entries, fields);
    entries.forEach((x) => { x.summary = summary(x, fields); });
    return { entries };
  });
  // ---------------------------------------------------------------- audit trail
  AUDIT_SCOPES.logbook = `SELECT 'logbook', $1::uuid UNION ALL SELECT 'logbook_version', id FROM logbook_version WHERE logbook_id = $1
    UNION ALL SELECT 'logbook_field', f.id FROM logbook_field f JOIN logbook_version v ON v.id = f.version_id WHERE v.logbook_id = $1
    UNION ALL SELECT 'logbook_equipment', id FROM logbook_equipment WHERE logbook_id = $1 UNION ALL SELECT 'logbook_review', id FROM logbook_review WHERE logbook_id = $1`;
  AUDIT_SCOPES.logbook_entry = `SELECT 'logbook_entry', $1::uuid`;
  AUDIT_CHECKS.logbook = async (c, id) => { await logbookOf(c, id); };
  AUDIT_CHECKS.logbook_entry = async (c, id) => { await entryOf(c, id); };
  AUDIT_LISTS.logbooks = ['logbook', 'logbook_version', 'logbook_field', 'logbook_equipment', 'logbook_review', 'logbook_entry', 'equipment_flag_acceptance'];
};
