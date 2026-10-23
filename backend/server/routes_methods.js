// Workflow Designer API (WD-1, migration 012): tests and their versions, analytes, workflow steps with equipment and
// dependencies, the problem list, approval, new versions, duplicates and copies to another lab, methods (SOPs), the
// formula try-out, and specifications on quoted and requested tests. Thin: every rule lives in the database.
'use strict';

const MESSAGES = {
  test_name_uq: 'This lab already has a test with that name.',
  method_name_uq: 'This lab already has a method with that name.',
  tva_uq: 'That analyte is already on this version.',
  tva_lod_le_loq: 'The LOD cannot be above the LOQ.',
  tva_spec_order: 'The suggested minimum cannot be above the maximum.',
  tva_rounding_pair: 'Choose both the rounding (significant figures or decimal places) and the number of digits, or neither.',
  tva_sig_figs: 'Use at least 1 significant figure.',
  test_version_sig_figs: 'Use at least 1 significant figure.',
  workflow_step_key_uq: 'Another step in this version already uses that key.',
  workflow_step_step_key_check: 'The step key is a short lower-case word (letters, numbers, _), used in formulas like {weigh.weight}.',
  workflow_step_dependency_uq: 'That dependency is already there.',
  step_not_own_dependency: 'A step cannot come after itself.',
  specification_has_limit: 'Give each limit a minimum, a maximum or a text (e.g. Absent); leave the row empty for unspecified.',
  specification_order: 'The minimum cannot be above the maximum.',
  specification_line_uq: 'That analyte already has a specification here.',
  specification_rt_uq: 'That analyte already has a specification here.',
};
function translate(e) {
  const m = String(e.message || e);
  for (const [k, v] of Object.entries(MESSAGES)) if (m.includes(`"${k}"`)) { const n = new Error(v); n.code = e.code; return n; }
  return e;
}
const TVA_FIELDS = ['analyte_id', 'sort_order', 'result_type', 'reporting_unit', 'loq', 'lod', 'rounding_mode', 'rounding_digits', 'hide_on_report', 'hide_loq', 'hide_lod',
  'default_spec_min', 'default_spec_max', 'default_spec_text', 'result_values', 'found_values', 'invalid_values', 'status',
  'uncertainty', 'uncertainty_kind', 'report_uncertainty'];   // (measurement uncertainty: migration 028)
