// Home, Contacts, Analytes, Rush fee schedules, Audit trail
import { api, esc, pageHeader, toast, modal, state, money, currentSite, currentUser, auditColumns, can } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, section } from './common.js';

export async function dashboard(main) {
  const d = await api('/dashboard');
  const site = currentSite();
  const tile = (n, label, href, warn) => `<a class="tile ${warn ? 'warn' : ''}" href="${href}"><b>${n}</b><span>${esc(label)}</span></a>`;
  main.innerHTML = pageHeader('LIMS3 Sandbox', `Clients, quotes, lab orders and samples. You are working in ${esc(site ? `${site.site_code} (${site.site_name})` : 'no lab: ask an administrator to assign you')}.`) + `
  <div class="tiles">
    ${tile(d.open_orders, `Open lab orders${site ? ' (' + site.site_code + ')' : ''}`, '#/orders')}${tile(d.rush_pending, `Rush awaiting approval${site ? ' (' + site.site_code + ')' : ''}`, '#/intake', d.rush_pending > 0)}
    ${tile(d.clients, 'Clients', '#/clients')}${tile(d.on_hold, 'Clients on hold', '#/clients', d.on_hold > 0)}
    ${tile(d.contacts, 'Contacts', '#/contacts')}${tile(d.tests, 'Tests in catalogue', '#/catalog')}
    ${tile(d.analytes, 'Active analytes', '#/analytes')}${tile(d.projects, 'Projects', '#/projects')}
    ${tile(d.open_quotes, 'Quotes in draft', '#/projects')}${tile(d.pricing_issues, 'Draft quote lines to check', '#/projects', d.pricing_issues > 0)}
    ${tile(d.audit_entries, 'Audit trail entries', '#/audit')}
  </div>
  <div class="card guide">
    <h2>Things to try</h2>
    <ol>
      <li><b>Analytes:</b> select a few cells in a column and press <kbd>Ctrl</kbd>+<kbd>D</kbd> to fill down, or copy a block from Excel and paste it with <kbd>Ctrl</kbd>+<kbd>V</kbd>. Type a wrong CAS number and watch it get rejected.</li>
      <li><b>Test catalogue:</b> open "Heavy Metals Panel", switch pricing modes, change analyte prices with fill down, and watch the list price update.</li>
      <li><b>Projects and quotes:</b> open the Acme Irvine project, start a new version, untick analytes on the metals line and see the price drop while the discount % stays the same. Then quote it and accept it.</li>
      <li><b>Clients:</b> put a client On Hold and see that it can still order but cannot release reports.</li>
      <li><b>Lab orders:</b> open LO-000001. Each sample's tests are listed under it (▾ hides them). Tick the strawberry sample and log it: it gets a CFL yymmdd ### ID such as CFL261012004 and due dates. Pick a rush tier in a test's Rush tier cell (type to search), or type a new number in its TAT cell to override the turnaround.</li>
      <li><b>Smart dropdowns:</b> in any pick list, type a few letters to jump to the closest match, or press the Down arrow (Enter in a grid cell) and use the arrow keys.</li>
      <li><b>Links:</b> every ID (order, sample, client, quote, test) is a link to its record. Copy it to share with a colleague.</li>
      <li><b>Intake dashboard:</b> approve the Same Day rush, or click "Not accepted", pick a slower tier and a reason, then read the automatic email in the Outbox.</li>
      <li><b>Audit trail:</b> the small clock icon next to a page title shows what changed on that page, who changed it and why. The Audit trail page shows everything.</li>
      <li><b>Labs:</b> the lab icon at the top right switches lab (CFL or TPS); you only see orders for your labs. Administrators assign labs under Admin, Users and lab access, and keep the Matrix list under Admin, Matrices.</li>
    </ol>
    <p class="help">Everyone signs in with their own user ID and password (Sign out is at the top right). Inventory changes ask for an electronic signature: your user ID and password again, with a reason picked from the canned list or typed. Administrators give each person a temporary password under Admin, Users and lab access. This is a sandbox with fictional demo data.</p>
  </div>`;
}

