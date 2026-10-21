// JSON API. Business rules live in the database (triggers and constraints);
// these handlers only read, write and pass the user and Reason for Change through.
'use strict';

const R = [];
function route(method, pattern, handler) {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  R.push({ method, re, keys, handler });
}
function match(method, pathname) {
  for (const r of R) {
    if (r.method !== method) continue;
    const m = pathname.match(r.re);
    if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
const tx = (ctx, fn) => ctx.db.tx({ userId: ctx.userId, reason: ctx.reason, siteId: ctx.siteId }, fn);
const { registerAuth, signedTx } = require('./auth');
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k] === '' ? null : o[k]]));

// Generic helpers for "save a grid" (inserts + updates in one transaction, one reason)
async function upsertRows(t, table, rows, editable, fixed = {}) {
  const out = [];
  for (const row of rows) {
    const vals = pick(row, editable);
    if (row.id) {
      const keys = Object.keys(vals);
      if (!keys.length) continue;
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      out.push(await t.one(`UPDATE ${table} SET ${sets} WHERE id = $1 RETURNING id`, [row.id, ...keys.map((k) => vals[k])]));
    } else {
      const all = { ...vals, ...fixed };
      const keys = Object.keys(all).filter((k) => all[k] !== null && all[k] !== undefined);
      out.push(await t.one(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING id`,
        keys.map((k) => all[k])));
    }
  }
  return out;
}

// Lab access: the lab chosen in the header (x-site-id) must be one of the user's labs.
// The database enforces the same rule on every write; these checks scope what is read.
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || '');
// Seeing a lab: a group at that lab, or the all-labs (view-only) Executive group. Changing anything there is
// checked by the database (a group at that lab with the right permission).
async function canAccess(c, siteId) {
  if (!isUuid(c.userId) || !isUuid(siteId)) return false;
  return (await c.db.one('SELECT user_can_view_site($1, $2) AS ok', [c.userId, siteId])).ok;
}
async function currentSite(c) {
  if (!isUuid(c.siteId)) throw new Error('Choose your lab (top right) first. If none is listed, ask an administrator to assign you to a lab.');
  if (!(await canAccess(c, c.siteId))) throw new Error('You are not assigned to this lab. Choose another lab (top right) or ask an administrator.');
  return c.siteId;
}
async function checkSite(c, siteId) {
  if (!(await canAccess(c, siteId))) throw new Error('This record belongs to a lab you are not assigned to. Ask an administrator for access.');
}
// Permissions (migration 008): held through groups at a lab; system administrators hold every permission
async function hasPermission(c, code, siteId = c.siteId) {
  if (!isUuid(c.userId)) return false;
  return (await c.db.one('SELECT user_has_permission_at($1, $2, $3) AS ok', [c.userId, code, isUuid(siteId) ? siteId : null])).ok;
}
async function requirePermission(c, code, what = 'do this') {
  if (!(await hasPermission(c, code))) {
    const p = await c.db.one('SELECT description FROM permission WHERE code = $1', [code]);
    throw new Error(`You do not have permission to ${what} in this lab (${code}${p ? ': ' + p.description.toLowerCase() : ''}). Ask your lab administrator.`);
  }
}
// Lab administration pages: a system administrator, or someone with admin.users in the lab they are working in
async function requireAdmin(c) { await requirePermission(c, 'admin.users', 'open this page'); }
async function requireSystemAdmin(c) {
  const u = isUuid(c.userId) ? await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]) : null;
  if (!u || !u.is_admin) throw new Error('Only a system administrator can do this.');
}

// ---------------------------------------------------------------- meta
// People, each with the labs they can open (a group there; every lab for system administrators and the Executive group).
// For the signed-in person only: their groups and permissions in each lab (the screens use them to show what they may do).
route('GET', '/api/users', (c) => c.db.rows(`SELECT u.id, u.username, u.full_name, u.is_admin,
  COALESCE((SELECT json_agg(json_build_object('id', s.id, 'site_code', s.site_code, 'site_name', s.site_name,
      'view_only', NOT user_can_access_site(u.id, s.id)) ORDER BY s.site_code)
    FROM lab_site s WHERE s.status = 'Active' AND user_can_view_site(u.id, s.id)), '[]') AS sites,
  CASE WHEN u.id::text = $1 THEN COALESCE((SELECT json_object_agg(s.id, json_build_object(
      'groups', (SELECT COALESCE(json_agg(DISTINCT g.group_name), '[]') FROM group_member m JOIN lab_group g ON g.id = m.group_id
                  WHERE m.user_id = u.id AND m.status = 'Active' AND g.status = 'Active' AND (g.site_id = s.id OR g.site_id IS NULL)),
      'perms', (SELECT COALESCE(json_agg(p.code), '[]') FROM permission p WHERE p.status = 'Active' AND user_has_permission_at(u.id, p.code, s.id))))
    FROM lab_site s WHERE s.status = 'Active' AND user_can_view_site(u.id, s.id)), '{}') END AS access
  FROM app_user u WHERE u.is_active AND u.username <> 'system' ORDER BY (u.username = 'akiddle') DESC, u.full_name`, [c.userId || '']));
route('GET', '/api/meta', async (c) => ({
  contactRoles: await c.db.rows('SELECT role_code, role_name, description, one_per_client FROM contact_role ORDER BY sort_order'),
  enums: Object.fromEntries(await Promise.all(['account_status', 'report_delivery', 'analyte_class', 'master_status', 'record_status',
    'tat_unit', 'surcharge_type', 'pricing_mode', 'project_version_status', 'line_status', 'submission_channel', 'oos_procedure'].map(async (t) =>
    [t, (await c.db.rows(`SELECT unnest(enum_range(NULL::${t}))::text AS v`)).map((r) => r.v)]))),
}));
route('GET', '/api/dashboard', async (c) => c.db.one(`SELECT
  (SELECT count(*) FROM lab_order WHERE status IN ('Draft','Submitted','Received') AND site_id::text = $1 AND origin::text <> 'Workflow Verification') AS open_orders,
  (SELECT count(*) FROM requested_test_view WHERE rush_status = 'Pending Approval' AND status <> 'Cancelled' AND site_id::text = $1) AS rush_pending,
  (SELECT count(*) FROM client) AS clients, (SELECT count(*) FROM client WHERE account_status = 'On Hold') AS on_hold,
  (SELECT count(*) FROM contact) AS contacts, (SELECT count(*) FROM analyte WHERE status = 'Active') AS analytes,
  (SELECT count(*) FROM test WHERE status = 'Active') AS tests, (SELECT count(*) FROM project) AS projects,
  (SELECT count(*) FROM project_version WHERE status IN ('Draft','Submitted for Quote')) AS open_quotes,
  (SELECT count(*) FROM quote_line_review WHERE issue IS NOT NULL AND version_status IN ('Draft','Submitted for Quote')) AS pricing_issues,
  (SELECT count(*) FROM audit_log) AS audit_entries`, [(await canAccess(c, c.siteId)) ? c.siteId : '']));

// ---------------------------------------------------------------- clients
route('GET', '/api/clients', (c) => c.db.rows(`SELECT c.*, COALESCE(c.display_name, c.legal_name) AS name, p.legal_name AS parent_name,
  (SELECT count(*) FROM client_contact cc WHERE cc.client_id = c.id AND cc.status = 'Active') AS contact_count,
  (SELECT count(*) FROM project pr WHERE pr.client_id = c.id) AS project_count,
  client_can_order(c.id) AS can_order, client_can_release_report(c.id) AS can_release
  FROM client c LEFT JOIN client p ON p.id = c.parent_client_id ORDER BY c.legal_name`));
route('GET', '/api/clients/:id', async (c) => {
  const client = await c.db.one(`SELECT c.*, p.legal_name AS parent_name, client_can_order(c.id) AS can_order,
    client_can_release_report(c.id) AS can_release FROM client c LEFT JOIN client p ON p.id = c.parent_client_id WHERE c.id = $1`, [c.params.id]);
  if (!client) throw new Error('Client not found');
  const contacts = await c.db.rows(`SELECT cc.id, cc.contact_id, cc.roles, cc.portal_visible, cc.status, ct.contact_code,
    ct.first_name || ' ' || ct.last_name AS contact_name, ct.email, ct.status AS contact_status
    FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id WHERE cc.client_id = $1 ORDER BY ct.last_name`, [c.params.id]);
  const projects = await c.db.rows(`SELECT p.id, p.project_code, p.project_name, p.is_list_price_acceptance, p.status,
    (SELECT pv.status FROM project_version pv WHERE pv.project_id = p.id ORDER BY version_no DESC LIMIT 1) AS latest_status,
    (SELECT max(version_no) FROM project_version pv WHERE pv.project_id = p.id) AS latest_version
    FROM project p WHERE p.client_id = $1 ORDER BY p.project_code`, [c.params.id]);
  const children = await c.db.rows('SELECT id, client_code, legal_name, account_status FROM client WHERE parent_client_id = $1', [c.params.id]);
  const orderable = await c.db.rows(`SELECT ol.*, pv.project_id, pv.id AS project_version_id, pv.version_no FROM orderable_lines($1) ol
    JOIN quoted_test_configuration q ON q.id = ol.line_id JOIN project_version pv ON pv.id = q.project_version_id ORDER BY ol.project_code, ol.test_name`, [c.params.id]);
  const licenses = labLicenses(await c.db.rows(`SELECT v.*, ${LIC_ON('$2')} FROM client_license_view v WHERE client_id = $1 ORDER BY (status = 'Retired'), license_type, expires_on DESC NULLS FIRST`, [c.params.id, labOf(c)]));
  return { client, contacts, projects, children, orderable, licenses, can_edit: await hasPermission(c, 'master.clients') };
});

// ---------------------------------------------------------------- client licenses (0.32.0, migration 055)
// added over time, never deleted: a renewal is a new license; an old one is retired with a reason
const LICENSE_FIELDS = ['license_type', 'license_number', 'issuing_authority', 'issued_on', 'expires_on', 'note'];
const licenseDoc = async (t, d) => {
  if (!d || !d.data) return null;
  const buf = Buffer.from(String(d.data), 'base64');
  if (!buf.length || buf.length > 10 * 1024 * 1024) throw new Error('The scanned copy must be a file under 10 MB');
  if (!/^(application\/pdf|image\/(png|jpeg))$/.test(d.mime_type || '')) throw new Error('The scanned copy must be a PDF, PNG or JPEG');
  return (await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, $3, $4, decode($5, 'base64')) RETURNING id`,
    [String(d.file_name || 'license').slice(0, 200), d.mime_type, buf.length, require('crypto').createHash('sha256').update(buf).digest('hex'), String(d.data)])).id;
};
route('POST', '/api/clients/:id/licenses', (c) => {
  if (!isUuid(c.params.id)) throw new Error('Client not found');
  const b = c.body || {};
  return tx({ ...c, reason: b.reason || 'License added' }, async (t) => {
    const doc = await licenseDoc(t, b.document);
    const f = {}; for (const k of LICENSE_FIELDS) f[k] = b[k] === '' || b[k] === undefined ? null : b[k];
    return t.one(`INSERT INTO client_license (client_id, license_type, license_number, issuing_authority, issued_on, expires_on, note, document_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, license_code`, [c.params.id, f.license_type, f.license_number, f.issuing_authority, f.issued_on, f.expires_on, f.note, doc]);
  });
});
// a correction (reason) or retiring (reason and why); a new scanned copy may be attached
route('PUT', '/api/licenses/:id', (c) => {
  if (!isUuid(c.params.id)) throw new Error('License not found');
  const b = c.body || {};
  return tx({ ...c, reason: b.reason }, async (t) => {
    const f = {}; for (const k of LICENSE_FIELDS) if (b[k] !== undefined) f[k] = b[k] === '' ? null : b[k];
    if (b.retire) { f.status = 'Retired'; f.retired_reason = b.retired_reason || ''; }
    const doc = await licenseDoc(t, b.document); if (doc) f.document_id = doc;
    const keys = Object.keys(f); if (!keys.length) return { ok: true };
    await t.query(`UPDATE client_license SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [c.params.id, ...keys.map((k) => f[k])]);
    return { ok: true };
  });
});
route('GET', '/api/licenses/:id/file', async (c) => {
  if (!isUuid(c.params.id)) throw new Error('License not found');
  const f = await c.db.one(`SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64 FROM client_license l JOIN document_file f ON f.id = l.document_id WHERE l.id = $1`, [c.params.id]);
  if (!f) throw new Error('No scanned copy on this license');
  return { __raw: true, body: Buffer.from(f.b64, 'base64'), type: f.mime_type, headers: { 'Content-Disposition': `inline; filename="${String(f.file_name).replace(/[^\w.\- ]/g, '_')}"` } };
});
// every client's licenses, for the expiry list (Intake > Client licenses)
route('GET', '/api/licenses', async (c) => ({
  rows: labLicenses(await c.db.rows(`SELECT * FROM (SELECT v.*, ${LIC_ON('$1')} FROM client_license_view v WHERE status = 'Active') x
    ORDER BY (lab_state = 'Expired') DESC, (lab_state = 'Expiring soon') DESC, expires_on NULLS LAST, client_name`, [labOf(c)])),
}));
// a license's state and days left on the lab's date (057), not the server's
function labOf(c) { return isUuid(c.siteId) ? c.siteId : null; }
function LIC_ON(p) { return `license_state_on(v.expires_on, v.status::text, site_today(${p}::uuid)) AS lab_state, v.expires_on - site_today(${p}::uuid) AS lab_days_left`; }
function labLicenses(rows) { return rows.map(({ lab_state, lab_days_left, ...r }) => ({ ...r, state: lab_state, days_left: lab_days_left })); }
const CLIENT_FIELDS = ['legal_name', 'display_name', 'parent_client_id', 'account_status', 'is_gmp_client', 'allow_partial_reports', 'billing_address', 'site_address', 'default_report_delivery'];
route('POST', '/api/clients', (c) => tx(c, (t) => upsertRows(t, 'client', [c.body.row], CLIENT_FIELDS)).then((r) => r[0]));
route('PUT', '/api/clients/:id', (c) => tx(c, (t) => upsertRows(t, 'client', [{ ...c.body.row, id: c.params.id }], CLIENT_FIELDS)));

// ---------------------------------------------------------------- contacts and links
route('GET', '/api/contacts', (c) => c.db.rows(`SELECT ct.*, COALESCE((SELECT string_agg(COALESCE(cl.display_name, cl.legal_name), ', ' ORDER BY cl.legal_name)
  FROM client_contact cc JOIN client cl ON cl.id = cc.client_id WHERE cc.contact_id = ct.id AND cc.status = 'Active'), '') AS clients
  FROM contact ct ORDER BY ct.last_name, ct.first_name`));
const CONTACT_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'job_title', 'portal_access', 'status'];
route('POST', '/api/contacts/bulk', (c) => tx(c, (t) => upsertRows(t, 'contact', c.body.rows, CONTACT_FIELDS)));
route('POST', '/api/client-contacts/bulk', (c) => tx(c, (t) => upsertRows(t, 'client_contact', c.body.rows,
  ['client_id', 'contact_id', 'roles', 'portal_visible', 'status'])));

// ---------------------------------------------------------------- analytes
route('GET', '/api/analytes', (c) => c.db.rows('SELECT * FROM analyte ORDER BY analyte_class, analyte_name'));
// Molar mass changes are signed (and limited to QA, Lab Supervisors and administrators by the database)
const ANALYTE_FIELDS = ['analyte_name', 'report_name', 'analyte_class', 'cas_number', 'synonyms', 'status', 'molar_mass', 'molar_mass_source'];
route('POST', '/api/analytes/bulk', (c) => (c.body.signature
  ? signedTx(c, { meaning: 'Changed by', action: `Analytes: ${c.body.rows.length} row(s) including molar mass`, module: 'Catalog' }, (t) => upsertRows(t, 'analyte', c.body.rows, ANALYTE_FIELDS))
  : tx(c, (t) => upsertRows(t, 'analyte', c.body.rows, ANALYTE_FIELDS))));
// Canned reasons for the Reason for Change box: the module's own list plus the General list
route('GET', '/api/reasons', (c) => c.db.rows(`SELECT id, module, reason_text FROM reason_code WHERE status = 'Active' AND module IN ($1, 'General')
  ORDER BY (module = 'General'), sort_order, reason_text`, [c.query.module || 'General']));
route('GET', '/api/reasons/all', (c) => c.db.rows('SELECT * FROM reason_code ORDER BY module, sort_order, reason_text'));
route('POST', '/api/reasons/bulk', (c) => tx(c, (t) => upsertRows(t, 'reason_code', c.body.rows, ['module', 'reason_text', 'sort_order', 'status'])));

// ---------------------------------------------------------------- rush schedules
route('GET', '/api/rush-schedules', async (c) => {
  const schedules = await c.db.rows(`SELECT s.*, (SELECT count(*) FROM test_catalog_entry e WHERE e.rush_schedule_id = s.id) AS test_count
    FROM rush_fee_schedule s ORDER BY schedule_name`);
  const tiers = await c.db.rows('SELECT * FROM rush_fee_tier ORDER BY sort_order, tier_name');
  return schedules.map((s) => ({ ...s, tiers: tiers.filter((t) => t.schedule_id === s.id) }));
});
route('POST', '/api/rush-schedules/bulk', (c) => tx(c, (t) => upsertRows(t, 'rush_fee_schedule', c.body.rows, ['schedule_name', 'description', 'status'])));
route('POST', '/api/rush-schedules/:id/tiers/bulk', (c) => tx(c, (t) => upsertRows(t, 'rush_fee_tier', c.body.rows,
  ['tier_name', 'rush_tat', 'tat_unit', 'surcharge_type', 'surcharge_value', 'requires_approval', 'escalation_hours', 'sort_order', 'status'],
  { schedule_id: c.params.id })));

// ---------------------------------------------------------------- test catalogue (Workflow Designer step 1)
route('GET', '/api/catalog', (c) => c.db.rows('SELECT * FROM test_catalogue ORDER BY test_name'));
route('GET', '/api/catalog.csv', async (c) => {
  const pub = c.query.public === '1';
  const rows = await c.db.rows(`SELECT test_code, test_name, description, pricing_mode, base_price, prep_fee, list_price, analyte_count,
    standard_tat, tat_unit, rush_schedule FROM test_catalogue WHERE test_status = 'Active' ${pub ? 'AND show_in_public_catalogue' : ''} ORDER BY test_name`);
  const cols = ['test_code', 'test_name', 'description', 'pricing_mode', 'base_price', 'prep_fee', 'list_price', 'analyte_count', 'standard_tat', 'tat_unit', 'rush_schedule'];
  const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const csv = [cols.join(','), ...rows.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\r\n');
  return { __raw: true, body: csv, type: 'text/csv; charset=utf-8',
    headers: { 'Content-Disposition': `attachment; filename="${pub ? 'public_' : ''}test_catalogue.csv"` } };
});
// A new test belongs to the lab being worked in (migration 012); its scientific content is built in the Workflow Designer
route('POST', '/api/tests', async (c) => { const site = await currentSite(c); return tx(c, (t) => t.one('SELECT create_test($1, $2) AS id', [site, c.body.test_name])); });
// update prices by a percentage, all tests or the selected ones (migration 031); a Reason for Change, catalog.edit
route('POST', '/api/catalog/reprice', (c) => {
  const pct = Number(c.body.pct);
  if (!Number.isFinite(pct) || pct === 0) throw new Error('Give the percentage to change the prices by (e.g. 3 or -5)');
  const tests = Array.isArray(c.body.tests) ? c.body.tests.filter(isUuid) : null;
  if (Array.isArray(c.body.tests) && !tests.length) throw new Error('Select the tests to update, or choose all tests');
  return tx(c, (t) => t.one('SELECT reprice_catalog($1::uuid[], $2) AS n', [tests, pct]));
});
route('GET', '/api/catalog/:testId', async (c) => {
  const test = await c.db.one('SELECT * FROM test WHERE id = $1', [c.params.testId]);
  const entry = await c.db.one('SELECT * FROM test_catalog_entry WHERE test_id = $1', [c.params.testId]);
  const list = await c.db.one('SELECT list_price FROM test_catalogue WHERE test_id = $1', [c.params.testId]);
  const analytes = await c.db.rows(`SELECT ap.*, a.analyte_code, a.analyte_name, a.analyte_class FROM test_analyte_price ap
    JOIN analyte a ON a.id = ap.analyte_id WHERE ap.catalog_entry_id = $1 ORDER BY a.analyte_name`, [entry.id]);
  const tiers = entry.rush_schedule_id ? await c.db.rows(`SELECT rt.*, rt.requires_approval AS schedule_default,
    (SELECT o.requires_approval FROM test_rush_approval o WHERE o.catalog_entry_id = $1 AND o.tier_id = rt.id) AS override,
    (SELECT o.id FROM test_rush_approval o WHERE o.catalog_entry_id = $1 AND o.tier_id = rt.id) AS override_id,
    rush_requires_approval($1, rt.id) AS effective FROM rush_fee_tier rt WHERE rt.schedule_id = $2 AND rt.status = 'Active'
    ORDER BY sort_order`, [entry.id, entry.rush_schedule_id]) : [];
  const versions = await c.db.rows('SELECT version_no, status, effective_from FROM test_version WHERE test_id = $1 ORDER BY version_no', [c.params.testId]);
  return { test, entry, list_price: list ? list.list_price : 0, analytes, tiers, versions };
});
route('PUT', '/api/catalog/:testId', (c) => tx(c, async (t) => {
  const { test = {}, entry = {}, analytes = [], approvals = [] } = c.body;
  await upsertRows(t, 'test', [{ ...test, id: c.params.testId }], ['test_name', 'status', 'serving_role']);   // serving_role: 033
  const e = await t.one('SELECT id FROM test_catalog_entry WHERE test_id = $1', [c.params.testId]);
  await upsertRows(t, 'test_catalog_entry', [{ ...entry, id: e.id }], ['description', 'pricing_mode', 'base_price', 'prep_fee',
    'standard_tat', 'tat_unit', 'cutoff_time', 'rush_schedule_id', 'show_in_public_catalogue']);
  await upsertRows(t, 'test_analyte_price', analytes, ['analyte_id', 'price', 'status'], { catalog_entry_id: e.id });
  for (const a of approvals) {
    if (a.override === null || a.override === undefined || a.override === '') continue;
    await t.query(`INSERT INTO test_rush_approval (catalog_entry_id, tier_id, requires_approval) VALUES ($1, $2, $3)
      ON CONFLICT (catalog_entry_id, tier_id) DO UPDATE SET requires_approval = EXCLUDED.requires_approval`, [e.id, a.tier_id, a.override]);
  }
}));

// ---------------------------------------------------------------- projects and quotes
route('GET', '/api/projects', (c) => c.db.rows(`SELECT p.*, COALESCE(cl.display_name, cl.legal_name) AS client_name,
  lv.version_no AS latest_version, lv.status AS latest_status, lv.id AS latest_version_id,
  (SELECT count(*) FROM quoted_test_configuration q WHERE q.project_version_id = lv.id AND q.status = 'Active') AS line_count
  FROM project p JOIN client cl ON cl.id = p.client_id
  LEFT JOIN LATERAL (SELECT * FROM project_version pv WHERE pv.project_id = p.id ORDER BY version_no DESC LIMIT 1) lv ON true
  WHERE p.kind = 'Project' ORDER BY p.project_code DESC`));
route('POST', '/api/projects', (c) => tx(c, async (t) => {
  const [p] = await upsertRows(t, 'project', [c.body.row], ['client_id', 'project_name', 'purpose', 'available_to_child_clients', 'is_list_price_acceptance']);
  const v = await t.one('SELECT new_project_version($1) AS id', [p.id]);
  return { id: p.id, version_id: v.id };
}));
route('PUT', '/api/projects/:id', (c) => tx(c, (t) => upsertRows(t, 'project', [{ ...c.body.row, id: c.params.id }],
  ['project_name', 'purpose', 'available_to_child_clients', 'status'])));
route('GET', '/api/projects/:id', async (c) => {
  const project = await c.db.one(`SELECT p.*, COALESCE(cl.display_name, cl.legal_name) AS client_name FROM project p
    JOIN client cl ON cl.id = p.client_id WHERE p.id = $1`, [c.params.id]);
  const versions = await c.db.rows(`SELECT pv.*, ct.first_name || ' ' || ct.last_name AS accepted_by,
    (SELECT sum(line_total) FROM quoted_test_configuration q WHERE q.project_version_id = pv.id AND q.status = 'Active') AS total
    FROM project_version pv LEFT JOIN contact ct ON ct.id = pv.accepted_by_contact_id WHERE pv.project_id = $1 ORDER BY version_no DESC`, [c.params.id]);
  return { project, versions };
});
route('POST', '/api/projects/:id/versions', (c) => tx(c, (t) => t.one('SELECT new_project_version($1) AS id', [c.params.id])));

route('GET', '/api/versions/:vid', async (c) => {
  const version = await c.db.one(`SELECT pv.*, p.project_code, p.project_name, p.purpose, p.client_id, p.is_list_price_acceptance,
    p.available_to_child_clients, COALESCE(cl.display_name, cl.legal_name) AS client_name, cl.legal_name AS client_legal_name,
    cl.billing_address, cl.account_status, ct.first_name || ' ' || ct.last_name AS accepted_by, version_is_editable(pv.id) AS editable,
    p.kind, p.quote_contact_id, p.site_id AS quote_site_id, (SELECT site_code FROM lab_site WHERE id = p.site_id) AS quote_site_code, COALESCE(p.owner_id, p.created_by) AS owner_id, ou.full_name AS owner_name, qu.full_name AS quoted_by_name,
    NULLIF(btrim(COALESCE(sc.first_name, '') || ' ' || COALESCE(sc.last_name, '')), '') AS sent_to_name, sc.email AS sent_to_email,
    (SELECT max(version_no) FROM project_version x WHERE x.project_id = p.id) AS latest_version_no
    FROM project_version pv JOIN project p ON p.id = pv.project_id JOIN client cl ON cl.id = p.client_id
    LEFT JOIN contact ct ON ct.id = pv.accepted_by_contact_id LEFT JOIN app_user ou ON ou.id = COALESCE(p.owner_id, p.created_by)
    LEFT JOIN app_user qu ON qu.id = pv.quoted_by LEFT JOIN contact sc ON sc.id = pv.sent_to_contact_id WHERE pv.id = $1`, [c.params.vid]);
  if (!version) throw new Error('Quote version not found');
  // the lab doing each test; another network lab's test is subcontracted (migration 031, the 20-30 rule)
  const lines = await c.db.rows("SELECT r.*, t.id AS test_id, (SELECT count(*) FROM specification sp WHERE sp.quoted_line_id = r.line_id AND sp.status = 'Active') AS spec_count, COALESCE(ls.site_code, '') AS lab, q.is_subcontracted, q.cost_price, q.sc_discount_pct, q.sc_markup_pct FROM quote_line_review r JOIN test t ON t.test_code = r.test_code JOIN quoted_test_configuration q ON q.id = r.line_id LEFT JOIN lab_site ls ON ls.id = t.site_id WHERE r.project_version_id = $1 AND q.quoted_package_id IS NULL ORDER BY q.is_subcontracted, ls.site_code NULLS LAST, r.test_name", [c.params.vid]);
  const rush = await c.db.rows('SELECT * FROM quote_rush_term WHERE project_version_id = $1 ORDER BY schedule_name, rush_tat', [c.params.vid]);
  const contacts = await c.db.rows(`SELECT ct.id, ct.first_name || ' ' || ct.last_name AS name, ct.email, cc.roles FROM client_contact cc
    JOIN contact ct ON ct.id = cc.contact_id WHERE cc.client_id = $1 AND cc.status = 'Active' AND ct.status = 'Active' ORDER BY ct.last_name`, [version.client_id]);
  const catalog = await c.db.rows("SELECT test_id, test_code, test_name, pricing_mode, list_price FROM test_catalogue WHERE test_status = 'Active' ORDER BY test_name");
  return { version, lines, rush, contacts, catalog };
});
route('PUT', '/api/versions/:vid', (c) => tx(c, (t) => upsertRows(t, 'project_version', [{ ...c.body.row, id: c.params.vid }], ['valid_until', 'notes'])));
route('POST', '/api/versions/:vid/status', (c) => tx(c, (t) => upsertRows(t, 'project_version',
  [{ ...pick(c.body, ['status', 'valid_until', 'accepted_by_contact_id']), id: c.params.vid }], ['status', 'valid_until', 'accepted_by_contact_id'])));
// prefill: new lines start at their list price (the client's price, subcontracted or not: worked out by the database)
route('POST', '/api/versions/:vid/lines', (c) => tx(c, async (t) => {
  const rows = await upsertRows(t, 'quoted_test_configuration', c.body.rows, ['test_id', 'quantity', 'final_price', 'special_instructions', 'status'], { project_version_id: c.params.vid });
  if (c.body.prefill) {
    const ids = (rows || []).map((r) => r.id).filter(isUuid);
    if (ids.length) await t.query('UPDATE quoted_test_configuration SET final_price = list_price WHERE id = ANY($1::uuid[]) AND final_price IS NULL', [ids]);
  }
  return rows;
}));
route('POST', '/api/versions/:vid/rush-terms', (c) => tx(c, (t) => upsertRows(t, 'quote_rush_term', c.body.rows, ['discount_pct'])));
route('GET', '/api/lines/:lineId/analytes', (c) => c.db.rows(`SELECT s.*, a.analyte_code, a.analyte_name, a.report_name FROM quoted_analyte_selection s
  JOIN analyte a ON a.id = s.analyte_id WHERE s.line_id = $1 ORDER BY a.analyte_name`, [c.params.lineId]));
route('POST', '/api/lines/:lineId/analytes', (c) => tx(c, (t) => upsertRows(t, 'quoted_analyte_selection', c.body.rows, ['included'])));

// ---------------------------------------------------------------- audit trail
const AUDIT_COLS = `a.id, a.table_name, a.record_id, a.action, a.record_version, a.changed_at, u.full_name AS changed_by, a.reason, a.changed_fields,
  audit_record_ref(a.table_name, a.record_id, a.new_row) AS ref,
  (SELECT s.full_name || ' (' || s.meaning || ')' || CASE WHEN s.method <> 'User ID and password' THEN ' by ' || lower(s.method) ELSE '' END
     FROM signature_event s WHERE s.id = a.signature_id) AS signature`;
// 0.33.0: people see the audit entries of the labs they work in (and shared records); all-labs groups and system administrators see every lab
async function auditLabFilter(c, n) {
  const all = await c.db.one("SELECT user_has_permission_at($1, 'data.view_all', NULL) AS ok", [c.userId]);
  if (all && all.ok) return { sql: '', params: [] };
  return { sql: ` AND (audit_row_site(a.new_row) IS NULL OR user_can_view_site($${n}::uuid, audit_row_site(a.new_row)))`, params: [c.userId] };
}
route('GET', '/api/audit', async (c) => {
  const f = await auditLabFilter(c, 3);
  return c.db.rows(`SELECT ${AUDIT_COLS} FROM audit_log a JOIN app_user u ON u.id = a.changed_by
  WHERE ($1 = '' OR a.table_name = $1) AND ($2 = '' OR a.record_id::text = $2)${f.sql} ORDER BY a.id DESC LIMIT 300`,
  [c.query.table || '', c.query.record || '', ...f.params]);
});
route('GET', '/api/audit/tables', (c) => c.db.rows('SELECT table_name, count(*) AS n FROM audit_log GROUP BY table_name ORDER BY table_name'));

// The audit trail behind a page's audit icon: a record plus its parts, or every record shown on a list page.
// Each scope returns (table name, record id) pairs; $1 is the record id, or the current lab for lab lists.
const SAMPLE_PARTS = (where) => `
  UNION ALL SELECT 'requested_test', rt.id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id WHERE ${where}
  UNION ALL SELECT 'requested_analyte', ra.id FROM requested_analyte ra JOIN requested_test rt ON rt.id = ra.requested_test_id JOIN sample s ON s.id = rt.sample_id WHERE ${where}
  UNION ALL SELECT 'rush_decision', d.id FROM rush_decision d JOIN requested_test rt ON rt.id = d.requested_test_id JOIN sample s ON s.id = rt.sample_id WHERE ${where}`;
const QUOTE_PARTS = (where) => `
  UNION ALL SELECT 'quoted_test_configuration', q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id WHERE ${where}
  UNION ALL SELECT 'quote_rush_term', r.id FROM quote_rush_term r JOIN project_version pv ON pv.id = r.project_version_id WHERE ${where}
  UNION ALL SELECT 'quoted_analyte_selection', s.id FROM quoted_analyte_selection s JOIN quoted_test_configuration q ON q.id = s.line_id
    JOIN project_version pv ON pv.id = q.project_version_id WHERE ${where}`;
const AUDIT_SCOPES = {
  order: `SELECT 'lab_order', $1::uuid UNION ALL SELECT 'sample', s.id FROM sample s WHERE s.lab_order_id = $1 ${SAMPLE_PARTS('s.lab_order_id = $1')}
    UNION ALL SELECT 'email_outbox', e.id FROM email_outbox e WHERE e.lab_order_id = $1`,
  sample: `SELECT 'sample', $1::uuid ${SAMPLE_PARTS('s.id = $1')}
    UNION ALL SELECT 'coa', c.id FROM coa c WHERE c.sample_id = $1 UNION ALL SELECT 'coa_version', v.id FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = $1
    UNION ALL SELECT 'coa_note', n.id FROM coa_note n WHERE n.sample_id = $1
    UNION ALL SELECT 'result_finalization', f.id FROM result_finalization f JOIN requested_test rt ON rt.id = f.requested_test_id WHERE rt.sample_id = $1
    UNION ALL SELECT 'sample_attachment', a.id FROM sample_attachment a WHERE a.sample_id = $1`,
  client: `SELECT 'client', $1::uuid UNION ALL SELECT 'client_contact', id FROM client_contact WHERE client_id = $1 UNION ALL SELECT 'client_license', id FROM client_license WHERE client_id = $1`,
  project: `SELECT 'project', $1::uuid UNION ALL SELECT 'project_version', id FROM project_version WHERE project_id = $1 ${QUOTE_PARTS('pv.project_id = $1')}`,
  version: `SELECT 'project_version', $1::uuid ${QUOTE_PARTS('pv.id = $1')}`,
  test: `SELECT 'test', $1::uuid UNION ALL SELECT 'test_version', id FROM test_version WHERE test_id = $1
    UNION ALL SELECT 'test_catalog_entry', id FROM test_catalog_entry WHERE test_id = $1
    UNION ALL SELECT 'test_analyte_price', p.id FROM test_analyte_price p JOIN test_catalog_entry e ON e.id = p.catalog_entry_id WHERE e.test_id = $1
    UNION ALL SELECT 'test_rush_approval', p.id FROM test_rush_approval p JOIN test_catalog_entry e ON e.id = p.catalog_entry_id WHERE e.test_id = $1`,
  schedule: `SELECT 'rush_fee_schedule', $1::uuid UNION ALL SELECT 'rush_fee_tier', id FROM rush_fee_tier WHERE schedule_id = $1`,
  orders: `SELECT 'lab_order', id FROM lab_order WHERE site_id = $1 AND origin::text <> 'Workflow Verification'`,
  intake: `SELECT 'rush_decision', d.id FROM rush_decision d JOIN requested_test rt ON rt.id = d.requested_test_id JOIN sample s ON s.id = rt.sample_id
    JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = $1`,
  outbox: `SELECT 'email_outbox', e.id FROM email_outbox e JOIN lab_order o ON o.id = e.lab_order_id WHERE o.site_id = $1`,
};
const AUDIT_LISTS = { clients: ['client', 'client_contact', 'client_license'], licenses: ['client_license'], contacts: ['contact'], analytes: ['analyte'], rush: ['rush_fee_schedule', 'rush_fee_tier'],
  catalog: ['test', 'test_version', 'test_catalog_entry', 'test_analyte_price', 'test_rush_approval'],
  projects: ['project', 'project_version', 'quoted_test_configuration', 'quote_rush_term', 'quoted_analyte_selection'],
  sites: ['lab_site', 'site_holiday'], matrices: ['matrix', 'product_category'], users: ['user_site_access'] };
const SITE_AUDIT_KINDS = ['orders', 'intake', 'outbox']; // list pages scoped to the current lab
const AUDIT_CHECKS = {}; // kind -> async (ctx, id): check the user may see that record (added by later slices)
route('GET', '/api/audit/scope', async (c) => {
  const { kind, id } = c.query;
  if (kind === 'users') await requireAdmin(c);
  if (kind === 'sites') await requirePermission(c, 'admin.lab', 'see the lab settings');
  if (AUDIT_LISTS[kind]) {
    const f = await auditLabFilter(c, 2);
    return c.db.rows(`SELECT ${AUDIT_COLS} FROM audit_log a JOIN app_user u ON u.id = a.changed_by WHERE a.table_name = ANY($1::text[])${f.sql}
      ORDER BY a.id DESC LIMIT 500`, [AUDIT_LISTS[kind], ...f.params]);
  }
  if (!AUDIT_SCOPES[kind]) throw new Error('Unknown audit view');
  let key = id;
  if (SITE_AUDIT_KINDS.includes(kind)) key = await currentSite(c);
  else if (!isUuid(id)) throw new Error('Record not found');
  if (AUDIT_CHECKS[kind]) await AUDIT_CHECKS[kind](c, id);
  if (kind === 'order') await checkSite(c, (await c.db.one('SELECT site_id FROM lab_order WHERE id = $1', [id]))?.site_id);
  if (kind === 'sample') await checkSite(c, (await c.db.one('SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = $1', [id]))?.site_id);
  const f = await auditLabFilter(c, 2);   // and never another lab's entries among a record's parts
  return c.db.rows(`WITH ids(t, id) AS (${AUDIT_SCOPES[kind]})
    SELECT ${AUDIT_COLS} FROM audit_log a JOIN ids ON ids.t = a.table_name AND ids.id = a.record_id JOIN app_user u ON u.id = a.changed_by
    WHERE true${f.sql} ORDER BY a.id DESC LIMIT 500`, [key, ...f.params]);
});

module.exports = { match };

// ================================================================ SLICE 2: sites, lab orders, samples, intake
route('GET', '/api/sites', async (c) => { await requirePermission(c, 'admin.lab', 'open the lab settings'); return c.db.rows(`SELECT s.*, (SELECT count(*) FROM site_holiday h WHERE h.site_id = s.id AND h.status = 'Active') AS holiday_count
  FROM lab_site s ORDER BY site_code`); });

// ---------------------------------------------------------------- admin: lab access and the Matrix list
route('GET', '/api/admin/users', async (c) => {
  await requireAdmin(c);
  const sites = await c.db.rows("SELECT id, site_code, site_name, status FROM lab_site ORDER BY site_code");
  const users = await c.db.rows("SELECT id, username, full_name, is_admin, is_active, last_login_at, locked_at, must_change_password, (password_hash IS NOT NULL) AS has_password, title, (signature_document_id IS NOT NULL) AS has_signature, signature_set_at FROM app_user WHERE username <> 'system' AND NOT is_automated ORDER BY full_name"); // automated verification accounts are not people: never in groups (WD-6)
  const groups = await c.db.rows(`SELECT g.id, g.group_name, g.site_id, g.description FROM lab_group g WHERE g.status = 'Active' AND (g.site_id = NULLIF($1, '')::uuid OR g.site_id IS NULL)
    ORDER BY g.site_id IS NULL, g.is_standard DESC, g.group_name`, [c.siteId || '']);
  const members = await c.db.rows(`SELECT m.user_id, m.group_id FROM group_member m JOIN lab_group g ON g.id = m.group_id
    WHERE m.status = 'Active' AND (g.site_id = NULLIF($1, '')::uuid OR g.site_id IS NULL)`, [c.siteId || '']);
  const site = await c.db.one("SELECT id, site_code, site_name FROM lab_site WHERE id = NULLIF($1, '')::uuid", [c.siteId || '']);
  const me = await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]);
  return { sites, users, groups, members, site, isSystemAdmin: !!(me && me.is_admin) };
});
// A person's handwritten signature (an image) and title, recorded by a lab administrator, signed (migration 028)
route('POST', '/api/admin/users/:id/signature', async (c) => {
  await requireAdmin(c);
  if (!isUuid(c.params.id)) throw new Error('User not found');
  const b64 = String(c.body.b64 || '');
  if (b64 && !/^image\/(png|jpeg)$/.test(c.body.mime_type || '')) throw new Error('The signature must be a PNG or JPEG image (a scan or photo of the handwritten signature)');
  return signedTx({ ...c, reason: c.body.reason || 'Handwritten signature recorded' }, { meaning: 'Recorded by', action: 'Handwritten signature and title', module: 'Admin' }, async (t) => {
    let doc = null;
    if (b64) {
      const buf = Buffer.from(b64, 'base64');
      doc = (await t.one(`INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ($1, $2, $3, $4, decode($5, 'base64')) RETURNING id`,
        [String(c.body.file_name || 'signature').slice(0, 200), c.body.mime_type, buf.length, require('crypto').createHash('sha256').update(buf).digest('hex'), b64])).id;
    }
    await t.query('SELECT set_user_signature($1, $2, $3)', [c.params.id, doc, c.body.title || '']);
    return { ok: true };
  });
});
route('GET', '/api/admin/users/:id/signature', async (c) => {
  if (c.query.s) c.siteId = c.query.s;   // shown as an image: the lab comes in the link
  await requireAdmin(c);
  if (!isUuid(c.params.id)) throw new Error('User not found');
  const here = await c.db.one('SELECT user_can_access_site($1, $2) AS ok, (SELECT is_admin FROM app_user WHERE id = $3) AS sys', [c.params.id, await currentSite(c), c.userId]);
  if (!here.ok && !here.sys) throw new Error('This person does not work in this lab');
  const d = await c.db.one(`SELECT f.mime_type, encode(f.content, 'base64') AS b64 FROM app_user u JOIN document_file f ON f.id = u.signature_document_id WHERE u.id = $1`, [c.params.id]);
  if (!d) throw new Error('No signature on file');
  return { __raw: true, body: Buffer.from(d.b64, 'base64'), type: d.mime_type, headers: { 'Content-Disposition': 'inline; filename="signature"' } };
});
// rows: [{ user_id, site_id, active }] -> one assignment per user and lab, switched Active / Inactive (never deleted)
// (Lab access ticks were replaced by group membership in migration 008: see routes_permissions.js)
route('GET', '/api/matrices', (c) => c.db.rows('SELECT * FROM matrix ORDER BY lower(matrix_name)'));
route('POST', '/api/matrices/bulk', (c) => tx(c, (t) => upsertRows(t, 'matrix', c.body.rows, ['matrix_name', 'description', 'product_category_id', 'status'])));
// Product categories (migration 013): Cosmetic, Dietary Supplement, Food...; a matrix may belong to one; workflow steps can set amounts per category
route('GET', '/api/product-categories', (c) => c.db.rows('SELECT * FROM product_category ORDER BY sort_order, lower(category_name)'));
route('POST', '/api/product-categories/bulk', (c) => tx(c, (t) => upsertRows(t, 'product_category', c.body.rows, ['category_name', 'description', 'sort_order', 'status'])));
route('GET', '/api/timezones', (c) => c.db.rows(`SELECT name FROM pg_timezone_names WHERE name ~ '^(America|Europe|Asia|Australia|Pacific|Africa)/' ORDER BY name`));
route('POST', '/api/sites/bulk', async (c) => { await requireSystemAdmin(c); return tx(c, (t) => upsertRows(t, 'lab_site', c.body.rows, ['site_code', 'site_name', 'time_zone', 'address', 'default_oos_procedure', 'require_workflow_verification', 'subcontract_discount_pct', 'subcontract_markup_pct', 'accreditation_body', 'accreditation_certificate', 'accreditation_statement', 'stability_pull_window_days', 'stability_reserve_pct', 'custody_signature_required', 'require_training', 'status'])); });
route('GET', '/api/sites/:id/holidays', async (c) => (await checkSite(c, c.params.id), c.db.rows('SELECT * FROM site_holiday WHERE site_id = $1 ORDER BY holiday_date', [c.params.id])));
route('POST', '/api/sites/:id/holidays/bulk', (c) => tx(c, (t) => upsertRows(t, 'site_holiday', c.body.rows, ['holiday_date', 'description', 'status'], { site_id: c.params.id })));

// (orders of origin Workflow Verification are the automated runs' own: shown on their verification, not in the lab's lists)
route('GET', '/api/orders', async (c) => c.db.rows("SELECT * FROM lab_order_view WHERE site_id = $1 AND origin::text <> 'Workflow Verification' ORDER BY order_code DESC", [await currentSite(c)]));
route('POST', '/api/orders', async (c) => {
  const site = await currentSite(c); // new orders are always for the lab the user is working in
  return tx(c, (t) => upsertRows(t, 'lab_order', [{ ...c.body.row, site_id: site }], ['client_id', 'site_id', 'ordering_contact_id', 'submission_channel', 'po_number', 'notes', 'client_license_id'])).then((r) => r[0]);
});
route('PUT', '/api/orders/:id', (c) => tx(c, (t) => upsertRows(t, 'lab_order', [{ ...c.body.row, id: c.params.id }], ['po_number', 'notes', 'status', 'ordering_contact_id', 'submission_channel', 'client_license_id'])));
route('GET', '/api/orders/:id', async (c) => {
  const order = await c.db.one('SELECT * FROM lab_order_view WHERE id = $1', [c.params.id]);
  if (!order) throw new Error('Order not found');
  await checkSite(c, order.site_id);
  order.client_license_id = (await c.db.one('SELECT client_license_id FROM lab_order WHERE id = $1', [order.id])).client_license_id;   // 055: not in lab_order_view
  const samples = await c.db.rows(`SELECT sv.*, (SELECT count(*) FROM sample_photo ph WHERE ph.sample_id = sv.id AND ph.status = 'Active')::int AS photo_count, s2.serving_size, s2.serving_unit, s2.serving_count, s2.serving_count_unit, s2.servings_per_package, s2.report_per_serving, s2.unit_weight, s2.unit_weight_unit, s2.unit_weight_result_id, s2.density, s2.density_unit, s2.density_result_id, s2.metrc_id FROM sample_view sv JOIN sample s2 ON s2.id = sv.id
    WHERE sv.lab_order_id = $1 ORDER BY sv.created_at, sv.client_sample_id`, [c.params.id]);   // (serving size: migration 028)
  const tests = await c.db.rows(`SELECT v.*, rt2.serving_order, (SELECT count(*) FROM specification sp WHERE sp.requested_test_id = v.id AND sp.status = 'Active') AS spec_count,
      rt2.ordered_package_id, op.order_package_code, op.status AS package_status, tp.package_code, tp.package_name
    FROM requested_test_view v JOIN requested_test rt2 ON rt2.id = v.id LEFT JOIN ordered_package op ON op.id = rt2.ordered_package_id LEFT JOIN test_package tp ON tp.id = op.package_id
    WHERE v.lab_order_id = $1 ORDER BY v.logged_at NULLS LAST, v.client_sample_id, v.test_name`, [c.params.id]);   // packages: 047
  const packages = await c.db.rows('SELECT * FROM orderable_packages($1) WHERE site_id = $2 ORDER BY project_code, package_name', [order.client_id, order.site_id]);
  const orderable = await c.db.rows(`SELECT ol.*, pv.project_id, pv.id AS project_version_id, pv.version_no FROM orderable_lines($1) ol JOIN quoted_test_configuration q ON q.id = ol.line_id
    JOIN project_version pv ON pv.id = q.project_version_id JOIN test tt ON tt.id = ol.test_id
    WHERE tt.site_id IS NULL OR tt.site_id = $2 ORDER BY ol.project_code, ol.test_name`, [order.client_id, order.site_id]);   // another lab's tests are subcontracted: not ordered here yet (031)
  const units = await c.db.rows("SELECT unit_code, unit_name, dimension::text AS dimension, is_serving_unit FROM unit_of_measure WHERE status = 'Active' ORDER BY sort_order, unit_code");
  const elsewhere = await c.db.rows(`SELECT DISTINCT ol.test_name, ls.site_code FROM orderable_lines($1) ol JOIN test tt ON tt.id = ol.test_id JOIN lab_site ls ON ls.id = tt.site_id
    WHERE tt.site_id <> $2 ORDER BY ls.site_code, ol.test_name`, [order.client_id, order.site_id]);
  const tiers = await c.db.rows(`SELECT rt.id, rt.schedule_id, s.schedule_name, rt.tier_name, rt.rush_tat, rt.tat_unit, rt.sort_order
    FROM rush_fee_tier rt JOIN rush_fee_schedule s ON s.id = rt.schedule_id WHERE rt.status = 'Active' ORDER BY s.schedule_name, rt.rush_tat`);
  const contacts = await c.db.rows(`SELECT ct.id, ct.first_name || ' ' || ct.last_name AS name FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id
    WHERE cc.client_id = $1 AND cc.status = 'Active' AND ct.status = 'Active' AND 'ORDERING' = ANY(cc.roles) ORDER BY ct.last_name`, [order.client_id]);
  const emails = await c.db.rows('SELECT * FROM email_outbox WHERE lab_order_id = $1 ORDER BY created_at DESC', [c.params.id]);
  const matrices = await c.db.rows("SELECT matrix_name FROM matrix WHERE status = 'Active' ORDER BY lower(matrix_name)");
  const categories = await c.db.rows("SELECT category_name FROM compliance_category WHERE status = 'Active' ORDER BY sort_order, category_name");
  const attachments = await c.db.rows(`SELECT a.id, a.kind, a.label, a.sample_id, f.file_name, a.created_at FROM sample_attachment a JOIN document_file f ON f.id = a.document_id
    WHERE a.lab_order_id = $1 AND a.status = 'Active' ORDER BY a.created_at`, [c.params.id]);
  // the client's licenses the order can name (0.32.0, migration 055): current first; the order's own even if retired
  const licenses = await c.db.rows(`SELECT id, license_code, license_type, license_number, issuing_authority, expires_on, license_state_on(expires_on, status::text, site_today($3::uuid)) AS state, status_text FROM client_license_view
    WHERE client_id = $1 AND (status = 'Active' OR id = $2) ORDER BY (license_state_on(expires_on, status::text, site_today($3::uuid)) = 'Expired'), license_type, expires_on DESC NULLS FIRST`, [order.client_id, order.client_license_id || null, order.site_id]);
  return { order, samples, tests, orderable, packages, tiers, contacts, emails, matrices: matrices.map((m) => m.matrix_name), categories: categories.map((m) => m.category_name), attachments, units, elsewhere, licenses };
});
route('GET', '/api/samples/:id', async (c) => {
  const sample = await c.db.one('SELECT sv.*, s2.serving_size, s2.serving_unit, s2.serving_count, s2.serving_count_unit, s2.servings_per_package, s2.report_per_serving, s2.unit_weight, s2.unit_weight_unit, s2.unit_weight_result_id, s2.density, s2.density_unit, s2.density_result_id, s2.metrc_id FROM sample_view sv JOIN sample s2 ON s2.id = sv.id WHERE sv.id = $1', [c.params.id]);
  if (!sample) throw new Error('Sample not found');
  const order = await c.db.one('SELECT * FROM lab_order_view WHERE id = $1', [sample.lab_order_id]);
  await checkSite(c, order.site_id);
  const tests = await c.db.rows(`SELECT v.*, rt2.serving_order, (SELECT count(*) FROM specification sp WHERE sp.requested_test_id = v.id AND sp.status = 'Active') AS spec_count,
      rt2.ordered_package_id, op.order_package_code, op.status AS package_status, tp.package_code, tp.package_name
    FROM requested_test_view v JOIN requested_test rt2 ON rt2.id = v.id LEFT JOIN ordered_package op ON op.id = rt2.ordered_package_id LEFT JOIN test_package tp ON tp.id = op.package_id
    WHERE v.sample_id = $1 ORDER BY v.test_name`, [c.params.id]);
  const logged_by = sample.logged_by ? (await c.db.one('SELECT full_name FROM app_user WHERE id = $1', [sample.logged_by])).full_name : null;
  // what still holds results per serving (033), and the serving tests on the sample
  const serving_held = await c.db.rows(`SELECT rt.id, t.test_name, serving_problem(rt.id) AS problem FROM requested_test rt JOIN test t ON t.id = rt.test_id
    WHERE rt.sample_id = $1 AND rt.status <> 'Cancelled' AND serving_problem(rt.id) IS NOT NULL ORDER BY t.test_name`, [c.params.id]);
  const serving_tests = await c.db.rows(`SELECT t.serving_role, t.test_name, rt.status::text AS status FROM requested_test rt JOIN test t ON t.id = rt.test_id
    WHERE rt.sample_id = $1 AND rt.status <> 'Cancelled' AND t.serving_role IS NOT NULL`, [c.params.id]);
  return { sample: { ...sample, logged_by_name: logged_by }, order, tests, serving_held, serving_tests };
});
route('GET', '/api/order-setup/:clientId', async (c) => ({
  contacts: await c.db.rows(`SELECT ct.id, ct.first_name || ' ' || ct.last_name AS name FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id
    WHERE cc.client_id = $1 AND cc.status = 'Active' AND ct.status = 'Active' AND 'ORDERING' = ANY(cc.roles) ORDER BY ct.last_name`, [c.params.clientId]),
  orderableCount: (await c.db.one('SELECT count(*) AS n FROM orderable_lines($1)', [c.params.clientId])).n,
}));
route('POST', '/api/orders/:id/samples', (c) => tx(c, (t) => upsertRows(t, 'sample', c.body.rows, ['client_sample_id', 'description', 'matrix', 'product', 'lot', 'batch',
  'quantity_received', 'quantity_unit', 'number_of_units', 'condition', 'receipt_temperature', 'preservation', 'received_at', 'status', 'compliance_category',
  'serving_size', 'serving_unit', 'serving_count', 'serving_count_unit', 'servings_per_package', 'report_per_serving', 'metrc_id'], { lab_order_id: c.params.id })));   // (serving: 031)   // (serving size: migration 028)
// Serving size, Part B (migration 033): ask the client for the serving test the per-serving results need (it waits for
// their consent; consent orders it), or order it now when the client already agreed
route('POST', '/api/samples/:id/serving-request', async (c) => {
  if (!isUuid(c.params.id)) throw new Error('Sample not found');
  const s = await c.db.one('SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = $1', [c.params.id]);
  if (!s) throw new Error('Sample not found');
  await checkSite(c, s.site_id);
  const role = c.body.role === 'Density' ? 'Density' : 'Serving weight';
  return tx({ ...c, reason: c.body.reason || `Request for the ${role.toLowerCase()} test` }, (t) => t.one('SELECT request_serving_test($1, $2, $3) AS id', [c.params.id, role, c.body.note || null]));
});
// a quote: add the lab's serving test (its catalogue price), so the client sees what the per-serving calculation costs
route('POST', '/api/versions/:vid/serving-line', async (c) => {
  if (!isUuid(c.params.vid)) throw new Error('Quote not found');
  const v = await c.db.one('SELECT p.site_id FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = $1', [c.params.vid]);
  if (!v) throw new Error('Quote not found');
  const site = v.site_id || await currentSite(c);
  const role = c.body.role === 'Density' ? 'Density' : 'Serving weight';
  const test = await c.db.one('SELECT lab_serving_test($1, $2) AS id', [site, role]);
  if (!test.id) throw new Error(`This lab has no ${role} test with an approved workflow yet (Test catalogue: "Serving test")`);
  return tx({ ...c, reason: c.reason || 'Quote edited' }, async (t) => {
    const [row] = await upsertRows(t, 'quoted_test_configuration', [{ test_id: test.id, quantity: Number(c.body.quantity) || 1, special_instructions: 'Per-serving calculation' }], ['test_id', 'quantity', 'special_instructions'], { project_version_id: c.params.vid });
    await t.query('UPDATE quoted_test_configuration SET final_price = list_price WHERE id = $1 AND final_price IS NULL', [row.id]);
    return row;
  });
});
route('POST', '/api/orders/:id/apply-project', (c) => tx(c, async (t) => {
  let n = 0; for (const s of c.body.sample_ids) n += (await t.one('SELECT apply_project($1, $2) AS n', [s, c.body.project_id])).n; return { added: n };
}));
route('POST', '/api/orders/:id/add-test', (c) => tx(c, async (t) => {
  let n = 0;
  for (const s of c.body.sample_ids) {
    const exists = await t.one(`SELECT 1 AS x FROM requested_test rt JOIN quoted_test_configuration q ON q.id = $2
      WHERE rt.sample_id = $1 AND rt.test_id = q.test_id AND rt.status <> 'Cancelled'`, [s, c.body.line_id]);
    if (!exists) { await t.one('SELECT order_test($1, $2) AS id', [s, c.body.line_id]); n++; }
  }
  return { added: n };
}));
route('POST', '/api/orders/:id/tests', (c) => tx(c, (t) => upsertRows(t, 'requested_test', c.body.rows, ['rush_tier_id', 'status', 'special_instructions', 'tat_override'])));
route('POST', '/api/orders/:id/rush', (c) => tx(c, async (t) => {
  let n = 0;
  for (const [scheduleId, tierId] of Object.entries(c.body.tiers || {})) {
    const r = await t.query(`UPDATE requested_test rt SET rush_tier_id = $3 FROM sample s, test_catalog_entry e
      WHERE rt.sample_id = s.id AND s.lab_order_id = $1 AND e.test_id = rt.test_id AND e.rush_schedule_id = $2 AND rt.status <> 'Cancelled'
        AND rt.rush_tier_id IS DISTINCT FROM $3::uuid RETURNING rt.id`, [c.params.id, scheduleId, tierId || null]);
    n += r.rows.length;
  }
  return { changed: n };
}));
route('POST', '/api/orders/:id/log', (c) => tx(c, (t) => t.one('SELECT log_samples($1::uuid[]) AS logged', [c.body.sample_ids])));
// Cancel samples and tests (0.34.0, migration 057): nothing is deleted; always with a reason. The database refuses a
// test with results or in a batch (and a sample holding one), saying why; cancelling a sample cancels its tests.
route('POST', '/api/orders/:id/cancel', async (c) => {
  if (!isUuid(c.params.id)) throw new Error('Order not found');
  const o = await c.db.one('SELECT id, site_id FROM lab_order WHERE id = $1', [c.params.id]);
  if (!o) throw new Error('Order not found');
  await checkSite(c, o.site_id);
  const b = c.body || {};
  const samples = (Array.isArray(b.sample_ids) ? b.sample_ids : []).filter(isUuid);
  const tests = (Array.isArray(b.test_ids) ? b.test_ids : []).filter(isUuid);
  if (!samples.length && !tests.length) throw new Error('Choose the samples or tests to cancel');
  if (!String(b.reason || '').trim()) throw new Error('Say why they are cancelled');
  return tx({ ...c, reason: b.reason }, async (t) => {
    let s = 0; let n = 0;
    for (const id of samples) {
      s += (await t.rows(`UPDATE sample SET status = 'Cancelled' WHERE id = $1 AND lab_order_id = $2 AND status <> 'Cancelled' RETURNING id`, [id, o.id])).length;
    }
    for (const id of tests) {
      n += (await t.rows(`UPDATE requested_test SET status = 'Cancelled' WHERE id = $1 AND status <> 'Cancelled'
        AND sample_id IN (SELECT id FROM sample WHERE lab_order_id = $2) RETURNING id`, [id, o.id])).length;
    }
    return { samples: s, tests: n };
  });
});
route('GET', '/api/requested-tests/:id/analytes', async (c) => {
  if (!isUuid(c.params.id)) throw new Error('Test not found');
  const r = await c.db.one('SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = $1', [c.params.id]);
  if (!r) throw new Error('Test not found');
  await checkSite(c, r.site_id);
  return c.db.rows(`SELECT ra.*, a.analyte_name, a.report_name FROM requested_analyte ra
  JOIN analyte a ON a.id = ra.analyte_id WHERE ra.requested_test_id = $1 ORDER BY a.analyte_name`, [c.params.id]);
});
route('POST', '/api/requested-tests/:id/analytes', (c) => tx(c, (t) => upsertRows(t, 'requested_analyte', c.body.rows, ['included'])));

route('GET', '/api/intake', async (c) => {
  const site = await currentSite(c);
  const f = "($1 = '' OR r.site_id::text = $1)";
  const pending = await c.db.rows(`SELECT r.*, (SELECT client_name FROM lab_order_view o WHERE o.id = r.lab_order_id) AS client_name,
    r.approval_due_at < now() AS overdue FROM requested_test_view r WHERE r.rush_status = 'Pending Approval' AND r.status <> 'Cancelled' AND ${f}
    ORDER BY r.rush_requested_at`, [site]);
  const incoming = await c.db.rows(`SELECT r.*, (SELECT client_name FROM lab_order_view o WHERE o.id = r.lab_order_id) AS client_name
    FROM requested_test_view r WHERE r.rush_status IN ('Auto-accepted','Approved') AND r.status <> 'Cancelled' AND ${f}
    ORDER BY r.due_date NULLS FIRST, r.rush_requested_at`, [site]);
  const expected = await c.db.rows(`SELECT o.id AS lab_order_id, o.order_code, o.client_name, o.site_code, o.submission_channel,
    count(*) FILTER (WHERE s.status = 'Expected') AS expected_samples, o.account_status
    FROM lab_order_view o JOIN sample s ON s.lab_order_id = o.id WHERE s.status = 'Expected' AND ($1 = '' OR o.site_id::text = $1)
    GROUP BY o.id, o.order_code, o.client_name, o.site_code, o.submission_channel, o.account_status ORDER BY o.order_code`, [site]);
  const today = await c.db.rows(`SELECT s.id AS sample_id, s.sample_code, s.client_sample_id, s.description, s.logged_at, s.due_date, s.test_count, o.order_code, o.client_name, o.id AS lab_order_id
    FROM sample_view s JOIN lab_order_view o ON o.id = s.lab_order_id
    WHERE s.logged_at >= now() - interval '24 hours' AND ($1 = '' OR o.site_id::text = $1) AND o.origin::text <> 'Workflow Verification' ORDER BY s.logged_at DESC`, [site]);
  const tiers = await c.db.rows(`SELECT rt.id, rt.schedule_id, rt.tier_name, rt.rush_tat, rt.tat_unit FROM rush_fee_tier rt WHERE rt.status = 'Active' ORDER BY rt.rush_tat`);
  return { pending, incoming, expected, today, tiers };
});
route('POST', '/api/rush-decisions', (c) => tx({ ...c, reason: c.body.reason || (c.body.decision === 'Approved' ? 'Rush approved by intake' : '') }, (t) =>
  upsertRows(t, 'rush_decision', [c.body], ['requested_test_id', 'decision', 'requested_tier_id', 'replacement_tier_id', 'reason'])));
route('GET', '/api/outbox', async (c) => c.db.rows(`SELECT e.*, o.order_code, u.full_name AS triggered_by, p.project_code AS quote_code, p.id AS quote_project_id
  FROM email_outbox e LEFT JOIN lab_order o ON o.id = e.lab_order_id JOIN app_user u ON u.id = e.created_by
  LEFT JOIN project_version pv ON pv.id = e.project_version_id LEFT JOIN project p ON p.id = pv.project_id
  WHERE COALESCE(o.site_id, e.site_id) = $1 ORDER BY e.created_at DESC LIMIT 200`, [await currentSite(c)]));
// (version 1 of a test is made Effective by approval in the Workflow Designer: /api/methods/versions/:id/approve)

// ================================================================ SLICE 3: inventory (server/routes_inventory.js)
require('./routes_permissions')({ route, tx, signedTx, upsertRows, currentSite, checkSite, requireAdmin, requireSystemAdmin, requirePermission, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, SITE_AUDIT_KINDS, AUDIT_CHECKS });
require('./routes_inventory')({ route, tx, signedTx, upsertRows, currentSite, checkSite, requireAdmin, requirePermission, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, SITE_AUDIT_KINDS, AUDIT_CHECKS });
// ================================================================ PHASE 1: equipment (server/routes_equipment.js)
const equipment = require('./routes_equipment')({ route, tx, signedTx, upsertRows, currentSite, checkSite, requirePermission, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, SITE_AUDIT_KINDS, AUDIT_CHECKS });
// ================================================================ PHASE 1: purchasing (server/routes_purchasing.js)
require('./routes_purchasing')({ route, tx, signedTx, upsertRows, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, SITE_AUDIT_KINDS, AUDIT_CHECKS });
// ================================================================ WORKFLOW DESIGNER, WD-1: test definitions (server/routes_methods.js)
require('./routes_methods')({ route, tx, signedTx, upsertRows, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS });
// ================================================================ WORKFLOW DESIGNER, WD-2: chemistry execution (server/routes_testing.js)
require('./routes_testing')({ route, tx, signedTx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, SITE_AUDIT_KINDS, AUDIT_CHECKS });
// Workflow verification (WD-6): protocol, automated run and report for a draft test version
require('./routes_verification')({ route, signedTx, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_CHECKS });
// Result Finalization and the COA (R-1)
require('./routes_reports')({ route, tx, upsertRows, currentSite, checkSite, hasPermission, requirePermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS });
// OOS investigations and retests (R-2)
require('./routes_oos')({ route, tx, signedTx, upsertRows, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS });
require('./routes_quotes')({ route, tx, currentSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS });
require('./routes_labsetup')({ route, tx, upsertRows, checkSite, hasPermission, requireSystemAdmin, isUuid, AUDIT_LISTS });
// ================================================================ STABILITY STUDIES (migration 032): server/routes_stability.js
const stabilityRoutes = require('./routes_stability');
const sensorFeed = require('./sensor_feed');
stabilityRoutes({ route, tx, signedTx, upsertRows, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS });
// ================================================================ ELECTRONIC LOGBOOKS (migrations 034, 035): server/routes_logbooks.js
require('./routes_logbooks')({ route, tx, signedTx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS });
// ================================================================ INVOICING (migration 036): server/routes_invoicing.js
require('./routes_invoicing')({ route, tx, signedTx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS });
// ================================================================ DASHBOARDS (migration 037): server/routes_dashboard.js
require('./routes_dashboard')({ route, tx, currentSite, hasPermission, isUuid, AUDIT_LISTS });
// ================================================================ TRENDING AND CONTROL CHARTS (migration 043): server/routes_trending.js
require('./routes_trending')({ route, tx, signedTx, currentSite, checkSite, hasPermission, requirePermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS });
// ================================================================ 0.25.0: the sensor feed (server/routes_sensors.js, server/sensor_feed.js)
require('./routes_sensors')({ route, tx, signedTx, currentSite, checkSite, hasPermission, requireSystemAdmin, isUuid, AUDIT_LISTS });
// ================================================================ TEST PACKAGES AND DATED PRICE CHANGES (migration 047): server/routes_packages.js
const packageRoutes = require('./routes_packages');
packageRoutes({ route, tx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS });
// Barcode labels for samples, lots, equipment and batches (Claude Code, 2026-10-13)
// training and competency (0.31.0, migration 053)
require('./routes_training')({ route, tx, signedTx, currentSite, checkSite, hasPermission, isUuid, AUDIT_SCOPES, AUDIT_LISTS, AUDIT_CHECKS });
// waste classifications (0.30.0, migration 052)
require('./routes_waste')({ route, tx, currentSite, hasPermission, isUuid, AUDIT_LISTS });
// the chain of custody, receipts and sample photos (0.29.0, migration 051)
require('./routes_custody')({ route, signedTx, tx, checkSite, hasPermission, isUuid, AUDIT_SCOPES });
require('./routes_labels')({ route, checkSite, currentSite, isUuid });
// Background jobs: automatic equipment tag-outs (expired calibration, maintenance due) at start and every hour
module.exports.startJobs = (db) => {
  const run = () => equipment.autoTag(db).then((r) => { if (r && Number(r.n)) console.log(`Equipment: ${r.n} automatic tag-out(s)`); }).catch((e) => console.error('Automatic tag-out failed:', e.message));
  const pulls = () => stabilityRoutes.makeDuePulls(db).then((r) => { if (r && Number(r.n)) console.log(`Stability: ${r.n} pull order(s) made`); }).catch((e) => console.error('Stability pull orders failed:', e.message));
  // the sensor feed: every minute, each lab whose connection is on and whose last read is older than its interval (0.25.0)
  const sensors = () => sensorFeed.runDue(db).then((rs) => { for (const r of rs) if (r.errors && r.errors.length) console.error('Sensor feed:', r.errors.join('; ')); }).catch((e) => console.error('Sensor feed failed:', e.message));
  setInterval(sensors, 60 * 1000);
  const prices = () => packageRoutes.applyDue(db).then((r) => { if (r && r.n) console.log(`Catalogue: ${r.n} scheduled price change(s) applied`); }).catch((e) => console.error('Scheduled price changes failed:', e.message));
  run(); pulls(); prices(); return setInterval(() => { run(); pulls(); prices(); }, 60 * 60 * 1000);
};
// ================================================================ SLICE 3.2: login and signatures (server/auth.js)
registerAuth({ route, requireAdmin });
AUDIT_LISTS.reasons = ['reason_code'];