// arrays (result values) go to the database as Postgres array text
const pgArr = (a) => '{' + a.map((x) => '"' + String(x).replace(/["\\]/g, (m) => '\\' + m) + '"').join(',') + '}';
const arrRows = (rows) => rows.map((r) => { const o = { ...r }; for (const k of ['result_values', 'found_values', 'invalid_values']) if (Array.isArray(o[k])) o[k] = pgArr(o[k]); return o; });
const SPEC_FIELDS = ['analyte_id', 'min_value', 'max_value', 'text_value', 'unit', 'source', 'basis', 'status'];   // basis: per serving / per package (031)

module.exports = function registerMethods({ route, tx, signedTx, upsertRows, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS }) {
  const r = (method, pattern, fn) => route(method, pattern, async (c) => { try { return await fn(c); } catch (e) { throw translate(e); } });
  // Every creation and change of a test workflow is signed (migration 015, Alex 2026-10-13): Created by / Changed by.
  // Changes to existing records also carry the signer's reason (the screens ask for it; the database requires it on updates).
  const designTx = (c, meaning, action, fn) => signedTx(c, { meaning, action, module: 'Methods' }, fn);
  const vName = (v) => `${v.test_name}, version ${v.version_no}`;
  const testOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Test not found');
    const t = await c.db.one('SELECT * FROM test_design_view WHERE id = $1', [id]);
    if (!t) throw new Error('Test not found');
    if (t.site_id) await checkSite(c, t.site_id);
    return t;
  };
  const versionOf = async (c, id) => {
    if (!isUuid(id)) throw new Error('Test version not found');
    const v = await c.db.one('SELECT v.*, t.site_id, t.test_name FROM test_version v JOIN test t ON t.id = v.test_id WHERE v.id = $1', [id]);
    if (!v) throw new Error('Test version not found');
    if (v.site_id) await checkSite(c, v.site_id);
    return v;
  };
  const me = async (c) => ({ can_design: await hasPermission(c, 'methods.design'), can_approve: await hasPermission(c, 'methods.approve'),
    can_catalog: await hasPermission(c, 'catalog.edit') });

  r('GET', '/api/methods/me', async (c) => { await currentSite(c); return me(c); });
  r('GET', '/api/methods/new-options', async (c) => {
    const site = await currentSite(c);
    return { departments: await c.db.rows("SELECT id, department_code, department_name FROM department WHERE site_id = $1 AND status = 'Active' ORDER BY department_code", [site]),
      methods: await c.db.rows("SELECT id, method_name, sop_code FROM method WHERE site_id = $1 AND status = 'Active' ORDER BY method_name", [site]) };
  });

  // ------------------------------------------------------------ tests
  r('GET', '/api/methods/tests', async (c) => {
    const site = await currentSite(c);
    const rows = await c.db.rows(`SELECT v.*, (SELECT count(*) FROM test_version_problems(v.draft_version_id) p WHERE p.severity = 'Error') AS draft_problems
      FROM test_design_view v WHERE v.site_id = $1 OR v.site_id IS NULL ORDER BY v.site_id IS NULL, lower(v.test_name)`, [site]);
    return { rows, ...(await me(c)) };
  });
  r('POST', '/api/methods/tests', async (c) => {
    const site = await currentSite(c);
    const b = c.body.row || {};
    if (!String(b.test_name || '').trim()) throw new Error('Name the test');
    return designTx(c, 'Created by', `New test: ${String(b.test_name).trim()}`, async (t) => {
      const x = await t.one('SELECT create_test($1, $2, $3, $4) AS id', [site, String(b.test_name).trim(), b.department_id || null, b.method_id || null]);
      return t.one('SELECT id, (SELECT id FROM test_version WHERE test_id = $1) AS version_id FROM test WHERE id = $1', [x.id]);
    });
  });
  r('GET', '/api/methods/tests/:id', async (c) => {
    const t = await testOf(c, c.params.id);
    const versions = await c.db.rows(`SELECT v.id, v.version_no, v.status, v.effective_from, v.change_summary, v.created_at, cu.full_name AS created_by_name,
        au.full_name AS approved_by_name, v.approved_at, m.method_name, m.sop_code
      FROM test_version v JOIN app_user cu ON cu.id = v.created_by LEFT JOIN app_user au ON au.id = v.approved_by LEFT JOIN method m ON m.id = v.method_id
      WHERE v.test_id = $1 ORDER BY v.version_no DESC`, [t.id]);
    const copies = await c.db.rows(`SELECT t.id, t.test_code, t.test_name, s.site_code FROM test t LEFT JOIN lab_site s ON s.id = t.site_id WHERE t.copied_from_test_id = $1 ORDER BY t.test_code`, [t.id]);
    const sites = await c.db.rows(`SELECT s.id, s.site_code, s.site_name FROM lab_site s WHERE s.status = 'Active' AND user_can_access_site($1, s.id) ORDER BY s.site_code`, [c.userId]);
    return { test: t, versions, copies, sites, ...(await me(c)) };
  });
  r('POST', '/api/methods/tests/:id/new-version', async (c) => {
    const t = await testOf(c, c.params.id);
    return designTx(c, 'Created by', `New version of ${t.test_code} ${t.test_name}`, (x) => x.one('SELECT new_test_version($1) AS id', [t.id]));
  });
  r('POST', '/api/methods/tests/:id/copy', async (c) => {
    const t = await testOf(c, c.params.id);
    const site = isUuid(c.body.site_id) ? c.body.site_id : await currentSite(c);
    if (!String(c.body.test_name || '').trim()) throw new Error('Name the copy');
    return designTx(c, 'Created by', `${site === t.site_id ? 'Duplicate' : 'Copy to another lab'} of ${t.test_code} ${t.test_name}: ${String(c.body.test_name).trim()}`, async (x) => {
      const n = await x.one('SELECT copy_test($1, $2, $3) AS id', [t.id, site, String(c.body.test_name).trim()]);
      return x.one(`SELECT t.id, t.test_code, t.site_id, (SELECT id FROM test_version WHERE test_id = t.id) AS version_id FROM test t WHERE t.id = $1`, [n.id]);
    });
  });

  // ------------------------------------------------------------ a version in the designer
  r('GET', '/api/methods/versions/:id', async (c) => {
    const v = await versionOf(c, c.params.id);
    const site = v.site_id;
    const test = await c.db.one('SELECT * FROM test_design_view WHERE id = $1', [v.test_id]);
    const [analytes, steps, equipment, deps, problems, departments, types, methods, allAnalytes, units, tests, qcTypes, limitTypes, entry, authors, approver, categories] = await Promise.all([
      c.db.rows(`SELECT a.*, an.analyte_name, an.analyte_code, an.analyte_class FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
        WHERE a.test_version_id = $1 AND a.status = 'Active' ORDER BY a.sort_order, an.analyte_name`, [v.id]),
      c.db.rows(`SELECT s.*, d.department_code, step_token_fields(s.id) AS tokens FROM workflow_step s LEFT JOIN department d ON d.id = s.department_id
        WHERE s.test_version_id = $1 AND s.status = 'Active' ORDER BY s.sort_order, s.step_key`, [v.id]),
      c.db.rows(`SELECT e.id, e.step_id, e.equipment_type_id, e.is_main, et.type_name FROM workflow_step_equipment e JOIN equipment_type et ON et.id = e.equipment_type_id
        JOIN workflow_step s ON s.id = e.step_id WHERE s.test_version_id = $1 AND e.status = 'Active' ORDER BY e.is_main DESC, et.type_name`, [v.id]),
      c.db.rows(`SELECT d.id, d.step_id, d.depends_on_step_id, d.dependency_type FROM workflow_step_dependency d JOIN workflow_step s ON s.id = d.step_id
        WHERE s.test_version_id = $1 AND d.status = 'Active'`, [v.id]),
      c.db.rows('SELECT * FROM test_version_problems($1)', [v.id]),
      c.db.rows(`SELECT d.id, d.department_code, d.department_name, department_has_people(d.id) AS has_people,
          (SELECT string_agg(g.group_name, ', ') FROM lab_group g WHERE g.department_id = d.id AND g.status = 'Active') AS groups
        FROM department d WHERE d.site_id IS NOT DISTINCT FROM $1 AND d.status = 'Active' ORDER BY d.department_code`, [site]),
      c.db.rows(`SELECT id, type_name FROM equipment_type WHERE site_id IS NOT DISTINCT FROM $1 AND status = 'Active' ORDER BY type_name`, [site]),
      c.db.rows(`SELECT id, method_code, method_name, sop_code, status FROM method WHERE site_id IS NOT DISTINCT FROM $1 ORDER BY method_name`, [site]),
      c.db.rows(`SELECT id, analyte_code, analyte_name, analyte_class FROM analyte WHERE status = 'Active' ORDER BY analyte_name`),
      c.db.rows(`SELECT unit_code FROM unit_of_measure WHERE status = 'Active' ORDER BY sort_order, unit_code`),
      c.db.rows(`SELECT t.id, t.test_code, t.test_name FROM test t WHERE t.status = 'Active' AND t.id <> $2 AND (t.site_id IS NULL OR t.site_id IS NOT DISTINCT FROM $1) ORDER BY t.test_name`, [site, v.test_id]),
      c.db.rows('SELECT * FROM qc_type ORDER BY sort_order'),
      c.db.rows('SELECT * FROM qc_limit_type ORDER BY sort_order'),
      c.db.one('SELECT * FROM test_catalogue WHERE test_id = $1', [v.test_id]),
      c.db.rows(`SELECT u.full_name FROM test_version_authors($1) a JOIN app_user u ON u.id = a.user_id ORDER BY u.full_name`, [v.id]),
      v.approved_by ? c.db.one('SELECT full_name FROM app_user WHERE id = $1', [v.approved_by]) : null,
      c.db.rows("SELECT id, category_name FROM product_category WHERE status = 'Active' ORDER BY sort_order, category_name"),
    ]);
    const versions = await c.db.rows('SELECT id, version_no, status FROM test_version WHERE test_id = $1 ORDER BY version_no DESC', [v.test_id]);
    const qcCriteria = await c.db.rows('SELECT * FROM qc_criteria($1)', [v.id]); // the limit each QC applies to each analyte (WD-1.2)
    const mine = !!(await c.db.one('SELECT 1 AS x FROM test_version_authors($1) a WHERE a.user_id = $2', [v.id, c.userId]));
    return { version: { ...v, approved_by_name: approver?.full_name || null }, test, analytes, steps, equipment, deps, problems, versions, entry, qcCriteria,
      authors: authors.map((a) => a.full_name), i_worked_on_it: mine,
      lists: { departments, types, methods, analytes: allAnalytes, units: units.map((u) => u.unit_code), tests, qcTypes, limitTypes, categories,
        // report templates this test may use (its lab's and every lab's; migration 030) and the lab's default
        report_templates: await c.db.rows(`SELECT id, template_code, template_name, site_id, status::text AS status FROM report_template WHERE (site_id IS NULL OR site_id IS NOT DISTINCT FROM $1) ORDER BY site_id NULLS FIRST, template_code`, [site]),
        default_report_template: (await c.db.one('SELECT default_report_template($1) AS id', [site])).id }, ...(await me(c)) };
  });
  r('GET', '/api/methods/versions/:id/problems', async (c) => {
    const v = await versionOf(c, c.params.id);
    return c.db.rows('SELECT * FROM test_version_problems($1)', [v.id]);
  });
  // Tab 1: the test (name, department) and the version (method, procedure, rounding, below-LOQ reporting)
  r('PUT', '/api/methods/versions/:id/header', async (c) => {
    const v = await versionOf(c, c.params.id);
    const { test = {}, version = {} } = c.body;
    return designTx(c, 'Changed by', `Test and reporting: ${vName(v)}`, async (t) => {
      if (Object.keys(test).length) await upsertRows(t, 'test', [{ ...test, id: v.test_id }], ['test_name', 'department_id', 'status']);
      if (Object.keys(version).length) await upsertRows(t, 'test_version', [{ ...version, id: v.id }],
        ['method_id', 'procedure_text', 'change_summary', 'rounding_mode', 'rounding_digits', 'nd_below_lod', 'report_per_serving', 'report_template_id']);   // (per serving: migration 028)
    });
  });
  // Tab 2: analytes (a grid save)
  r('POST', '/api/methods/versions/:id/analytes', async (c) => {
    const v = await versionOf(c, c.params.id);
    const rows = c.body.rows || [];
    return designTx(c, rows.some((x) => x.id) ? 'Changed by' : 'Created by', `Analytes: ${vName(v)}`,
      (t) => upsertRows(t, 'test_version_analyte', arrRows(rows), TVA_FIELDS, { test_version_id: v.id }));
  });
  // Tab 3: one step with its equipment types and the steps it follows
  r('POST', '/api/methods/versions/:id/steps', async (c) => {
    const v = await versionOf(c, c.params.id);
    const s = c.body.step || {};
    const equipment = (c.body.equipment || []).filter((e) => isUuid(e.equipment_type_id));
    const deps = (c.body.deps || []).filter((d) => isUuid(d.depends_on_step_id));
    return designTx(c, s.id ? 'Changed by' : 'Created by', `Step "${s.step_name || ''}": ${vName(v)}`, async (t) => {
      let id = s.id;
      const fields = { step_key: String(s.step_key || '').trim(), step_name: s.step_name, step_type: s.step_type, department_id: s.department_id || null,
        instructions: s.instructions || null, config: JSON.stringify(s.config || {}) };
      if (id) {
        const cur = await t.one('SELECT id FROM workflow_step WHERE id = $1 AND test_version_id = $2', [id, v.id]);
        if (!cur) throw new Error('Step not found');
        await t.query(`UPDATE workflow_step SET step_key = $2, step_name = $3, step_type = $4, department_id = $5, instructions = $6, config = $7::jsonb WHERE id = $1`,
          [id, fields.step_key, fields.step_name, fields.step_type, fields.department_id, fields.instructions, fields.config]);
      } else {
        const x = await t.one(`INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, department_id, instructions, config, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, COALESCE((SELECT max(sort_order) FROM workflow_step WHERE test_version_id = $1), 0) + 1) RETURNING id`,
          [v.id, fields.step_key, fields.step_name, fields.step_type, fields.department_id, fields.instructions, fields.config]);
        id = x.id;
      }
      // equipment types: keep, add, change main, remove
      const curEq = await t.rows("SELECT * FROM workflow_step_equipment WHERE step_id = $1 AND status = 'Active'", [id]);
      for (const e of curEq) {
        const want = equipment.find((w) => w.equipment_type_id === e.equipment_type_id);
        if (!want) await t.query("UPDATE workflow_step_equipment SET status = 'Inactive' WHERE id = $1", [e.id]);
        else if (!!want.is_main !== e.is_main) await t.query('UPDATE workflow_step_equipment SET is_main = $2 WHERE id = $1', [e.id, !!want.is_main]);
      }
      for (const w of equipment) {
        if (!curEq.some((e) => e.equipment_type_id === w.equipment_type_id)) {
          await t.query('INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) VALUES ($1, $2, $3)', [id, w.equipment_type_id, !!w.is_main]);
        }
      }
      // the steps it comes after
      const curDeps = await t.rows("SELECT * FROM workflow_step_dependency WHERE step_id = $1 AND status = 'Active'", [id]);
      for (const d of curDeps) {
        const want = deps.find((w) => w.depends_on_step_id === d.depends_on_step_id);
        if (!want) await t.query("UPDATE workflow_step_dependency SET status = 'Inactive' WHERE id = $1", [d.id]);
        else if ((want.dependency_type || 'Sequential') !== d.dependency_type) await t.query('UPDATE workflow_step_dependency SET dependency_type = $2 WHERE id = $1', [d.id, want.dependency_type || 'Sequential']);
      }
      for (const w of deps) {
        if (!curDeps.some((d) => d.depends_on_step_id === w.depends_on_step_id)) {
          await t.query('INSERT INTO workflow_step_dependency (step_id, depends_on_step_id, dependency_type) VALUES ($1, $2, $3)', [id, w.depends_on_step_id, w.dependency_type || 'Sequential']);
        }
      }
      // steps that should now come after this one (chosen from the new step's side)
      for (const nextId of (c.body.followed_by || []).filter(isUuid)) {
        const ex = await t.one("SELECT id FROM workflow_step_dependency WHERE step_id = $1 AND depends_on_step_id = $2 AND status = 'Active'", [nextId, id]);
        if (!ex) await t.query("INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES ($1, $2)", [nextId, id]);
      }
      return { id };
    });
  });
  r('POST', '/api/methods/versions/:id/steps/:stepId/remove', async (c) => {
    const v = await versionOf(c, c.params.id);
    return designTx(c, 'Changed by', `Step removed: ${vName(v)}`, (t) => t.query("UPDATE workflow_step SET status = 'Inactive' WHERE id = $1 AND test_version_id = $2", [c.params.stepId, v.id]));
  });
  r('POST', '/api/methods/versions/:id/steps/order', async (c) => {
    const v = await versionOf(c, c.params.id);
    return designTx(c, 'Changed by', `Step order: ${vName(v)}`, async (t) => {
      let i = 0;
      for (const id of (c.body.ids || []).filter(isUuid)) { i += 1; await t.query('UPDATE workflow_step SET sort_order = $3 WHERE id = $1 AND test_version_id = $2 AND sort_order <> $3', [id, v.id, i]); }
    });
  });
  // Tab 4: approval (signed: "Approved by")
  r('POST', '/api/methods/versions/:id/approve', async (c) => {
    const v = await versionOf(c, c.params.id);
    return signedTx(c, { meaning: 'Approved by', action: `Test version: ${v.test_name} version ${v.version_no}`, module: 'Methods' },
      (t) => t.query('SELECT approve_test_version($1)', [v.id]));
  });
  // Try a formula with example values (the same engine results will use)
  r('POST', '/api/methods/formula-test', async (c) => {
    const f = String(c.body.formula || '');
    const chk = await c.db.one('SELECT formula_check($1) AS problem, formula_tokens($1) AS tokens', [f]);
    if (chk.problem) return { problem: chk.problem, tokens: chk.tokens };
    try {
      const x = await c.db.one('SELECT formula_eval($1, $2::jsonb) AS value', [f, JSON.stringify(c.body.values || {})]);
      return { value: x.value, tokens: chk.tokens };
    } catch (e) { return { problem: e.message, tokens: chk.tokens }; }
  });

  // ------------------------------------------------------------ methods (SOPs)
  r('GET', '/api/methods/sops', async (c) => {
    const site = await currentSite(c);
    const rows = await c.db.rows(`SELECT m.*, (SELECT count(DISTINCT v.test_id) FROM test_version v WHERE v.method_id = m.id) AS test_count
      FROM method m WHERE m.site_id = $1 ORDER BY lower(m.method_name)`, [site]);
    return { rows, ...(await me(c)) };
  });
  r('POST', '/api/methods/sops', async (c) => {
    const site = await currentSite(c);
    const rows = c.body.rows || [];
    return designTx(c, rows.some((x) => x.id) ? 'Changed by' : 'Created by', `Methods (SOPs): ${rows.length} row(s)`,
      (t) => upsertRows(t, 'method', rows, ['method_name', 'sop_code', 'sop_link', 'description', 'status'], { site_id: site }));
  });

  // ------------------------------------------------------------ specifications (a quoted test, or a requested test)
  async function specOwner(c) {
    const q = c.query.quoted_line || c.body.quoted_line; const rt = c.query.requested_test || c.body.requested_test;
    if (isUuid(rt)) {
      const x = await c.db.one(`SELECT rt.id, rt.test_version_id AS version_id, rt.status, t.test_name, t.test_code, s.sample_code, o.site_id, s.id AS sample_id
        FROM requested_test rt JOIN test t ON t.id = rt.test_id JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = $1`, [rt]);
      if (!x) throw new Error('Test not found');
      await checkSite(c, x.site_id);
      return { kind: 'requested_test', ...x, editable: x.status !== 'Cancelled' && (await hasPermission(c, 'orders.edit', x.site_id)) };
    }
    if (isUuid(q)) {
      const x = await c.db.one(`SELECT q.id, v.id AS version_id, t.test_name, t.test_code, pv.status AS quote_status, version_is_editable(pv.id) AS open
        FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id JOIN project_version pv ON pv.id = q.project_version_id
        LEFT JOIN test_version v ON v.test_id = q.test_id AND v.status = 'Effective' WHERE q.id = $1`, [q]);
      if (!x) throw new Error('Quoted test not found');
      return { kind: 'quoted_line', ...x, editable: x.open && (await hasPermission(c, 'quotes.edit')) };
    }
    throw new Error('Say which test the specifications are for');
  }
  r('GET', '/api/specs', async (c) => {
    const o = await specOwner(c);
    const col = o.kind === 'requested_test' ? 'requested_test_id' : 'quoted_line_id';
    const analytes = o.version_id ? await c.db.rows(`SELECT a.analyte_id, an.analyte_name, a.result_type, a.reporting_unit, a.default_spec_min, a.default_spec_max, a.default_spec_text
      FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id WHERE a.test_version_id = $1 AND a.status = 'Active' ORDER BY a.sort_order, an.analyte_name`, [o.version_id]) : [];
    const specs = await c.db.rows(`SELECT s.*, u.full_name AS created_by_name FROM specification s JOIN app_user u ON u.id = s.created_by WHERE s.${col} = $1 AND s.status = 'Active'`, [o.id]);
    return { owner: o, analytes, specs };
  });
  r('POST', '/api/specs', async (c) => {
    const o = await specOwner(c);
    const col = o.kind === 'requested_test' ? 'requested_test_id' : 'quoted_line_id';
    const wrap = o.kind === 'quoted_line' ? (fn) => tx({ ...c, reason: c.reason || 'Quote edited' }, fn) : (fn) => tx(c, fn);
    return wrap((t) => upsertRows(t, 'specification', c.body.rows || [], SPEC_FIELDS, { [col]: o.id }));
  });

  // ------------------------------------------------------------ audit icons
  AUDIT_SCOPES.testdef = `SELECT 'test', $1::uuid UNION ALL SELECT 'test_version', id FROM test_version WHERE test_id = $1
    UNION ALL SELECT 'test_catalog_entry', id FROM test_catalog_entry WHERE test_id = $1
    UNION ALL SELECT 'test_version_analyte', a.id FROM test_version_analyte a JOIN test_version v ON v.id = a.test_version_id WHERE v.test_id = $1
    UNION ALL SELECT 'workflow_step', s.id FROM workflow_step s JOIN test_version v ON v.id = s.test_version_id WHERE v.test_id = $1
    UNION ALL SELECT 'workflow_step_equipment', e.id FROM workflow_step_equipment e JOIN workflow_step s ON s.id = e.step_id JOIN test_version v ON v.id = s.test_version_id WHERE v.test_id = $1
    UNION ALL SELECT 'workflow_step_dependency', d.id FROM workflow_step_dependency d JOIN workflow_step s ON s.id = d.step_id JOIN test_version v ON v.id = s.test_version_id WHERE v.test_id = $1`;
  AUDIT_CHECKS.testdef = async (c, id) => { await testOf(c, id); };
  AUDIT_LISTS.methods = ['test', 'test_version', 'test_version_analyte', 'workflow_step', 'workflow_step_equipment', 'workflow_step_dependency'];
  AUDIT_LISTS.sops = ['method'];
};