export async function contacts(main) {
  const rows = await api('/contacts');
  main.innerHTML = pageHeader('Contacts', 'One record per person. Link contacts to clients (and set their roles) from each client page.', '', { kind: 'contacts' }) + '<div id="g"></div>';
  editableGrid({
    el: main.querySelector('#g'), rows, allowAdd: true, search: true, filter: state.query.get('find') || '', what: 'contact records',
    newRow: () => ({ status: 'Active', portal_access: false }),
    columns: [
      { field: 'contact_code', title: 'Code', type: 'link', width: 90, href: (r) => (r.contact_code ? '#/contacts?find=' + encodeURIComponent(r.contact_code) : null) },
      { field: 'first_name', title: 'First name', required: true },
      { field: 'last_name', title: 'Last name', required: true },
      { field: 'email', title: 'Email', required: true, width: 230, validate: (v) => (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? 'Not a valid email' : null) },
      { field: 'phone', title: 'Phone' },
      { field: 'job_title', title: 'Job title' },
      { field: 'portal_access', title: 'Portal login', type: 'bool', width: 90 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90 },
      { field: 'clients', title: 'Linked clients', type: 'readonly', width: 220 },
    ],
    save: (rows, reason) => api('/contacts/bulk', { method: 'POST', body: { rows, reason } }),
    afterSave: () => contacts(main),
  });
}

