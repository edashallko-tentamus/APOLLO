// Permissions and lab groups API (migration 008). Registered from routes.js. Rules live in the database: who may change
// groups (admin.groups), who may change memberships (admin.users), signatures, no self-promotion, view-only all-labs group.
'use strict';
const { writeXlsx } = require('./xlsx');

module.exports = function registerPermissions({ route, signedTx, currentSite, requireAdmin, requireSystemAdmin, requirePermission, hasPermission, AUDIT_SCOPES, AUDIT_LISTS, SITE_AUDIT_KINDS }) {
  // Audit icon on the People and groups, Groups and permissions and Permission matrix pages: this lab's (and the all-labs) groups
  const GROUP_PARTS = (where) => `SELECT 'lab_group', g.id FROM lab_group g WHERE ${where}
    UNION ALL SELECT 'group_permission', gp.id FROM group_permission gp JOIN lab_group g ON g.id = gp.group_id WHERE ${where}
    UNION ALL SELECT 'group_member', m.id FROM group_member m JOIN lab_group g ON g.id = m.group_id WHERE ${where}`;
  AUDIT_SCOPES.groups = GROUP_PARTS('(g.site_id = $1 OR g.site_id IS NULL)');
  AUDIT_SCOPES.users = `SELECT 'group_member', m.id FROM group_member m JOIN lab_group g ON g.id = m.group_id WHERE g.site_id = $1 OR g.site_id IS NULL`;
  delete AUDIT_LISTS.users; delete AUDIT_LISTS.jobroles;
  SITE_AUDIT_KINDS.push('groups', 'users');
  const requireAuditOrAdmin = async (c) => {
    if (!(await hasPermission(c, 'audit.view')) && !(await hasPermission(c, 'admin.users')) && !(await hasPermission(c, 'admin.groups'))) {
      throw new Error('You need the audit trail or lab administration permission to see the permission matrix.');
    }
  };

  // The permission list (module > area > description)
  route('GET', '/api/permissions', (c) => c.db.rows('SELECT * FROM permission ORDER BY sort_order, code'));

  // This lab's groups (and the all-labs groups), each with its permissions and member count
  route('GET', '/api/groups', async (c) => {
    const site = await currentSite(c);
    const groups = await c.db.rows(`SELECT g.*, s.site_code,
        (SELECT count(*) FROM group_member m JOIN app_user u ON u.id = m.user_id WHERE m.group_id = g.id AND m.status = 'Active' AND u.is_active) AS member_count,
        (SELECT COALESCE(json_agg(gp.permission_code ORDER BY gp.permission_code), '[]') FROM group_permission gp WHERE gp.group_id = g.id AND gp.status = 'Active') AS permissions
      FROM lab_group g LEFT JOIN lab_site s ON s.id = g.site_id WHERE g.site_id = $1 OR g.site_id IS NULL
      ORDER BY g.site_id IS NULL, g.status, g.is_standard DESC, lower(g.group_name)`, [site]);
    const permissions = await c.db.rows("SELECT * FROM permission WHERE status = 'Active' ORDER BY sort_order, code");
    const departments = await c.db.rows("SELECT id, department_code, department_name FROM department WHERE site_id = $1 AND status = 'Active' ORDER BY department_code", [site]);
    return { groups, permissions, departments, canEdit: await hasPermission(c, 'admin.groups'), canEditAllLabs: !!(await c.db.one('SELECT is_admin FROM app_user WHERE id = $1', [c.userId]))?.is_admin };
  });
  // Create, rename, describe or retire this lab's groups (signed)
  route('POST', '/api/groups', async (c) => {
    const site = await currentSite(c);
    await requirePermission(c, 'admin.groups', 'change groups');
    const rows = c.body.rows || [];
    return signedTx(c, { meaning: 'Approved by', action: `Groups at this lab: ${rows.length} change(s)`, module: 'Admin' }, async (t) => {
      const out = [];
      for (const r of rows) {
        if (r.id) {
          const g = await t.one('SELECT site_id FROM lab_group WHERE id = $1', [r.id]);
          if (!g || g.site_id !== site) throw new Error('That group belongs to another lab.');
          // only the fields that were changed (a group can be marked as one of the lab's departments: migration 012)
          out.push(await t.one(`UPDATE lab_group SET group_name = COALESCE($2, group_name),
              description = CASE WHEN $5 THEN $3 ELSE description END, status = COALESCE($4::record_status, status),
              department_id = CASE WHEN $7 THEN $6::uuid ELSE department_id END
            WHERE id = $1 RETURNING id`, [r.id, r.group_name || null, r.description || null, r.status || null, 'description' in r, r.department_id || null, 'department_id' in r]));
        } else {
          out.push(await t.one('INSERT INTO lab_group (site_id, group_name, description, department_id) VALUES ($1, $2, $3, $4) RETURNING id',
            [site, r.group_name, r.description || null, r.department_id || null]));
        }
      }
      return out;
    });
  });
  // The group x permission matrix: rows [{ group_id, permission_code, active }] (signed by the lab's approver of permission changes)
  route('POST', '/api/groups/permissions', async (c) => {
    await currentSite(c);
    const rows = c.body.rows || [];
    return signedTx(c, { meaning: 'Approved by', action: `Group permissions: ${rows.length} change(s)`, module: 'Admin' }, async (t) => {
      for (const r of rows) {
        await t.query(`INSERT INTO group_permission (group_id, permission_code, status) VALUES ($1, $2, $3)
          ON CONFLICT (group_id, permission_code) DO UPDATE SET status = EXCLUDED.status WHERE group_permission.status <> EXCLUDED.status`,
        [r.group_id, r.permission_code, r.active ? 'Active' : 'Inactive']);
      }
      return { changed: rows.length };
    });
  });

  // Who is in which group at this lab: rows [{ user_id, group_id, active }] (signed)
  route('POST', '/api/admin/memberships', async (c) => {
    await currentSite(c);
    await requireAdmin(c);
    const rows = c.body.rows || [];
    return signedTx(c, { meaning: 'Approved by', action: `Group membership: ${rows.length} change(s)`, module: 'Admin' }, async (t) => {
      for (const r of rows) {
        await t.query(`INSERT INTO group_member (group_id, user_id, status) VALUES ($1, $2, $3)
          ON CONFLICT (group_id, user_id) DO UPDATE SET status = EXCLUDED.status WHERE group_member.status <> EXCLUDED.status`,
        [r.group_id, r.user_id, r.active ? 'Active' : 'Inactive']);
      }
      return { changed: rows.length };
    });
  });

  // ------------------------------------------------------------ the permission matrix (on demand, exportable) and its history
  async function matrix(c, site) {
    const permissions = await c.db.rows("SELECT code, module, area, description FROM permission WHERE status = 'Active' ORDER BY sort_order, code");
    const users = await c.db.rows(`SELECT u.id, u.username, u.full_name, u.is_admin,
        (SELECT string_agg(g.group_name, ', ' ORDER BY g.group_name) FROM group_member m JOIN lab_group g ON g.id = m.group_id
          WHERE m.user_id = u.id AND m.status = 'Active' AND g.status = 'Active' AND (g.site_id = $1 OR g.site_id IS NULL)) AS groups
      FROM app_user u WHERE u.is_active AND u.username <> 'system'
        AND (u.is_admin OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id
              WHERE m.user_id = u.id AND m.status = 'Active' AND g.status = 'Active' AND (g.site_id = $1 OR g.site_id IS NULL)))
      ORDER BY u.full_name`, [site]);
    const held = await c.db.rows(`SELECT user_id, permission_code, string_agg(through_groups, ', ') AS through FROM user_permission_view
      WHERE site_id = $1 OR site_id IS NULL GROUP BY user_id, permission_code`, [site]);
    const key = new Map(held.map((h) => [h.user_id + '|' + h.permission_code, h.through]));
    const rows = users.map((u) => ({ ...u, ...Object.fromEntries(permissions.map((p) => [p.code, u.is_admin ? 'System administrator' : key.get(u.id + '|' + p.code) || ''])) }));
    return { permissions, rows };
  }
  route('GET', '/api/permission-matrix', async (c) => {
    const site = await currentSite(c); await requireAuditOrAdmin(c);
    const s = await c.db.one('SELECT site_code, site_name FROM lab_site WHERE id = $1', [site]);
    return { site: s, ...(await matrix(c, site)), generatedAt: new Date().toISOString() };
  });
  route('GET', '/api/permission-history', async (c) => {
    const site = await currentSite(c); await requireAuditOrAdmin(c);
    return c.db.rows(`SELECT * FROM permission_change_view WHERE site_id = $1 OR site_id IS NULL ORDER BY audit_id DESC LIMIT 1000`, [site]);
  });
  // Excel: sheet of who holds what (the "on demand" matrix for GMP and ISO 17025 audits) and the change history
  route('GET', '/api/permission-matrix.xlsx', async (c) => {
    if (c.query.s) c.siteId = c.query.s; // opened as a download link: the lab comes in the address
    const site = await currentSite(c); await requireAuditOrAdmin(c);
    const s = await c.db.one('SELECT site_code FROM lab_site WHERE id = $1', [site]);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    if (c.query.what === 'history') {
      const h = await c.db.rows(`SELECT * FROM permission_change_view WHERE site_id = $1 OR site_id IS NULL ORDER BY audit_id`, [site]);
      const body = writeXlsx({ sheetName: 'Permission history', headers: ['When', 'Change', 'Group', 'Person', 'Permission', 'Status', 'Changed by', 'Signed by', 'Signature meaning', 'Signed at', 'Reason'],
        rows: h.map((r) => [new Date(r.changed_at).toISOString().replace('T', ' ').slice(0, 19), `${r.table_name.replace(/_/g, ' ')} ${r.action.toLowerCase()}`, r.group_name || '',
          r.member_name || '', r.permission_code || '', r.status || '', r.changed_by, r.signed_by || '', r.signature_meaning || '', r.signed_at ? new Date(r.signed_at).toISOString().replace('T', ' ').slice(0, 19) : '', r.reason || '']),
        widths: [20, 22, 22, 22, 18, 10, 20, 20, 16, 20, 40] });
      return { __raw: true, body, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers: { 'Content-Disposition': `attachment; filename="${s.site_code} permission history ${stamp.replace(':', '')}.xlsx"` } };
    }
    const m = await matrix(c, site);
    const body = writeXlsx({ sheetName: `${s.site_code} permissions`, headers: ['Name', 'User ID', 'Groups', ...m.permissions.map((p) => `${p.module} > ${p.area} (${p.code})`)],
      rows: m.rows.map((r) => [r.full_name, r.username, r.is_admin ? 'System administrator' : r.groups || '', ...m.permissions.map((p) => r[p.code] || '')]),
      widths: [24, 14, 30, ...m.permissions.map(() => 18)] });
    return { __raw: true, body, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers: { 'Content-Disposition': `attachment; filename="${s.site_code} permission matrix ${stamp.replace(':', '')}.xlsx"` } };
  });
  void requireSystemAdmin;
};