export async function analytes(main) {
  const rows = await api('/analytes');
  // Molar mass (used for molar standards in mixtures) is maintained by QA, Lab Supervisors and administrators, with a source and an electronic signature
  const canMolar = can('master.molar_mass');
  main.innerHTML = pageHeader('Analytes', `Static master table, independent of Inventory. Report Name prints on the Certificate of Analysis. Molar mass converts molar standards (M, mol/L) to mg/L in mixtures; ${canMolar ? 'changing it asks for its source and your electronic signature' : 'QA and Lab Supervisors maintain it'}.`, '', { kind: 'analytes' }) + '<div id="g"></div>';
  editableGrid({
    el: main.querySelector('#g'), rows, allowAdd: true, search: true, filter: state.query.get('find') || '', what: 'analyte master data',
    newRow: () => ({ status: 'Active', analyte_class: 'Chemical', synonyms: [] }),
    columns: [
      { field: 'analyte_code', title: 'Code', type: 'link', width: 95, href: (r) => (r.analyte_code ? '#/analytes?find=' + encodeURIComponent(r.analyte_code) : null) },
      { field: 'analyte_name', title: 'Analyte name', required: true, width: 200 },
      { field: 'report_name', title: 'Report name (CoA)', width: 200, help: 'Defaults to the analyte name if left blank' },
      { field: 'analyte_class', title: 'Class', type: 'select', options: () => state.meta.enums.analyte_class, width: 140 },
      { field: 'cas_number', title: 'CAS number', width: 120, help: 'Chemical analytes only; check digit is validated' },
      { field: 'synonyms', title: 'Synonyms', type: 'array', width: 160 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Retired'], width: 90 },
      { field: 'molar_mass', title: 'Molar mass (g/mol)', type: 'number', min: 0, width: 120, editable: () => canMolar, help: canMolar ? 'Needs a source; saved with your electronic signature' : 'Maintained by QA and Lab Supervisors' },
      { field: 'molar_mass_source', title: 'Molar mass source', width: 220, editable: () => canMolar, help: 'e.g. IUPAC standard atomic weights 2021, or the supplier certificate' },
    ],
    sign: (rows) => (rows.some((r) => (r.id ? 'molar_mass' in r || 'molar_mass_source' in r : r.molar_mass != null || r.molar_mass_source))
      ? { meaning: 'Changed by', action: `Analyte molar mass: ${rows.length} row(s)` } : null),
    save: (rows, reason, signature) => api('/analytes/bulk', { method: 'POST', body: { rows, reason, signature } }),
    afterSave: () => analytes(main),
  });
}

export async function rush(main, selectedId) {
  const schedules = await api('/rush-schedules');
  const cur = schedules.find((s) => s.id === (selectedId || rush._sel)) || schedules[0];
  rush._sel = cur ? cur.id : null;
  main.innerHTML = pageHeader('Rush fee schedules', 'Named, reusable rush options (for example micro differs from chemistry). Assigned to tests in the test catalogue.',
    '<button class="btn primary" id="newSched">+ New schedule</button>', { kind: 'rush' }) + `
    <div class="tabs">${schedules.map((s) => `<a class="tab ${s.id === rush._sel ? 'on' : ''}" href="#/rush/${s.id}">${esc(s.schedule_name)} <small>${s.test_count} tests</small></a>`).join('')}</div>
    <div class="card">${cur ? section(cur.schedule_name + ' tiers', `${esc(cur.description || '')} The test's standard TAT is the maximum; each tier offers a faster TAT for a surcharge. "Needs approval" is the default for tests using this schedule; each test can override it.`) + '<div id="g"></div>' : 'No schedules yet.'}</div>`;
  main.querySelector('#newSched').onclick = async () => {
    const v = await modal({ title: 'New rush fee schedule', fields: [{ name: 'schedule_name', label: 'Schedule name', required: true }, { name: 'description', label: 'Description' }], okText: 'Create' });
    if (!v) return;
    try { const r = await api('/rush-schedules/bulk', { method: 'POST', body: { rows: [v] } }); rush._sel = r[0].id; rush(main); } catch (e) { toast(e.message, 'err'); }
  };
  if (!cur) return;
  editableGrid({
    el: main.querySelector('#g'), rows: cur.tiers, allowAdd: true, what: `rush tiers on ${cur.schedule_name}`,
    newRow: () => ({ tat_unit: 'Business Days', surcharge_type: 'Percent', requires_approval: false, escalation_hours: 2, status: 'Active', sort_order: cur.tiers.length + 1 }),
    columns: [
      { field: 'sort_order', title: 'Order', type: 'int', width: 60 },
      { field: 'tier_name', title: 'Tier', required: true, width: 170 },
      { field: 'rush_tat', title: 'Rush TAT', type: 'int', min: 0, width: 80 },
      { field: 'tat_unit', title: 'Unit', type: 'select', options: () => state.meta.enums.tat_unit, width: 130 },
      { field: 'surcharge_type', title: 'Surcharge type', type: 'select', options: () => state.meta.enums.surcharge_type, width: 120 },
      { field: 'surcharge_value', title: 'Surcharge', type: 'number', min: 0, width: 90, format: (v, r) => (v === null || v === undefined ? '' : r.surcharge_type === 'Flat' ? money(v) : v + '%') },
      { field: 'requires_approval', title: 'Needs approval', type: 'bool', width: 110 },
      { field: 'escalation_hours', title: 'Escalate after (h)', type: 'number', min: 0.25, width: 120 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90 },
    ],
    save: (rows, reason) => api(`/rush-schedules/${cur.id}/tiers/bulk`, { method: 'POST', body: { rows, reason } }),
    afterSave: () => rush(main),
  });
}

export async function audit(main) {
  const tables = await api('/audit/tables');
  const sel = audit._t || '';
  const rows = await api('/audit?table=' + encodeURIComponent(sel));
  main.innerHTML = pageHeader('Audit trail', 'Written by the database for every create and update. It cannot be edited or deleted, and records cannot be hard-deleted.') + `
    <div class="filters"><label>Record type <select id="t"><option value="">All</option>${tables.map((t) => `<option value="${t.table_name}" ${t.table_name === sel ? 'selected' : ''}>${esc(t.table_name.replace(/_/g, ' '))} (${t.n})</option>`).join('')}</select></label>
    <span class="help">Latest 300 entries</span></div><div id="g"></div>`;
  main.querySelector('#t').onchange = (e) => { audit._t = e.target.value; audit(main); };
  const cols = auditColumns();
  cols.splice(2, 0, { field: 'table_name', title: 'Record type', type: 'readonly', width: 150, format: (v) => v.replace(/_/g, ' ') });
  new Grid(main.querySelector('#g'), { readOnly: true, search: true, rows, columns: cols });
}
