// Workflow Designer (WD-1, migration 012): the tests and workflows list, the Methods (SOP) list, a test's page with its
// versions, and the designer for one version: 1 Test and reporting, 2 Analytes, 3 Workflow (diagram and step editor),
// 4 Review and approve. Drafts change freely; a version becomes Effective only by signed approval from someone who
// did not work on it, once the database finds no problems.
import { api, esc, pageHeader, toast, modal, state, badge, link, signDialog, setDirtyCheck, askReason, confirmBox } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, section } from './common.js';
import { versionCard } from './verification.js';
import { enhanceAll } from '../combo.js';

const css = document.createElement('style');
css.textContent = `
.wdtabs { display: flex; gap: 6px; flex-wrap: wrap; margin: -4px 0 14px; }
.wdtabs a { text-decoration: none; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 6px 12px; border-radius: 7px; font-size: 13.5px; }
.wdtabs a.on { background: var(--green-700); border-color: var(--green-700); color: #fff; }
.wdtabs a small { display: inline-block; margin-left: 4px; padding: 0 6px; border-radius: 8px; background: var(--err); color: var(--err-ink); font-weight: 700; }
.wdtabs a.on small { background: #fff; }
.wdbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; } .wdbar .sp { flex: 1; }
.wdform .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; } .wdform .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 16px; }
.wdform .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0 14px; }
.wdform .field { margin-bottom: 10px; } .wdform .field > label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 2px; }
.wdform input:not([type=checkbox]):not([type=radio]), .wdform select, .wdform textarea { width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.wdform input:disabled, .wdform select:disabled, .wdform textarea:disabled { background: #F4F6F7; color: var(--ink); }
.wdform h3 { font-size: 14px; margin: 14px 0 8px; }
.wdcards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.wdcard { border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; background: #fff; } .wdcard span { display: block; color: var(--muted); font-size: 12.5px; } .wdcard b { font-size: 15px; }
.wdlocked { background: #EEF1F4; border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; color: var(--muted); }
.wddiag { overflow: auto; border: 1px solid var(--line); border-radius: 10px; background: #FBFCFC; max-height: 75vh; }
.wddiag svg { display: block; }
.wddiag .node { cursor: pointer; } .wddiag .node rect { stroke: #AEB7C0; stroke-width: 1; }
.wddiag .node.sel rect { stroke: var(--sel-edge); stroke-width: 3; } .wddiag .node.bad rect { stroke: var(--err-ink); stroke-width: 2; }
.wddiag .node text { font-size: 12px; fill: var(--ink); pointer-events: none; } .wddiag .node text.t { font-size: 10.5px; fill: var(--muted); }
.wddiag path.e { fill: none; stroke: #8A96A3; stroke-width: 1.4; } .wddiag path.e.par { stroke-dasharray: 5 4; stroke: var(--green-700); }
.wdlegend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--muted); margin: 8px 0 0; } .wdlegend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -2px; margin-right: 4px; border: 1px solid #AEB7C0; }
.wdsplit { display: grid; grid-template-columns: 1fr; gap: 16px; }
.wdchecks { display: flex; flex-wrap: wrap; gap: 4px 16px; max-height: 170px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; background: #fff; }
.wdchecks label { display: flex; gap: 6px; align-items: center; font-size: 13px; font-weight: 400; white-space: nowrap; }
.wddep { display: inline-flex; gap: 8px; align-items: center; } .wdpar { color: var(--muted); font-size: 11.5px !important; }
.wdtokens { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; align-items: center; } .wdtokens button { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.wdtokens button.wdtok { font-family: inherit; background: var(--green-50); border-color: #BFE6D6; }
.wdqc { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 8px 0; background: #fff; }
.wdqchead { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; } .wdqchead .btn { margin-left: auto; }
.wdcrit { border-top: 1px dashed var(--line); padding-top: 6px; margin-top: 6px; }
.wdexc { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 2px 0 4px; font-size: 13px; }
.wdexc1 { background: var(--warn); color: var(--warn-ink); border-radius: 10px; padding: 1px 8px; font-size: 12.5px; }
.wdtoggle { font-size: 12.5px; display: inline-block; margin-bottom: 4px; } .wdcritg { margin-top: 4px; }
.wdcritbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 2px; }
.wdcritbar > .combo, .wdcritbar > select { width: 180px !important; min-width: 0; flex: none; }
.wddef { display: inline-flex; gap: 6px; align-items: center; flex-wrap: nowrap; white-space: nowrap; }
.field .wddef input { width: 80px !important; min-width: 0; display: inline-block; flex: none; padding: 4px 6px; }
.field .wddef .combo, .field .wddef select { width: 100px !important; min-width: 0; flex: none; }
.wdqc { padding: 8px 12px !important; margin: 6px 0 !important; } .wdqchead { margin-bottom: 2px !important; }
.wdexcrow { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; } .wdexcrow .wdtoggle { margin: 0; }
.wdmono { font-family: ui-monospace, Menlo, Consolas, monospace; }
.wdprob { list-style: none; padding: 0; margin: 0; } .wdprob li { padding: 7px 10px; border-radius: 6px; margin-bottom: 6px; }
.wdprob li.Error { background: var(--err); color: var(--err-ink); } .wdprob li.Warning { background: var(--warn); color: var(--warn-ink); }
.wdprob li a { font-weight: 600; margin-right: 6px; }
.wdok { background: var(--green-50); color: var(--green-700); border-radius: 8px; padding: 10px 14px; font-weight: 600; }
.wdtry { border: 1px dashed var(--line); border-radius: 8px; padding: 10px 12px; margin-top: 8px; background: #fff; }
.wdtry .grid4 input { font-size: 12.5px; }
@media (max-width: 900px) { .wdcards, .wdform .grid2, .wdform .grid3, .wdform .grid4 { grid-template-columns: 1fr; } }
`;
document.head.appendChild(css);

export const STEP_TYPES = ['Batching', 'Weighing', 'Preparation', 'Plating/Inoculation', 'Incubation', 'Dilution', 'Split off Test', 'Hold Point', 'Calculation', 'Data Entry', 'QC Review'];
const TYPE_COLOR = { Batching: '#E3ECFB', Weighing: '#EAF4EE', Preparation: '#F3EEFA', 'Plating/Inoculation': '#FDEFE3', Incubation: '#FFF6D9', Dilution: '#E6F4F7',
  'Split off Test': '#FCE8EC', 'Hold Point': '#EFEFEF', Calculation: '#E8F0E0', 'Data Entry': '#E2F1FF', 'QC Review': '#DDF3E6' };
const TYPE_HELP = {
  Batching: 'How samples are grouped: the maximum client samples per batch, and the QC each batch carries (with its acceptance criteria). Spiking and materials are added per batch when the work is done.',
  Weighing: 'Each entry is weighed on a balance of this type (the balance actually used is recorded at the bench and must be in calibration). Offers {key.weight} to formulas.',
  Preparation: 'Any preparation (digestion, extraction, titration...). Optional fields are filled once per batch; Number fields can be used in formulas.',
  'Plating/Inoculation': 'Sample onto or into growth media. The media lot is recorded per batch at the bench.',
  Incubation: 'Target temperature and duration with the acceptable window. Time in and out are recorded per load.',
  Dilution: 'Enter what is added (aliquot and diluent), never a factor: the factor is calculated. Offers {key.factor} and {key.final_volume}.',
  'Split off Test': 'Starts another test on the same sample when a finding needs it (e.g. identification when something grows), or when the analyst decides.',
  'Hold Point': 'Waits for a named test on the same sample (e.g. Loss on Drying for a dry-basis result). Offers {key.result}.',
  Calculation: 'A formula from the values of steps before it. One formula for every analyte, with exceptions for some. Offers {key.result}.',
  'Data Entry': 'The reading: entered by hand against the instrument export (attached by default), or a manual observation. Offers {key.reading}.',
  'QC Review': 'Review and approval of the batch (or of a timepoint, on a branch of its own). Reviewers must not have done the work; this is fixed GMP behaviour.',
};
const ROUNDING = ['Significant figures', 'Decimal places'];
const RESULT_TYPES = ['Numeric', 'Qualitative', 'Count', 'Text'];

const d8 = (v) => (v ? String(v).slice(0, 10) : '');
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const sel = (id, options, value, blank = true, dis = false) => `<select id="${id}" ${dis ? 'disabled' : ''}>${blank ? '<option value=""></option>' : ''}${options.map((o) => {
  const v = typeof o === 'object' ? o.value : o; const l = typeof o === 'object' ? o.label : o;
  return `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
const inp = (id, value, type = 'text', attrs = '') => `<input id="${id}" type="${type}" value="${esc(value ?? '')}" ${attrs}>`;
const fld = (label, ctrl, help = '', req = false) => `<div class="field"><label>${esc(label)}${req ? ' <span class="req">*</span>' : ''}</label>${ctrl}${help ? `<div class="help">${help}</div>` : ''}</div>`;
const card = (label, value) => `<div class="wdcard"><span>${esc(label)}</span><b>${value}</b></div>`;
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
// Every creation and change of a test workflow is signed (migration 015): Created by needs no reason, Changed by does.
// fn(reason, signature) runs while the dialog is open, so a wrong password or a refused change keeps it open with the message.
const signed = (what, meaning, fn) => signDialog({ what, meaning, needReason: meaning !== 'Created by', submit: ({ reason, signature }) => fn(reason, signature) });
const stepKey = (name) => { let k = slug(name).slice(0, 30); if (!/^[a-z]/.test(k)) k = 's_' + k; return k.slice(0, 30); };

const LIST_TABS = [['#/methods', 'Tests and workflows'], ['#/methods/sops', 'Methods (SOPs)']];
const listTabs = (cur) => `<div class="wdtabs">${LIST_TABS.map(([h, l]) => `<a href="${h}" class="${h === cur ? 'on' : ''}">${esc(l)}</a>`).join('')}</div>`;

function needLab(main) {
  if (state.site) return true;
  main.innerHTML = '<div class="card err">Choose your lab (top right) first.</div>';
  return false;
}

// ================================================================ TESTS AND WORKFLOWS
const FILTERS = { all: ['All', () => true], effective: ['Effective', (r) => r.effective_version], drafts: ['Drafts', (r) => r.draft_version], lab: ['This lab only', (r) => !!r.site_id] };
export async function list(main) {
  if (!needLab(main)) return;
  const d = await api('/methods/tests');
  const f = FILTERS[state.query.get('show')] ? state.query.get('show') : 'all';
  main.innerHTML = pageHeader('Tests and workflows', 'Test Workflow Designer. Each test belongs to a lab and a department; its scientific content (method, analytes, workflow) is versioned and becomes effective only when approved. Tests made before the designer are shared by all labs.',
    d.can_design ? '<button class="btn primary" id="new">+ New test</button>' : '', { kind: 'methods' })
    + listTabs('#/methods')
    + `<div class="wdbar">${Object.entries(FILTERS).map(([k, [l, fn]]) => `<a class="btn ${k === f ? 'primary' : ''}" href="#/methods?show=${k}">${esc(l)} <small>${d.rows.filter(fn).length}</small></a>`).join('')}</div><div id="g"></div>`;
  new Grid(main.querySelector('#g'), {
    readOnly: true, search: true, filter: state.query.get('find') || '', rows: d.rows.filter(FILTERS[f][1]), emptyText: 'No tests yet.',
    onRowOpen: (r) => { location.hash = '#/methods/tests/' + r.id; },
    columns: [
      { field: 'test_code', title: 'Code', type: 'link', width: 85, href: (r) => '#/methods/tests/' + r.id },
      { field: 'test_name', title: 'Test', type: 'link', width: 300, href: (r) => '#/methods/tests/' + r.id },
      { field: 'site_code', title: 'Lab', type: 'readonly', width: 70, format: (v) => v || 'Shared' },
      { field: 'department_code', title: 'Dept.', type: 'readonly', width: 70 },
      { field: 'method_name', title: 'Method', type: 'readonly', width: 230, format: (v, r) => (v ? `${v}${r.sop_code ? ' (' + r.sop_code + ')' : ''}` : '') },
      { field: 'effective_version', title: 'Effective', type: 'link', width: 80, compute: (r) => (r.effective_version ? 'v' + r.effective_version : ''), href: (r) => (r.effective_version_id ? '#/methods/versions/' + r.effective_version_id : null) },
      { field: 'draft_version', title: 'Draft', type: 'link', width: 70, compute: (r) => (r.draft_version ? 'v' + r.draft_version : ''), href: (r) => (r.draft_version_id ? '#/methods/versions/' + r.draft_version_id : null) },
      { field: 'draft_problems', title: 'To fix', type: 'readonly', width: 70, help: 'Problems the database finds in the draft (it cannot be approved until they are fixed)',
        format: (v, r) => (r.draft_version ? (Number(v) ? String(v) : 'None') : ''), cellClass: (r) => (r.draft_version && Number(r.draft_problems) ? 'flag' : '') },
      { field: 'analyte_count', title: 'Analytes', type: 'readonly', width: 75 },
      { field: 'step_count', title: 'Steps', type: 'readonly', width: 60 },
    ],
  });
  const nb = main.querySelector('#new');
  if (nb) nb.onclick = () => newTest();
  if (state.query.get('new') === '1' && d.can_design) newTest();
}
async function newTest() {
  let opts;
  try { opts = await api('/methods/new-options'); } catch (e) { toast(e.message, 'err'); return; }
  const v = await modal({ title: 'New test', okText: 'Create draft', intro: 'The test belongs to this lab. Version 1 starts as a Draft: add its analytes and workflow, then someone who did not work on it approves it.',
    fields: [
      { name: 'test_name', label: 'Test name (as it appears on the catalogue, quote and Certificate of Analysis)', required: true },
      { name: 'department_id', label: 'Department', type: 'select', options: opts.departments.map((x) => ({ value: x.id, label: `${x.department_code} ${x.department_name}` })) },
      { name: 'method_id', label: 'Method (SOP)', type: 'select', options: opts.methods.map((x) => ({ value: x.id, label: `${x.method_name}${x.sop_code ? ' (' + x.sop_code + ')' : ''}` })), help: 'Add methods on the Methods (SOPs) tab.' },
    ] });
  if (!v) return;
  const t = await signed(`New test: ${v.test_name}`, 'Created by', (reason, signature) => api('/methods/tests', { method: 'POST', body: { row: v, signature } }));
  if (t) { toast('Test created and signed: version 1 is a Draft.'); location.hash = '#/methods/versions/' + t.version_id; }
}

// ================================================================ METHODS (SOPs)
export async function sops(main) {
  if (!needLab(main)) return;
  const d = await api('/methods/sops');
  main.innerHTML = pageHeader('Methods (SOPs)', 'The lab\'s own methods: the method name (it may name a standard, e.g. USP <233>) and the SOP code of the controlled document in the QMS. One method can back several tests. Paste rows from Excel, or fill down with Ctrl+D.', '', { kind: 'sops' })
    + listTabs('#/methods/sops') + (d.can_design ? '' : '<div class="notice">You can view the methods. Changing them needs methods.design in this lab.</div>') + '<div class="card" id="g"></div>';
  editableGrid({
    el: main.querySelector('#g'), rows: d.rows, allowAdd: d.can_design, readOnly: !d.can_design, search: true, filter: state.query.get('find') || '', what: 'methods',
    newRow: () => ({ status: 'Active' }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'method_code', title: 'Code', type: 'readonly', width: 95 },
      { field: 'method_name', title: 'Method name', required: true, width: 330 },
      { field: 'sop_code', title: 'SOP code', width: 140 },
      { field: 'sop_link', title: 'Link to the SOP (QMS)', width: 260 },
      { field: 'description', title: 'Notes', width: 260 },
      { field: 'test_count', title: 'Tests', type: 'readonly', width: 60 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90 },
    ],
    sign: (rows) => ({ meaning: rows.some((r) => r.id) ? 'Changed by' : 'Created by', action: `Methods (SOPs): ${rows.length} row(s)` }),
    save: (rows, reason, signature) => api('/methods/sops', { method: 'POST', body: { rows, reason, signature } }),
    afterSave: () => sops(main),
  });
}

// ================================================================ A TEST AND ITS VERSIONS
export async function testPage(main, id) {
  const d = await api('/methods/tests/' + id);
  const t = d.test;
  const draft = d.versions.find((v) => v.status === 'Draft');
  const eff = d.versions.find((v) => v.status === 'Effective');
  main.innerHTML = pageHeader(t.test_name, `<a href="#/methods/tests/${t.id}">${esc(t.test_code)}</a> ${badge(t.status)} · ${esc(t.site_code || 'Shared by all labs')}${t.department_name ? ' · ' + esc(t.department_name) : ''}${t.copied_from_code ? ` · copied from ${link('#/methods/tests/' + t.copied_from_test_id, t.copied_from_code)}` : ''}`,
    `<a class="btn ghost" href="#/methods">All tests</a> ${t.has_catalog_entry ? `<a class="btn" href="#/catalog/${t.id}">Pricing and turnaround</a>` : ''}
     ${d.can_design ? '<button class="btn" id="dup">Duplicate</button> <button class="btn" id="copy">Copy to another lab</button>' : ''}
     ${draft ? `<a class="btn primary" href="#/methods/versions/${draft.id}">Open draft v${draft.version_no}</a>` : (d.can_design ? '<button class="btn primary" id="newv">New version</button>' : '')}`,
    { kind: 'testdef', id: t.id })
    + `<div class="wdcards">${card('Effective version', eff ? `${link('#/methods/versions/' + eff.id, 'v' + eff.version_no)} since ${esc(d8(eff.effective_from))}` : 'None: cannot be ordered yet')}
      ${card('Draft', draft ? link('#/methods/versions/' + draft.id, 'v' + draft.version_no) : 'None')}
      ${card('Method', esc(t.method_name || '—') + (t.sop_code ? ` <small>${esc(t.sop_code)}</small>` : ''))}
      ${card('Analytes / steps', `${t.analyte_count} / ${t.step_count}`)}</div>
    <div class="card">${section('Versions', 'Every version is kept. Requested tests keep the version that was effective when they were ordered.')}<div id="vg"></div></div>
    ${d.copies.length ? `<div class="card">${section('Copies and duplicates of this test')}${d.copies.map((x) => `${link('#/methods/tests/' + x.id, x.test_code)} ${esc(x.test_name)} (${esc(x.site_code || 'Shared')})`).join('<br>')}</div>` : ''}`;
  new Grid(main.querySelector('#vg'), { readOnly: true, rows: d.versions, columns: [
    { field: 'version_no', title: 'Version', type: 'link', width: 75, compute: (r) => 'v' + r.version_no, href: (r) => '#/methods/versions/' + r.id },
    { field: 'status', title: 'Status', type: 'readonly', width: 100 },
    { field: 'effective_from', title: 'Effective from', type: 'readonly', width: 150, format: dt },
    { field: 'approved_by_name', title: 'Approved by', type: 'readonly', width: 150 },
    { field: 'change_summary', title: 'What changed', type: 'readonly', width: 280 },
    { field: 'method_name', title: 'Method', type: 'readonly', width: 220 },
    { field: 'created_by_name', title: 'Started by', type: 'readonly', width: 140 },
  ] });
  const nv = main.querySelector('#newv');
  if (nv) nv.onclick = async () => {
    const x = await signed(`New version of ${t.test_code} ${t.test_name}`, 'Created by', (reason, signature) => api(`/methods/tests/${t.id}/new-version`, { method: 'POST', body: { signature } }));
    if (x) { toast('New Draft version created and signed, as a copy of the effective one.'); location.hash = '#/methods/versions/' + x.id; }
  };
  const copyTo = async (dup) => {
    const v = await modal({ title: dup ? 'Duplicate as a new test' : 'Copy to another lab', okText: dup ? 'Duplicate' : 'Copy',
      intro: dup ? 'A new test in this lab with the same method, analytes and workflow: a quick template. Its version 1 is a Draft to change and approve.'
        : 'The receiving lab gets its own test with a Draft version 1 to check and approve. Departments are matched by code and equipment types by name; anything that does not match shows as a problem to fix. Prices are copied and can be changed in that lab\'s catalogue.',
      fields: [
        ...(dup ? [] : [{ name: 'site_id', label: 'Lab', type: 'select', required: true, options: d.sites.filter((s) => s.id !== t.site_id).map((s) => ({ value: s.id, label: `${s.site_code} ${s.site_name}` })) }]),
        { name: 'test_name', label: 'Name of the new test', required: true, value: dup ? t.test_name + ' (copy)' : t.test_name },
      ] });
    if (!v) return;
    const x = await signed(`${dup ? 'Duplicate' : 'Copy to another lab'} of ${t.test_code} ${t.test_name}: ${v.test_name}`, 'Created by',
      (reason, signature) => api(`/methods/tests/${t.id}/copy`, { method: 'POST', body: { site_id: dup ? t.site_id : v.site_id, test_name: v.test_name, signature } }));
    if (!x) return;
    toast(`${x.test_code} created with a Draft version 1 (signed).`);
    if (dup || x.site_id === state.site) location.hash = '#/methods/versions/' + x.version_id; else testPage(main, id);
  };
  const db = main.querySelector('#dup'); if (db) db.onclick = () => copyTo(true);
  const cb = main.querySelector('#copy'); if (cb) cb.onclick = () => copyTo(false);
}

// ================================================================ THE DESIGNER (one version)
const TABS = [['test', '1 Test and reporting'], ['analytes', '2 Analytes'], ['workflow', '3 Workflow'], ['review', '4 Review and approve']];
export async function designer(main, vid) {
  const d = await api('/methods/versions/' + vid);
  const v = d.version; const t = d.test;
  const tab = TABS.some(([k]) => k === state.query.get('tab')) ? state.query.get('tab') : 'test';
  const editable = v.status === 'Draft' && d.can_design;
  const errors = d.problems.filter((p) => p.severity === 'Error');
  d.editable = editable;
  main.innerHTML = pageHeader(`${t.test_name}: version ${v.version_no}`,
    `${link('#/methods/tests/' + t.id, t.test_code)} ${badge(v.status)} · ${esc(t.site_code || 'Shared by all labs')}${t.department_name ? ' · ' + esc(t.department_name) : ''}
     · Versions: ${d.versions.map((x) => (x.id === v.id ? `<b>v${x.version_no}</b>` : link('#/methods/versions/' + x.id, 'v' + x.version_no))).join(' ')}`,
    `<a class="btn ghost" href="#/methods/tests/${t.id}">Test page</a>${v.status !== 'Draft' && d.can_design && !t.draft_version ? ' <button class="btn" id="newv">New version</button>' : ''}${t.draft_version_id && t.draft_version_id !== v.id ? ` <a class="btn" href="#/methods/versions/${t.draft_version_id}">Open draft v${t.draft_version}</a>` : ''}`,
    { kind: 'testdef', id: t.id })
    + `<div class="wdtabs">${TABS.map(([k, l]) => `<a href="#/methods/versions/${vid}?tab=${k}" class="${k === tab ? 'on' : ''}">${esc(l)}${k === 'review' && v.status === 'Draft' && errors.length ? ` <small>${errors.length}</small>` : ''}</a>`).join('')}</div>`
    + (v.status === 'Draft' ? (d.can_design ? '' : '<div class="wdlocked">Read only: changing a draft needs methods.design in this lab.</div>')
      : `<div class="wdlocked">Version ${v.version_no} is <b>${esc(v.status)}</b>${v.approved_by_name ? `, approved by ${esc(v.approved_by_name)} on ${esc(dt(v.approved_at))}` : ''}. It cannot be changed${d.can_design ? ': start a new version to make changes' : ''}.</div>`)
    + '<div id="tab"></div>';
  const nv = main.querySelector('#newv');
  if (nv) nv.onclick = async () => {
    const x = await signed(`New version of ${t.test_code} ${t.test_name}`, 'Created by', (reason, signature) => api(`/methods/tests/${t.id}/new-version`, { method: 'POST', body: { signature } }));
    if (x) { toast('New Draft version created and signed.'); location.hash = '#/methods/versions/' + x.id; }
  };
  const host = main.querySelector('#tab');
  const reload = () => designer(main, vid);
  if (tab === 'test') tabTest(host, d, reload);
  else if (tab === 'analytes') tabAnalytes(host, d, reload);
  else if (tab === 'workflow') tabWorkflow(host, d, reload);
  else tabReview(host, d, reload);
}

// ---------------------------------------------------------------- 1 Test and reporting
function tabTest(host, d, reload) {
  const v = d.version; const t = d.test; const L = d.lists; const ed = d.editable; const dis = ed ? '' : 'disabled';
  const e = d.entry;
  host.innerHTML = `<div class="card wdform">${section('Test', 'The report-facing name and the department that does the test (its people do the steps unless a step names another department).')}
      <div class="grid2">${fld('Test name', inp('f_name', t.test_name, 'text', dis), 'As shown on the catalogue, quotes and the Certificate of Analysis', true)}
        ${fld('Department', sel('f_dept', L.departments.map((x) => ({ value: x.id, label: `${x.department_code} ${x.department_name}${x.has_people ? '' : ' (nobody in a group for it yet)'}` })), t.department_id, true, !ed),
          'Departments are kept on Equipment > Equipment types and departments; mark a group as the department on Admin > Groups and permissions.', true)}</div>
    </div>
    <div class="card wdform">${section('Method and procedure (this version)')}
      <div class="grid2">${fld('Method (SOP)', sel('f_method', L.methods.filter((m) => m.status === 'Active' || m.id === v.method_id).map((m) => ({ value: m.id, label: `${m.method_name}${m.sop_code ? ' (' + m.sop_code + ')' : ''}` })), v.method_id, true, !ed),
          '<a href="#/methods/sops">Methods (SOPs)</a>: add or change the lab\'s methods.', true)}
        ${fld('What changed in this version', inp('f_change', v.change_summary, 'text', dis), 'Shown in the version history, e.g. "Hold time added"')}</div>
      ${fld('Procedure summary', `<textarea id="f_proc" rows="3" ${dis}>${esc(v.procedure_text || '')}</textarea>`, 'Shown to the analyst; the SOP stays the controlled document.')}
    </div>
    <div class="card wdform">${section('Reporting', 'How results are rounded and reported below the limits. Each analyte can override the rounding (tab 2).')}
      <div class="grid3">${fld('Rounding', sel('f_rmode', ROUNDING, v.rounding_mode, false, !ed), 'Round half up (away from zero)')}
        ${fld('Digits', inp('f_rdig', v.rounding_digits, 'number', `min="0" max="10" ${dis}`), 'Default: 3 significant figures')}
        ${fld('Below the limits', `<label class="cb"><input type="checkbox" id="f_nd" ${v.nd_below_lod ? 'checked' : ''} ${dis}> Report "ND" below the LOD</label>`, 'Below the LOQ is always reported as "&lt; LOQ" (e.g. &lt; 0.010).')}</div>
      <div class="grid3">${fld('Per serving', `<label class="cb"><input type="checkbox" id="f_serv" ${v.report_per_serving ? 'checked' : ''} ${dis}> Also report the amount per serving</label>`,
        'The COA adds a "Per serving" column: the result times the sample\'s serving size (entered on the order), e.g. 0.4 mg/kg in a 2.5 g serving = 0.001 mg.')}
        ${fld('Report template', sel('f_tpl', (L.report_templates || []).filter((x) => x.status === 'Active' || x.id === v.report_template_id).map((x) => ({ value: x.id, label: `${x.template_name} (${x.template_code})${x.id === L.default_report_template ? ', the lab\'s default' : ''}` })), v.report_template_id || '', true, !ed),
          'The COA layout this test\'s results print in. Blank: the lab\'s default. Tests with different templates on one sample print in separate parts of the same COA. <a href="#/admin/report-templates">Report templates</a>')}</div>
      <div class="help" id="f_example"></div>
    </div>
    <div class="card">${section('Pricing and turnaround', 'Kept in the Test catalogue, outside the validated version: a price change never needs a new version.')}
      ${e ? `<div class="wdcards">${card('List price', esc(Number(e.list_price || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })))}${card('Pricing', esc(e.pricing_mode))}${card('Turnaround', `${e.standard_tat} ${esc(String(e.tat_unit).replace(' Days', ' days').toLowerCase())}`)}${card('Rush schedule', esc(e.rush_schedule || 'None'))}</div>` : '<div class="notice">Not in the catalogue yet.</div>'}
      <a class="btn" href="#/catalog/${t.id}">Open pricing and turnaround</a></div>
    ${ed ? '<div class="wdbar"><span class="sp"></span><button class="btn primary" id="save">Save</button></div>' : ''}`;
  enhanceAll(host);
  const example = () => {
    const mode = host.querySelector('#f_rmode').value; const dig = Number(host.querySelector('#f_rdig').value);
    const r = (x) => (mode === 'Decimal places' ? Number(x).toFixed(dig) : Number(Number(x).toPrecision(Math.max(1, dig))).toString());
    host.querySelector('#f_example').textContent = `Example: 12.3456 is reported as ${r(12.3456)}; 0.0012345 as ${r(0.0012345)}.`;
  };
  host.querySelectorAll('#f_rmode,#f_rdig').forEach((x) => x.addEventListener('change', example)); example();
  const read = () => ({ test: { test_name: host.querySelector('#f_name').value.trim(), department_id: host.querySelector('#f_dept').value || null },
    version: { method_id: host.querySelector('#f_method').value || null, change_summary: host.querySelector('#f_change').value.trim() || null, procedure_text: host.querySelector('#f_proc').value.trim() || null,
      rounding_mode: host.querySelector('#f_rmode').value, rounding_digits: Number(host.querySelector('#f_rdig').value), nd_below_lod: host.querySelector('#f_nd').checked,
      report_per_serving: host.querySelector('#f_serv').checked, report_template_id: host.querySelector('#f_tpl').value || null } });
  const orig = JSON.stringify(read());
  setDirtyCheck(() => ed && JSON.stringify(read()) !== orig);
  const sv = host.querySelector('#save');
  if (sv) sv.onclick = async () => {
    const now = read(); const o = JSON.parse(orig);
    const body = { test: {}, version: {} };
    for (const k of Object.keys(now.test)) if (JSON.stringify(now.test[k]) !== JSON.stringify(o.test[k])) body.test[k] = now.test[k];
    for (const k of Object.keys(now.version)) if (JSON.stringify(now.version[k]) !== JSON.stringify(o.version[k])) body.version[k] = now.version[k];
    if (!Object.keys(body.test).length && !Object.keys(body.version).length) { toast('Nothing changed.'); return; }
    const ok = await signed(`Test and reporting: ${d.test.test_code} ${d.test.test_name}, version ${v.version_no}`, 'Changed by',
      (reason, signature) => api(`/methods/versions/${v.id}/header`, { method: 'PUT', body: { ...body, reason, signature } }));
    if (ok) { setDirtyCheck(null); toast('Saved and signed.'); reload(); }
  };
}

// ---------------------------------------------------------------- 2 Analytes
function tabAnalytes(host, d, reload) {
  const L = d.lists; const ed = d.editable;
  host.innerHTML = `<div class="card">${section('Analytes', 'What the test reports. Type to pick an analyte, paste rows from Excel, fill down with Ctrl+D. The suggested limit is offered when a client or quote has none; it is never applied by itself (no limit = unspecified).')}<div id="ag"></div></div>`;
  const aOpts = L.analytes.map((a) => ({ value: a.id, label: a.analyte_name, match: [a.analyte_code] }));
  editableGrid({
    el: host.querySelector('#ag'), rows: d.analytes, allowAdd: ed, readOnly: !ed, what: 'analytes',
    sign: (rows) => ({ meaning: rows.some((r) => r.id) ? 'Changed by' : 'Created by', action: `Analytes: ${d.test.test_code} ${d.test.test_name}, version ${d.version.version_no}` }),
    newRow: () => ({ result_type: 'Numeric', status: 'Active', sort_order: d.analytes.length + 1, result_values: ['Absent', 'Present'], found_values: ['Present'] }),
    columns: [
      { field: 'sort_order', title: '#', type: 'int', width: 45 },
      { field: 'analyte_id', title: 'Analyte', type: 'select', width: 230, required: true, options: aOpts, editable: (r, isNew) => isNew, format: (v, r) => r.analyte_name || (aOpts.find((o) => o.value === v)?.label ?? '') },
      { field: 'result_type', title: 'Result', type: 'select', options: RESULT_TYPES, width: 105, help: 'Numeric, Qualitative (Absent/Present), Count, or Text (e.g. an identification)' },
      { field: 'reporting_unit', title: 'Unit', type: 'select', options: L.units, width: 90, help: 'Reporting unit, from Admin > Units. Numeric and Count results need one.' },
      { field: 'loq', title: 'LOQ', type: 'number', width: 80 },
      { field: 'hide_loq', title: 'Hide LOQ', type: 'bool', width: 70, editable: (r) => !r.hide_on_report, help: 'The LOQ is not printed on the report (the "< LOQ" result still is)' },
      { field: 'lod', title: 'LOD', type: 'number', width: 80 },
      { field: 'hide_lod', title: 'Hide LOD', type: 'bool', width: 70, editable: (r) => !r.hide_on_report, help: 'The LOD is not printed on the report' },
      { field: 'uncertainty', title: 'Uncertainty ±', type: 'number', width: 95, help: 'Measurement uncertainty: a value in the result\'s unit, or a % of the result (next column)' },
      { field: 'uncertainty_kind', title: '± as', type: 'select', options: [{ value: 'Unit', label: 'unit' }, { value: '%', label: '% of result' }], width: 90 },
      { field: 'report_uncertainty', title: 'Report ±', type: 'bool', width: 70, help: 'Print it on the COA beside the result (e.g. 0.52 ± 0.04 mg/kg). Untick to keep it on file only.' },
      { field: 'rounding_mode', title: 'Own rounding', type: 'select', options: ['', ...ROUNDING], width: 150, help: 'Leave empty to use the version\'s rounding (tab 1)' },
      { field: 'rounding_digits', title: 'Digits', type: 'int', min: 0, max: 10, width: 60 },
      { field: 'result_values', title: 'Result values', type: 'array', width: 170, format: (v) => (Array.isArray(v) ? v.join(', ') : v ?? ''),
        help: 'Qualitative results only: the values the analyst can enter, in order, separated by commas (e.g. ND, ND*, D*, D). Default Absent, Present.' },
      { field: 'found_values', title: 'Means found', type: 'array', width: 110, format: (v) => (Array.isArray(v) ? v.join(', ') : v ?? ''),
        help: 'Which of the result values mean something was found (e.g. D*, D). A split-off on a finding reacts to these.' },
      { field: 'invalid_values', title: 'Not a result', type: 'array', width: 150, format: (v) => (Array.isArray(v) ? v.join(', ') : v ?? ''),
        help: 'Result values that are not results (e.g. Indeterminate, Signal error). They can never be reported: the sample, or control, is read again in a new analytical run before the batch can be approved.' },
      { field: 'hide_on_report', title: 'Hide analyte', type: 'bool', width: 75, help: 'Still analysed and kept, just not on the report (e.g. a 100-analyte method reporting 5 for one client). Its own LOQ / LOD boxes then do not apply.' },
      { field: 'default_spec_min', title: 'Suggested min', type: 'number', width: 100 },
      { field: 'default_spec_max', title: 'Suggested max', type: 'number', width: 100 },
      { field: 'default_spec_text', title: 'Suggested text limit', width: 200 },
      { field: 'status', title: 'On test', type: 'select', options: ['Active', 'Inactive'], width: 80, help: 'Set Inactive to remove the analyte from this draft' },
    ],
    save: (rows, reason, signature) => api(`/methods/versions/${d.version.id}/analytes`, { method: 'POST', body: { rows, reason, signature } }),
    afterSave: reload,
  });
}

// ---------------------------------------------------------------- 3 Workflow: diagram and step editor
function layout(steps, deps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const parents = new Map(steps.map((s) => [s.id, []]));
  deps.forEach((x) => { if (parents.has(x.step_id) && byId.has(x.depends_on_step_id)) parents.get(x.step_id).push(x.depends_on_step_id); });
  const layer = new Map(); const visiting = new Set();
  const depth = (id) => {
    if (layer.has(id)) return layer.get(id); if (visiting.has(id)) return 0; visiting.add(id);
    const p = parents.get(id) || []; const l = p.length ? Math.max(...p.map(depth)) + 1 : 0; layer.set(id, l); return l;
  };
  steps.forEach((s) => depth(s.id));
  const layers = []; steps.forEach((s) => { const l = layer.get(s.id); (layers[l] = layers[l] || []).push(s); });
  // top to bottom: one row per layer, a layer's steps side by side (ordered under their parents), rows centred
  const pos = new Map(); const W = 180; const H = 50; const GX = 22; const GY = 34;
  const maxN = Math.max(1, ...layers.map((l) => (l ? l.length : 0)));
  const width = 32 + maxN * (W + GX); const height = 32 + layers.length * (H + GY);
  layers.forEach((ls, li) => {
    if (li > 0) ls.sort((a, b) => avgX(a) - avgX(b) || a.sort_order - b.sort_order); else ls.sort((a, b) => a.sort_order - b.sort_order);
    const off = (width - ls.length * (W + GX) + GX) / 2;
    ls.forEach((s, i) => pos.set(s.id, { x: off + i * (W + GX), y: 16 + li * (H + GY) }));
  });
  function avgX(s) { const p = parents.get(s.id) || []; return p.length ? p.reduce((a, id) => a + (pos.get(id)?.x || 0), 0) / p.length : 0; }
  return { pos, W, H, width, height };
}
function diagramSvg(d, selId, badKeys) {
  const { pos, W, H, width, height } = layout(d.steps, d.deps);
  const edges = d.deps.map((x) => {
    const a = pos.get(x.depends_on_step_id); const b = pos.get(x.step_id); if (!a || !b) return '';
    const x1 = a.x + W / 2; const y1 = a.y + H; const x2 = b.x + W / 2; const y2 = b.y; const my = (y1 + y2) / 2;
    return `<path class="e ${x.dependency_type === 'Parallel' ? 'par' : ''}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2 - 5}" marker-end="url(#arr${x.dependency_type === 'Parallel' ? 'p' : ''})"/>`;
  }).join('');
  const nodes = d.steps.map((s) => {
    const p = pos.get(s.id); const nm = s.step_name.length > 25 ? s.step_name.slice(0, 24) + '…' : s.step_name;
    return `<g class="node ${s.id === selId ? 'sel' : ''} ${badKeys.has(s.step_key) ? 'bad' : ''}" data-step="${s.id}" transform="translate(${p.x},${p.y})" tabindex="0" role="button" aria-label="${esc(s.step_name)}">
      <rect width="${W}" height="${H}" rx="8" fill="${TYPE_COLOR[s.step_type] || '#fff'}"/><text x="10" y="21">${esc(nm)}</text><text class="t" x="10" y="39">${esc(s.step_type)} · ${esc(s.step_key)}</text></g>`;
  }).join('');
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Workflow diagram">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#8A96A3"/></marker>
    <marker id="arrp" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#006241"/></marker></defs>${edges}${nodes}</svg>`;
}
function ancestorsOf(d, id) {
  const out = new Set(); const stack = [id];
  while (stack.length) { const c = stack.pop(); d.deps.filter((x) => x.step_id === c).forEach((x) => { if (!out.has(x.depends_on_step_id)) { out.add(x.depends_on_step_id); stack.push(x.depends_on_step_id); } }); }
  return out;
}
function tabWorkflow(host, d, reload) {
  const ed = d.editable;
  const badKeys = new Set(d.problems.filter((p) => p.severity === 'Error' && p.step_key).map((p) => p.step_key));
  let selId = state.query.get('step') || null;
  host.innerHTML = `<div class="card">${section('Workflow', 'Steps run top to bottom; a step starts when the steps before it are done. Branches run in parallel (dashed green: a branch that never holds up the rest, e.g. a timepoint\'s QC Review). Every branch ends in a QC Review. Click a step to see or change it.',
      ed ? '<button class="btn primary" id="add">+ Add step</button>' : '')}
      <div class="wddiag" id="diag"></div>
      <div class="wdlegend">${STEP_TYPES.map((x) => `<span><i style="background:${TYPE_COLOR[x]}"></i>${esc(x)}</span>`).join('')}<span><i style="border-color:var(--err-ink)"></i>Has a problem to fix</span></div></div>
    <div id="editor"></div>
    <div class="card">${section('Steps', 'The same steps as a list (copy to Excel with Ctrl+C).')}<div id="sg"></div></div>`;
  const draw = () => {
    host.querySelector('#diag').innerHTML = d.steps.length ? diagramSvg(d, selId, badKeys) : '<div class="help" style="padding:20px">No steps yet.' + (ed ? ' Add the first one (usually Batching).' : '') + '</div>';
    host.querySelectorAll('#diag .node').forEach((n) => {
      const open = () => { selId = n.dataset.step; draw(); stepEditor(host.querySelector('#editor'), d, d.steps.find((s) => s.id === selId), reload); };
      n.addEventListener('click', open); n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
  };
  draw();
  const name = (id) => d.steps.find((s) => s.id === id)?.step_name || '';
  new Grid(host.querySelector('#sg'), { readOnly: true, rows: d.steps.map((s) => ({ ...s, after: d.deps.filter((x) => x.step_id === s.id).map((x) => name(x.depends_on_step_id) + (x.dependency_type === 'Parallel' ? ' (parallel)' : '')).join(', '),
    equipment: d.equipment.filter((e) => e.step_id === s.id).map((e) => e.type_name + (e.is_main ? ' (main)' : '')).join(', '),
    dept: s.department_code || '(test\'s)', tokens_text: (s.tokens || []).map((x) => `{${s.step_key}.${x}}`).join(' ') })),
    onRowOpen: (r) => { selId = r.id; draw(); stepEditor(host.querySelector('#editor'), d, d.steps.find((s) => s.id === selId), reload); host.querySelector('#editor').scrollIntoView({ behavior: 'smooth' }); },
    columns: [
      { field: 'step_name', title: 'Step', type: 'readonly', width: 200 }, { field: 'step_type', title: 'Type', type: 'readonly', width: 140 },
      { field: 'step_key', title: 'Key', type: 'readonly', width: 90 }, { field: 'after', title: 'Comes after', type: 'readonly', width: 230 },
      { field: 'dept', title: 'Dept.', type: 'readonly', width: 70 }, { field: 'equipment', title: 'Equipment types', type: 'readonly', width: 200 },
      { field: 'tokens_text', title: 'Offers to formulas', type: 'readonly', width: 240 } ] });
  const add = host.querySelector('#add');
  if (add) add.onclick = () => { const after = selId; selId = null; draw(); stepEditor(host.querySelector('#editor'), d, null, reload, after); host.querySelector('#editor').scrollIntoView({ behavior: 'smooth' }); };
  if (selId && d.steps.some((s) => s.id === selId)) stepEditor(host.querySelector('#editor'), d, d.steps.find((s) => s.id === selId), reload);
}

// The step editor: common fields, then the settings of its type
function stepEditor(el, d, step, reload, afterId = null) {
  const ed = d.editable; const L = d.lists; const dis = ed ? '' : 'disabled';
  const s = step || { step_type: 'Preparation', config: {}, step_name: '', step_key: '' };
  const cfg = JSON.parse(JSON.stringify(s.config || {}));
  const others = d.steps.filter((x) => !step || x.id !== step.id);
  const myDeps = step ? d.deps.filter((x) => x.step_id === step.id) : (afterId ? [{ depends_on_step_id: afterId, dependency_type: 'Sequential' }] : []);
  const myEq = step ? d.equipment.filter((e) => e.step_id === step.id) : [];
  const anc = step ? ancestorsOf(d, step.id) : new Set();
  const testDept = L.departments.find((x) => x.id === d.test.department_id);
  el.innerHTML = `<div class="card wdform" id="se">
    ${section(step ? `Step: ${s.step_name}` : 'New step', esc(TYPE_HELP[s.step_type] || ''))}
    <div class="grid4">${fld('Type', sel('s_type', STEP_TYPES, s.step_type, false, !ed), '', true)}
      ${fld('Name', inp('s_name', s.step_name, 'text', dis), 'e.g. Microwave digestion', true)}
      ${fld('Key', inp('s_key', s.step_key, 'text', `${dis} class="wdmono" maxlength="30"`), 'Short lower-case word used in formulas', true)}
      ${fld('Done by', sel('s_dept', [{ value: '', label: `The test's department${testDept ? ' (' + testDept.department_code + ')' : ''}` }, ...L.departments.map((x) => ({ value: x.id, label: `${x.department_code} ${x.department_name}` }))], s.department_id || '', false, !ed))}</div>
    <div class="grid2">
      ${fld('Comes after', `<div class="wdchecks" id="s_deps">${others.length ? others.map((o) => { const dp = myDeps.find((x) => x.depends_on_step_id === o.id);
        return `<span class="wddep"><label><input type="checkbox" data-dep="${o.id}" ${dp ? 'checked' : ''} ${dis}> ${esc(o.step_name)}</label><label class="wdpar" title="A parallel branch never holds up the rest"><input type="checkbox" data-par="${o.id}" ${dp && dp.dependency_type === 'Parallel' ? 'checked' : ''} ${dis}> parallel</label></span>`; }).join('') : '<span class="help">This is the first step.</span>'}</div>`,
        'Tick the step(s) this one follows. Tick parallel for a branch that never holds up the rest (e.g. a timepoint\'s QC Review).')}
      ${fld('Equipment types', `<div class="wdchecks" id="s_eq">${L.types.map((tp) => { const e = myEq.find((x) => x.equipment_type_id === tp.id);
        return `<label><input type="checkbox" data-eq="${tp.id}" ${e ? 'checked' : ''} ${dis}> ${esc(tp.type_name)} <input type="radio" name="s_main" data-main="${tp.id}" ${e && e.is_main ? 'checked' : ''} ${dis} title="Main instrument"> <small>main</small></label>`; }).join('')}</div>`,
        'Weighing, Incubation and Data Entry (with an attached export) need one; mark the main instrument, the others are alternatives. The actual unit is chosen at the bench and must be in calibration.')}
    </div>
    <div class="grid4">${fld('Witness', sel('s_wit', [{ value: 'None', label: 'None' }, { value: 'Optional', label: 'Optional (the analyst may ask for one)' }, { value: 'Required', label: 'Required' }], cfg.witness || 'None', false, !ed),
      'A witness signs with the analyst when the step is completed: another person who does bench work in this lab')}</div>
    ${fld('Instructions for the analyst', `<textarea id="s_instr" rows="2" ${dis}>${esc(s.instructions || '')}</textarea>`)}
    <h3>${esc(s.step_type)} settings</h3><div id="s_cfg"></div>
    <div class="merr" id="s_err"></div>
    ${ed ? `<div class="wdbar"><button class="btn ghost" id="s_cancel">Close</button>${step ? '<button class="btn" id="s_remove">Remove step</button>' : ''}<span class="sp"></span><button class="btn primary" id="s_save">${step ? 'Save step' : 'Add step'}</button></div>` : ''}
  </div>`;
  enhanceAll(el.querySelector('.grid4'));
  const typeSel = el.querySelector('#s_type');
  if (!step) {
    const nm = el.querySelector('#s_name'); const ky = el.querySelector('#s_key'); let touched = false;
    ky.addEventListener('input', () => { touched = true; });
    nm.addEventListener('input', () => { if (!touched) ky.value = stepKey(nm.value); });
  }
  let cfgUi = renderConfig(el.querySelector('#s_cfg'), typeSel.value, cfg, d, step, anc, ed);
  typeSel.addEventListener('change', () => { el.querySelector('h3').textContent = typeSel.value + ' settings'; cfgUi = renderConfig(el.querySelector('#s_cfg'), typeSel.value, {}, d, step, anc, ed); });
  const err = (m) => { el.querySelector('#s_err').textContent = m || ''; };
  const close = el.querySelector('#s_cancel'); if (close) close.onclick = () => { el.innerHTML = ''; };
  const rm = el.querySelector('#s_remove');
  if (rm) rm.onclick = async () => {
    if (!(await confirmBox('Remove step', `Remove "${esc(s.step_name)}" from this draft? Its connections go too; steps after it will need reconnecting.`, 'Remove'))) return;
    const ok = await signed(`Remove step "${s.step_name}" from ${d.test.test_code}, version ${d.version.version_no}`, 'Changed by',
      (reason, signature) => api(`/methods/versions/${d.version.id}/steps/${step.id}/remove`, { method: 'POST', body: { reason, signature } }));
    if (ok) { toast('Step removed (signed).'); reload(); }
  };
  const sv = el.querySelector('#s_save');
  if (sv) sv.onclick = async () => {
    let config;
    try { config = cfgUi.read(); } catch (e) { err(e.message); return; }
    const wit = el.querySelector('#s_wit').value; if (wit && wit !== 'None') config.witness = wit; else delete config.witness; // WD-2: a witness per step
    const deps = [...el.querySelectorAll('[data-dep]')].filter((c) => c.checked).map((c) => ({ depends_on_step_id: c.dataset.dep, dependency_type: el.querySelector(`[data-par="${c.dataset.dep}"]`).checked ? 'Parallel' : 'Sequential' }));
    const mainId = el.querySelector('[data-main]:checked')?.dataset.main;
    const eqs = [...el.querySelectorAll('[data-eq]')].filter((c) => c.checked).map((c) => c.dataset.eq);
    const equipment = eqs.map((id, i) => ({ equipment_type_id: id, is_main: mainId ? id === mainId : i === 0 && eqs.length === 1 }));
    const body = { step: { id: step?.id, step_type: typeSel.value, step_name: el.querySelector('#s_name').value.trim(), step_key: el.querySelector('#s_key').value.trim(),
      department_id: el.querySelector('#s_dept').value || null, instructions: el.querySelector('#s_instr').value.trim() || null, config }, deps, equipment };
    if (!body.step.step_name) { err('Name the step.'); return; }
    const x = await signed(`${step ? 'Change step' : 'Add step'} "${body.step.step_name}": ${d.test.test_code}, version ${d.version.version_no}`, step ? 'Changed by' : 'Created by',
      (reason, signature) => api(`/methods/versions/${d.version.id}/steps`, { method: 'POST', body: { ...body, reason, signature } }));
    if (!x) return;
    toast(step ? 'Step saved and signed.' : 'Step added and signed.');
    history.replaceState(null, '', `#/methods/versions/${d.version.id}?tab=workflow&step=${x.id}`); state.query = new URLSearchParams(`tab=workflow&step=${x.id}`); reload();
  };
}

// Type-specific settings: returns { read() } giving the config object
function renderConfig(el, type, cfg, d, step, anc, ed) {
  const dis = ed ? '' : 'disabled';
  const tvAnalytes = d.analytes.map((a) => ({ value: a.analyte_id, label: a.analyte_name }));
  const n = (id) => { const v = el.querySelector('#' + id)?.value; return v === '' || v === undefined ? null : Number(v); };
  const tx = (id) => { const v = el.querySelector('#' + id)?.value?.trim(); return v ? v : null; };
  const grids = [];
  const mkGrid = (host, rows, columns, newRow = () => ({})) => { const g = new Grid(el.querySelector(host), { rows, columns, allowAdd: ed, readOnly: !ed, newRow }); grids.push(g); return g; };
  const val = (g) => g.rows.filter((r) => Object.values(r).some((x) => x !== null && x !== undefined && x !== ''));
  if (type === 'Batching') {
    // WD-1.2 (Alex, 2026-10-13): the QC types in one grid; under it, each QC type's acceptance criteria, each with a row per
    // analyte of the test: whether this QC judges the analyte, and its own limit (prefilled from the criterion's default).
    const shapeOf = (name) => d.lists.limitTypes.find((x) => x.limit_type === name)?.shape || 'Range';
    const qcRows = (cfg.qc || []).map((q) => ({ qc_type: q.qc_type, qc_class: q.qc_class, frequency: q.frequency, material: q.material || null, count: q.count ?? null, every_n: q.every_n ?? null }));
    // rows for every analyte of the test: its own row if set, else an exception (earlier layout), else the default
    const rowsFor = (c) => d.analytes.map((a) => {
      const own = (c.analytes || []).find((x) => x.analyte_id === a.analyte_id);
      const ov = own ? null : (c.overrides || []).find((x) => x.analyte_id === a.analyte_id);
      const from = own || ov || c;
      return { analyte_id: a.analyte_id, analyte_name: a.analyte_name, applies: own ? own.applies !== false : true,
        min: from.min ?? null, max: from.max ?? null, limit_ref: (own ? own.limit_ref : c.limit_ref) || null };
    });
    const model = {}; // qc_type -> [{ limit_type, min, max, limit_ref, rows, grid }]
    (cfg.qc || []).forEach((q) => { model[q.qc_type] = (q.criteria || []).map((c) => ({ limit_type: c.limit_type, min: c.min ?? null, max: c.max ?? null, limit_ref: c.limit_ref || null, rows: rowsFor(c) })); });
    el.innerHTML = `<div class="grid4">${fld('Maximum client samples per batch', inp('c_max', cfg.max_samples, 'number', `min="1" ${dis}`), 'QC samples ride on top of this number')}</div>
      ${fld('QC each batch carries', '<div id="c_qc"></div>', 'One row per QC type. Prep QC travels through preparation like a sample; Analytical QC is instrument-only. Every N samples gives opening and closing (bracketing) entries; Daily is one set per method per day, shared by the day\'s batches.')}
      <div class="field"><label>Acceptance criteria</label><div class="help">Each criterion's default applies to every analyte. Analytes with their own limit, or that this QC does not judge, are listed as exceptions under it. "Show all analytes" opens the full list to change them (untick Applies to leave one out; fill down and paste from Excel work there).</div>
        <div id="c_crit"></div></div>`;
    const qcG = mkGrid('#c_qc', qcRows, [
      { field: 'qc_type', title: 'QC type', type: 'select', options: d.lists.qcTypes.map((x) => x.qc_type), width: 210, required: true },
      { field: 'qc_class', title: 'Class', type: 'select', options: ['Prep', 'Analytical'], width: 95 },
      { field: 'frequency', title: 'How often', type: 'select', options: [{ value: 'Once', label: 'Once' }, { value: 'Every N', label: 'Every N' }, { value: 'Daily', label: 'Daily' }], width: 95,
        help: 'Once (per batch), Every N samples (bracketing), or Daily: one set per method per day, shared by that day\'s batches (micro controls)' },
      { field: 'material', title: 'Made from', type: 'select', options: [{ value: '', label: '' }, { value: 'Strains', label: 'Strains of the test\'s organisms' }], width: 200,
        help: 'Strains: the control must be made from Microbiological Strain lots of this test\'s organisms; the bench refuses anything else' },
      { field: 'count', title: 'Per batch', type: 'int', min: 1, width: 80 }, { field: 'every_n', title: 'Every N', type: 'int', min: 1, width: 75 },
    ], () => ({ frequency: 'Once', count: 1 }));
    const host = el.querySelector('#c_crit');
    const qcTypesNow = () => [...new Set(val(qcG).map((r) => r.qc_type).filter(Boolean))];
    const syncFromGrids = () => Object.values(model).forEach((list) => list.forEach((c) => { if (c.grid) c.rows = c.grid.rows.map((r) => ({ ...r })); }));
    const limitText = (c) => { const sh = shapeOf(c.limit_type); return sh === 'Qualitative' ? '' : sh === 'Max' ? (c.limit_ref ? `≤ ${c.limit_ref}` : c.max !== null ? `≤ ${c.max}` : '') : (c.min !== null || c.max !== null ? `${c.min ?? '?'} to ${c.max ?? '?'}` : ''); };
    // the per-analyte table is folded away (Alex: the page got too long); a summary lists the exceptions to the default
    const open = new Set(); // criteria whose analyte table is shown: "qc type|index"
    const sameAsDefault = (r, c) => (r.min ?? null) === (c.min ?? null) && (r.max ?? null) === (c.max ?? null) && (r.limit_ref || null) === (c.limit_ref || null);
    const exceptions = (c) => {
      const rows = c.grid ? c.grid.rows : c.rows; const sh = shapeOf(c.limit_type);
      const ex = rows.filter((r) => r.applies === false || (sh !== 'Qualitative' && !sameAsDefault(r, c)))
        .map((r) => `<span class="wdexc1">${esc(r.analyte_name)}: ${r.applies === false ? 'not judged' : esc(limitText({ ...r, limit_type: c.limit_type }) || 'no limit')}</span>`);
      return ex.length ? `<span class="help">Exceptions:</span> ${ex.join('')}` : `<span class="help">${rows.length ? `All ${rows.length} analytes ${sh === 'Qualitative' ? 'are judged' : 'use the default'}.` : 'Add the analytes on tab 2 first.'}</span>`;
    };
    const render = () => {
      syncFromGrids();
      const types = qcTypesNow();
      grids.splice(1).forEach((g) => g.destroy()); // keep the QC types grid; the criteria grids are rebuilt
      host.innerHTML = types.length ? types.map((qt, qi) => `<div class="wdqc" data-qi="${qi}"><div class="wdqchead"><b>${esc(qt)}</b> <span class="help">${esc(val(qcG).find((r) => r.qc_type === qt)?.qc_class || '')} QC</span>
          ${ed ? `<button class="btn mini" data-addc="${qi}">+ Criterion</button>` : ''}</div>
          ${(model[qt] || []).length ? (model[qt] || []).map((c, ci) => `<div class="wdcrit" data-ci="${ci}">
            <div class="wdcritbar">${sel(`k_lt_${qi}_${ci}`, d.lists.limitTypes.map((x) => x.limit_type), c.limit_type, true, !ed)}
              <span class="wddef">${shapeOf(c.limit_type) === 'Qualitative' ? '<span class="help">No numbers: tick the analytes it applies to.</span>'
                : `<span class="help">Default</span> ${shapeOf(c.limit_type) === 'Range' ? `${inp(`k_min_${qi}_${ci}`, c.min, 'number', `step="any" placeholder="min" ${dis}`)} to ` : 'max '}${inp(`k_max_${qi}_${ci}`, c.max, 'number', `step="any" placeholder="max" ${dis}`)}
                  ${shapeOf(c.limit_type) === 'Max' ? `or ${sel(`k_ref_${qi}_${ci}`, ['LOQ', '½ LOQ', 'LOD'], c.limit_ref, true, !ed)}` : ''}
                  ${ed ? `<button class="btn mini" data-fill="${qi}_${ci}" title="Set every analyte to the default">Fill all</button>` : ''}`}</span>
              ${ed ? `<button class="btn mini ghost" data-rmc="${qi}_${ci}">Remove</button>` : ''}</div>
            <div class="wdexcrow"><div class="wdexc" id="kx_${qi}_${ci}"></div>
            <a href="#" class="wdtoggle" data-tg="${qi}_${ci}">${open.has(`${qt}|${ci}`) ? 'Hide the analytes ▴' : `Show all ${d.analytes.length} analytes ▾`}</a></div>
            <div class="wdcritg" id="kg_${qi}_${ci}" ${open.has(`${qt}|${ci}`) ? '' : 'style="display:none"'}></div></div>`).join('') : '<div class="help">No acceptance criterion yet.</div>'}</div>`).join('')
        : '<div class="help">Add a QC type above to set its acceptance criteria.</div>';
      enhanceAll(host);
      types.forEach((qt, qi) => (model[qt] || []).forEach((c, ci) => {
        const sh = shapeOf(c.limit_type);
        c.rows = d.analytes.map((a) => c.rows.find((r) => r.analyte_id === a.analyte_id) || { analyte_id: a.analyte_id, analyte_name: a.analyte_name, applies: true, min: c.min, max: c.max, limit_ref: c.limit_ref });
        const cols = [{ field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 210 }, { field: 'applies', title: 'Applies', type: 'bool', width: 75, help: 'Untick where this QC does not judge the analyte' }];
        if (sh === 'Range') cols.push({ field: 'min', title: 'Min', type: 'number', width: 90 }, { field: 'max', title: 'Max', type: 'number', width: 90 });
        if (sh === 'Max') cols.push({ field: 'max', title: 'Max', type: 'number', width: 90 }, { field: 'limit_ref', title: 'Or limit', type: 'select', options: ['', 'LOQ', '½ LOQ', 'LOD'], width: 90, help: 'A limit of the analyte instead of a number' });
        cols.push({ field: 'shown', title: 'Limit', type: 'readonly', width: 120, compute: (r) => (!r.applies ? 'Not judged' : sh === 'Qualitative' ? c.limit_type : limitText({ ...r, limit_type: c.limit_type })) });
        const summary = () => { host.querySelector(`#kx_${qi}_${ci}`).innerHTML = exceptions(c); };
        c.grid = new Grid(host.querySelector(`#kg_${qi}_${ci}`), { rows: c.rows, columns: cols, readOnly: !ed, keyField: 'analyte_id', emptyText: 'Add the analytes on tab 2 first.', onChange: summary });
        grids.push(c.grid); summary();
        c.summary = summary;
        const q = (k) => host.querySelector(`#k_${k}_${qi}_${ci}`);
        const num = (x) => (x && x.value !== '' ? Number(x.value) : null);
        q('lt')?.addEventListener('change', () => { syncFromGrids(); c.limit_type = q('lt').value || null; render(); });
        // changing the default moves every analyte still on the old default; analytes with their own limit keep it
        const onDefault = () => {
          const old = { min: c.min, max: c.max, limit_ref: c.limit_ref };
          c.min = num(q('min')); c.max = num(q('max')); c.limit_ref = q('ref')?.value || null;
          c.grid.rows.forEach((r) => { if ((r.min ?? null) === old.min && (r.max ?? null) === old.max && (r.limit_ref || null) === old.limit_ref) { r.min = c.min; r.max = c.max; r.limit_ref = c.limit_ref; } });
          c.grid.render(); summary();
        };
        ['min', 'max', 'ref'].forEach((k) => q(k)?.addEventListener('change', onDefault));
      }));
      host.querySelectorAll('[data-addc]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); syncFromGrids(); const qt = types[Number(b.dataset.addc)];
        (model[qt] = model[qt] || []).push({ limit_type: null, min: null, max: null, limit_ref: null, rows: [] }); render(); }; });
      host.querySelectorAll('[data-rmc]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); syncFromGrids(); const [qi, ci] = b.dataset.rmc.split('_').map(Number); model[types[qi]].splice(ci, 1); render(); }; });
      host.querySelectorAll('[data-fill]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); const [qi, ci] = b.dataset.fill.split('_').map(Number); const c = model[types[qi]][ci];
        c.grid.rows.forEach((r) => { r.min = c.min; r.max = c.max; r.limit_ref = c.limit_ref; }); c.grid.render(); c.summary(); }; });
      host.querySelectorAll('[data-tg]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); const [qi, ci] = a.dataset.tg.split('_').map(Number); const key = `${types[qi]}|${ci}`;
        const g = host.querySelector(`#kg_${qi}_${ci}`); const show = g.style.display === 'none';
        g.style.display = show ? '' : 'none'; if (show) open.add(key); else open.delete(key);
        a.textContent = show ? 'Hide the analytes ▴' : `Show all ${d.analytes.length} analytes ▾`; }; });
    };
    let lastTypes = qcTypesNow().join('|');
    qcG.o.onChange = (g) => {
      g.rows.forEach((r) => { if (r.qc_type && !r.qc_class) r.qc_class = d.lists.qcTypes.find((x) => x.qc_type === r.qc_type)?.default_class || null; });
      const now = qcTypesNow().join('|'); if (now !== lastTypes) { lastTypes = now; render(); }
    };
    render();
    return { read: () => {
      syncFromGrids();
      const qc = [];
      val(qcG).forEach((r) => {
        if (!r.qc_type || qc.some((x) => x.qc_type === r.qc_type)) return;
        const q = { qc_type: r.qc_type, qc_class: r.qc_class || d.lists.qcTypes.find((x) => x.qc_type === r.qc_type)?.default_class, frequency: r.frequency || 'Once', criteria: [] };
        if (q.frequency === 'Every N') q.every_n = r.every_n; else if (q.frequency === 'Once') q.count = r.count ?? 1;
        if (r.material) q.material = r.material;
        (model[r.qc_type] || []).forEach((c) => {
          if (!c.limit_type) throw new Error(`${r.qc_type}: choose the criterion (or remove it).`);
          const sh = shapeOf(c.limit_type); const o = { limit_type: c.limit_type };
          if (sh !== 'Qualitative') { if (c.min !== null && sh === 'Range') o.min = c.min; if (c.max !== null) o.max = c.max; if (c.limit_ref && sh === 'Max') o.limit_ref = c.limit_ref; }
          o.analytes = c.rows.map((x) => { const a = { analyte_id: x.analyte_id, applies: x.applies !== false };
            if (sh === 'Range') { a.min = x.min ?? null; a.max = x.max ?? null; }
            if (sh === 'Max') { a.max = x.max ?? null; if (x.limit_ref) a.limit_ref = x.limit_ref; }
            return a; });
          q.criteria.push(o);
        });
        qc.push(q);
      });
      return { max_samples: n('c_max'), qc };
    } };
  }
  const catOpts = (d.lists.categories || []).map((c2) => ({ value: c2.id, label: c2.category_name }));
  if (type === 'Weighing') {
    const mode = cfg.target_mode || (cfg.target !== undefined && cfg.target !== null ? 'Single' : 'None');
    el.innerHTML = `<div class="grid4">${fld('Target', sel('c_mode', [{ value: 'None', label: 'No target (the analyst decides)' }, { value: 'Single', label: 'One target ± tolerance' }, { value: 'By product category', label: 'A range per product category' }], mode, false, !ed))}
      ${fld('Unit', sel('c_u', ['g', 'mg', 'kg', 'mL'], cfg.unit || 'g', false, !ed))}
      ${fld('Replicate weighings', inp('c_rep', cfg.replicates || 1, 'number', `min="1" max="10" step="1" ${dis}`), 'How many weights per sample (1 to 10), e.g. 10 capsules weighed one by one: their average is the step\'s weight')}</div>
      <div class="grid4" id="c_single">${fld('Target weight', inp('c_t', cfg.target, 'number', `step="any" ${dis}`))}${fld('Tolerance (±)', inp('c_tol', cfg.tolerance, 'number', `step="any" ${dis}`))}
        ${fld('Tolerance in', `<select id="c_tu" ${dis}></select>`, 'Percent of the target, or the weighing unit')}<div class="help" id="c_tolx"></div></div>
      <div id="c_catwrap">${fld('Weight range per product category', '<div id="c_cat"></div>', 'The sample\'s matrix gives its product category (Admin > Matrices). Each sample is checked against its own category\'s range at the bench (outside is flagged). Tick "Not weighed" for a category that is not weighed (e.g. swabs): the step does not wait for its samples.')}</div>
      ${fld('Controls', `<label class="cb"><input type="checkbox" id="c_qcnw" ${cfg.qc_not_weighed ? 'checked' : ''} ${dis}> Prep QC (controls) are not weighed</label>`, 'e.g. a positive control made from a strain: the step does not wait for a weight from it')}
      <div class="help">Weighs client samples and Prep QC; the actual weight and the balance used are always recorded per entry at the bench.</div>`;
    const cg = mkGrid('#c_cat', (cfg.by_category || []).map((x) => ({ ...x })), [
      { field: 'category_id', title: 'Product category', type: 'select', options: catOpts, width: 200 },
      { field: 'min', title: 'Lowest', type: 'number', width: 90 }, { field: 'max', title: 'Highest', type: 'number', width: 90 },
      { field: 'not_weighed', title: 'Not weighed', type: 'bool', width: 95, help: 'Samples of this category are not weighed (e.g. a sponge or stick swab)' } ]);
    // the tolerance is in % of the target or in the weighing unit (deck slide 7); the range it gives is shown underneath
    const tu = el.querySelector('#c_tu'); let tuVal = cfg.tolerance_unit || cfg.unit || 'g';
    const sync = () => {
      const m = el.querySelector('#c_mode').value; el.querySelector('#c_single').style.display = m === 'Single' ? '' : 'none'; el.querySelector('#c_catwrap').style.display = m === 'By product category' ? '' : 'none';
      const u = el.querySelector('#c_u').value; if (tuVal !== '%') tuVal = u;
      tu.innerHTML = [u, '%'].map((x) => `<option ${x === tuVal ? 'selected' : ''}>${esc(x)}</option>`).join(''); tu.dispatchEvent(new Event('change'));
      const t = n('c_t'); const tol = n('c_tol'); const pct = tuVal === '%';
      el.querySelector('#c_tolx').textContent = t !== null && tol !== null ? `Accepted: ${+(t - (pct ? t * tol / 100 : tol)).toPrecision(6)} to ${+(t + (pct ? t * tol / 100 : tol)).toPrecision(6)} ${u}` : '';
    };
    tu.addEventListener('input', () => { tuVal = tu.value; sync(); });
    el.querySelectorAll('#c_mode, #c_u, #c_t, #c_tol').forEach((x) => { x.addEventListener('change', sync); x.addEventListener('input', sync); }); sync();
    return { read: () => { const m = el.querySelector('#c_mode').value; const c2 = { target_mode: m, unit: el.querySelector('#c_u').value };
      const rep = Math.round(n('c_rep') || 1); if (rep > 1) c2.replicates = rep;   // replicate weighings (033)
      if (m === 'Single') { c2.target = n('c_t'); c2.tolerance = n('c_tol'); c2.tolerance_unit = tuVal === '%' ? '%' : c2.unit; }
      if (m === 'By product category') c2.by_category = val(cg).filter((r) => r.category_id).map((r) => (r.not_weighed ? { category_id: r.category_id, not_weighed: true } : { category_id: r.category_id, min: r.min, max: r.max }));
      if (el.querySelector('#c_qcnw').checked) c2.qc_not_weighed = true;   // 039
      return c2; } };
  }
  if (type === 'Preparation') {
    el.innerHTML = `${fld('Procedure reference', inp('c_ref', cfg.procedure_ref, 'text', dis), 'Shown to the analyst, e.g. SOP-CHEM-0233 section 7')}
      ${fld('Fields filled once per batch', '<div id="c_f"></div>', 'e.g. Digest final volume (mL), Program. Number fields can be used in formulas as {key.field}.')}`;
    const fg = mkGrid('#c_f', (cfg.fields || []).map((f) => ({ ...f })), [
      { field: 'label', title: 'Label', width: 260, required: true }, { field: 'type', title: 'Type', type: 'select', options: ['Number', 'Text', 'Time', 'Date'], width: 100 },
      { field: 'key', title: 'In formulas', type: 'readonly', width: 260, compute: (r) => (r.type === 'Number' && r.label ? `{${el.closest('#se').querySelector('#s_key').value || 'key'}.${slug(r.label)}}` : '') },
    ], () => ({ type: 'Number' }));
    return { read: () => ({ procedure_ref: tx('c_ref'), fields: val(fg).map((r) => ({ label: r.label, type: r.type || 'Text' })) }) };
  }
  if (type === 'Plating/Inoculation') {
    el.innerHTML = `<div class="grid3">${fld('Expected media', inp('c_media', cfg.expected_media, 'text', dis), 'Guidance; the media lot is recorded per batch')}
      ${fld('Plates per entry', inp('c_pp', cfg.plates_per_entry ?? 1, 'number', `min="1" ${dis}`), 'e.g. 2 for duplicate plating')}${fld('Procedure reference', inp('c_ref', cfg.procedure_ref, 'text', dis))}</div>`;
    return { read: () => ({ expected_media: tx('c_media'), plates_per_entry: n('c_pp'), procedure_ref: tx('c_ref') }) };
  }
  if (type === 'Incubation') {
    el.innerHTML = `<div class="grid3">${fld('Temperature (°C)', inp('c_temp', cfg.temp_c, 'number', `step="any" ${dis}`))}${fld('± (°C)', inp('c_ttol', cfg.temp_tolerance, 'number', `step="any" ${dis}`))}
      ${fld('Duration unit', sel('c_du', ['hours', 'days'], cfg.duration_unit || 'hours', false, !ed))}</div>
      <div class="grid3">${fld('Target duration', inp('c_dur', cfg.duration, 'number', `step="any" ${dis}`))}${fld('Shortest acceptable', inp('c_wmin', cfg.window_min, 'number', `step="any" ${dis}`))}
      ${fld('Longest acceptable', inp('c_wmax', cfg.window_max, 'number', `step="any" ${dis}`))}</div>
      ${fld('Window per product category (optional)', '<div id="c_cat"></div>', 'e.g. Dry pet food 22 to 26 hours while the others keep the window above. The sample\'s matrix gives its category. A load holding several categories is judged against the window they all share.')}
      <div class="help">Outside the window the load is flagged for review. Time in and out are recorded per load at the bench.</div>`;
    const wg = mkGrid('#c_cat', (cfg.by_category || []).map((x) => ({ ...x })), [
      { field: 'category_id', title: 'Product category', type: 'select', options: catOpts, width: 200 },
      { field: 'window_min', title: 'Shortest', type: 'number', width: 90 }, { field: 'window_max', title: 'Longest', type: 'number', width: 90 } ]);
    return { read: () => {
      const c2 = { temp_c: n('c_temp'), temp_tolerance: n('c_ttol'), duration: n('c_dur'), duration_unit: el.querySelector('#c_du').value, window_min: n('c_wmin'), window_max: n('c_wmax') };
      const cats = val(wg).filter((r) => r.category_id).map((r) => ({ category_id: r.category_id, window_min: r.window_min, window_max: r.window_max }));
      if (cats.length) c2.by_category = cats;   // 039
      return c2; } };
  }
  if (type === 'Dilution') {
    el.innerHTML = `<div class="grid4">${fld('Mode', sel('c_mode', ['Single', 'Serial'], cfg.mode || 'Single', false, !ed))}${fld('Dilution fields per entry', inp('c_fpe', cfg.fields_per_entry ?? 3, 'number', `min="1" ${dis}`), 'Room for re-dilutions at the bench')}
      ${fld('Expected diluent', inp('c_dil', cfg.expected_diluent, 'text', dis), 'Guidance; the lot is recorded at the bench')}</div>
      <div id="c_single"><div class="grid4">${fld('Default aliquot (g or mL)', inp('c_a', cfg.aliquot, 'number', `step="any" ${dis}`))}${fld('Default diluent added (mL)', inp('c_d', cfg.diluent, 'number', `step="any" ${dis}`))}</div>
        ${fld('Amounts per product category (optional)', '<div id="c_cat"></div>', 'e.g. Dietary Supplement 10 + 90, Cosmetic 1 + 9, Food 25 + 225. The sample\'s matrix gives its category; others use the default.')}</div>
      <div id="c_serial"><div class="grid4">${fld('Initial sample (g or mL)', inp('c_ia', cfg.initial_amount, 'number', `step="any" ${dis}`))}${fld('Initial diluent (mL)', inp('c_id', cfg.initial_diluent, 'number', `step="any" ${dis}`))}
        ${fld('Transfer aliquot (mL)', inp('c_ta', cfg.transfer_aliquot, 'number', `step="any" ${dis}`))}${fld('Transfer diluent (mL)', inp('c_td', cfg.transfer_diluent, 'number', `step="any" ${dis}`))}</div>
        <div class="grid4">${fld('Standard depth (levels)', inp('c_depth', cfg.depth, 'number', `min="1" ${dis}`))}</div></div>
      <div class="help" id="c_fact"></div>`;
    const sync = () => {
      const serial = el.querySelector('#c_mode').value === 'Serial';
      el.querySelector('#c_single').style.display = serial ? 'none' : ''; el.querySelector('#c_serial').style.display = serial ? '' : 'none';
      let text = '';
      if (!serial && n('c_a')) text = `Factor = (${n('c_a')} + ${n('c_d') ?? 0}) / ${n('c_a')} = ${((n('c_a') + (n('c_d') ?? 0)) / n('c_a')).toPrecision(4).replace(/\.?0+$/, '')}×`;
      if (serial && n('c_ia') && n('c_ta')) { const f0 = (n('c_ia') + (n('c_id') ?? 0)) / n('c_ia'); const ft = (n('c_ta') + (n('c_td') ?? 0)) / n('c_ta'); const lv = []; let f = f0; for (let i = 0; i < Math.min(n('c_depth') || 1, 8); i++) { lv.push(`10<sup>-${Math.round(Math.log10(f) * 100) / 100}</sup>`); f *= ft; } text = 'Levels: ' + lv.join(', '); }
      el.querySelector('#c_fact').innerHTML = text;
    };
    const dg = mkGrid('#c_cat', (cfg.by_category || []).map((x) => ({ ...x })), [
      { field: 'category_id', title: 'Product category', type: 'select', options: catOpts, width: 200 },
      { field: 'aliquot', title: 'Aliquot', type: 'number', width: 90 }, { field: 'diluent', title: 'Diluent (mL)', type: 'number', width: 100 } ]);
    const cats = () => val(dg).filter((r) => r.category_id).map((r) => ({ category_id: r.category_id, aliquot: r.aliquot, diluent: r.diluent }));
    el.querySelectorAll('input,select').forEach((x) => x.addEventListener('input', sync)); sync();
    return { read: () => (el.querySelector('#c_mode').value === 'Serial'
      ? { mode: 'Serial', initial_amount: n('c_ia'), initial_diluent: n('c_id'), transfer_aliquot: n('c_ta'), transfer_diluent: n('c_td'), depth: n('c_depth'), fields_per_entry: n('c_fpe'), expected_diluent: tx('c_dil') }
      : { mode: 'Single', aliquot: n('c_a'), diluent: n('c_d'), fields_per_entry: n('c_fpe'), expected_diluent: tx('c_dil'), ...(cats().length ? { by_category: cats() } : {}) }) };
  }
  if (type === 'Split off Test' || type === 'Hold Point') {
    const entries = d.steps.filter((s) => s.step_type === 'Data Entry' && (!step || anc.has(s.id)));
    const fs = cfg.finding_steps || [];
    el.innerHTML = `<div class="grid2">${fld(type === 'Hold Point' ? 'Waits for the test' : 'Test to split off', sel('c_test', d.lists.tests.map((x) => ({ value: x.id, label: `${x.test_code} ${x.test_name}` })), cfg.test_id, true, !ed),
        type === 'Hold Point' ? 'A test on the same sample (ordered with it, or split off). Its result can be used here as {key.result}.' : 'Created on the same sample, then batched like any test.', true)}
      ${type === 'Split off Test' ? fld('When', sel('c_trig', ['On finding', 'Manual only'], cfg.trigger || 'On finding', false, !ed)) : ''}</div>
      ${type === 'Split off Test' ? fld('Customer consent', `<label class="cb"><input type="checkbox" id="c_consent" ${(step ? cfg.consent_required !== false : cfg.consent_required === true) ? 'checked' : ''} ${dis}> Customer consent required</label>`,
        'Ticked: the request waits until the customer\'s consent is recorded, then the test is ordered. Not ticked: the test is ordered at once from the client\'s accepted quote.') : ''}
      ${type === 'Split off Test' ? fld('Alert the client', `<label class="cb"><input type="checkbox" id="c_alert" ${cfg.notify_client ? 'checked' : ''} ${dis}> Email the client at once when something is found (presumptive result)</label>`,
        'Completing this step on a finding emails the client\'s "Positive alerts" contacts (else Receives Report, else the ordering contact). The Outbox keeps who was told and when.') : ''}
      ${type === 'Split off Test' ? `<div id="c_find"><div class="grid4">${fld('Finding', sel('c_fd', [{ value: 'Present', label: 'Something found (a value that means found)' }, { value: 'Count above', label: 'A count above' }], cfg.finding || 'Present', false, !ed))}${fld('Count above', inp('c_ca', cfg.count_above, 'number', `step="any" ${dis}`))}</div>
        ${fld('Found at', `<div class="wdchecks">${entries.length ? entries.map((s) => `<label><input type="checkbox" data-fs="${esc(s.step_key)}" ${fs.includes(s.step_key) ? 'checked' : ''} ${dis}> ${esc(s.step_name)}</label>`).join('') : '<span class="help">No Data Entry step comes before this one yet.</span>'}</div>`)}</div>` : ''}`;
    enhanceAll(el);
    const trig = el.querySelector('#c_trig');
    const syncT = () => { const f = el.querySelector('#c_find'); if (f) f.style.display = trig.value === 'On finding' ? '' : 'none'; };
    if (trig) { trig.addEventListener('change', syncT); syncT(); }
    return { read: () => (type === 'Hold Point' ? { test_id: el.querySelector('#c_test').value || null }
      : { test_id: el.querySelector('#c_test').value || null, trigger: trig.value, finding: el.querySelector('#c_fd').value, count_above: n('c_ca'), consent_required: el.querySelector('#c_consent').checked, notify_client: el.querySelector('#c_alert').checked,
        finding_steps: [...el.querySelectorAll('[data-fs]')].filter((c) => c.checked).map((c) => c.dataset.fs) }) };
  }
  if (type === 'Calculation') {
    // values from earlier steps, picked by name (deck slide 14: tokens are pulled, not typed); the formula can still be typed
    const WORDS = { weight: 'Sample weight', factor: 'Dilution factor', final_volume: 'Final volume', duration: 'Incubation time', reading: 'Reading', result: 'Result' };
    const tokens = []; d.steps.filter((s) => anc.has(s.id)).forEach((s) => (s.tokens || []).forEach((f) => tokens.push({ tok: `{${s.step_key}.${f}}`,
      label: `${s.step_type === 'Hold Point' ? `Result of ${d.lists.tests.find((x) => x.id === s.config?.test_id)?.test_name || 'the waited-for test'}` : WORDS[f] || f.replace(/_/g, ' ')} · ${s.step_name}` })));
    el.innerHTML = `${fld('Formula (every analyte)', inp('c_f', cfg.formula, 'text', `class="wdmono" ${dis}`), 'Numbers, + − × / ^ ( ), the functions log10 ln exp sqrt abs min max power, and values from steps before this one.', true)}
      <div class="wdtokens"><span class="help">Values:</span> ${tokens.length ? tokens.map((x) => `<button class="mini wdtok" data-tok="${esc(x.tok)}" title="${esc(x.tok)}" ${dis}>${esc(x.label)}</button>`).join('') : `<span class="help">${step ? 'No step before this one offers values yet (connect it after a Weighing, Dilution, Data Entry... step).' : 'Save the step after the steps it uses to see their values here.'}</span>`}</div>
      <div class="wdtokens"><span class="help">Insert:</span> ${[['+', ' + '], ['−', ' - '], ['×', ' * '], ['÷', ' / '], ['^', '^'], ['(', '('], [')', ')'], ['log10', 'log10('], ['ln', 'ln('], ['exp', 'exp('], ['sqrt', 'sqrt('], ['abs', 'abs('], ['min', 'min('], ['max', 'max('], ['power', 'power(']]
        .map(([l, t]) => `<button class="mini" data-tok="${esc(t)}" ${dis}>${esc(l)}</button>`).join('')} <button class="mini" id="c_const" ${dis}>Constant…</button></div>
      <div class="grid3">${fld('Result unit', sel('c_u', d.lists.units, cfg.result_unit || '', true, !ed))}${fld('Note', inp('c_note', cfg.note, 'text', dis), 'e.g. what the formula does, in words')}</div>
      ${fld('Analyte exceptions', '<div id="c_ov"></div>', 'A different formula for some analytes; the rest use the formula above.')}
      <div class="wdtry"><b>Try it</b> <span class="help">Enter example values and calculate with the same engine the results will use.</span><div class="grid4" id="c_try"></div><button class="btn" id="c_go">Calculate</button> <span id="c_out"></span></div>`;
    let lastInput = el.querySelector('#c_f');
    const insert = (text) => { const i = lastInput; const p = i.selectionStart ?? i.value.length; i.value = i.value.slice(0, p) + text + i.value.slice(i.selectionEnd ?? p); i.focus(); i.selectionStart = i.selectionEnd = p + text.length; fillTry(); };
    el.querySelectorAll('[data-tok]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); insert(b.dataset.tok); }; });
    const cst = el.querySelector('#c_const');
    if (cst) cst.onclick = async (e) => { e.preventDefault(); const v = await modal({ title: 'Insert a constant', okText: 'Insert', intro: 'A fixed number in the formula, e.g. 1000 to convert units. It is part of the approved formula.',
      fields: [{ name: 'value', label: 'Number', type: 'number', required: true }] }); if (v && v.value !== '' && !Number.isNaN(Number(v.value))) insert(String(Number(v.value))); };
    const ovG = mkGrid('#c_ov', (cfg.overrides || []).map((o) => ({ ...o })), [
      { field: 'analyte_id', title: 'Analyte', type: 'select', options: tvAnalytes, width: 220 }, { field: 'formula', title: 'Formula', width: 520 } ]);
    const fillTry = () => {
      const toks = [...new Set((el.querySelector('#c_f').value.match(/\{[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\}/g) || []))];
      const host = el.querySelector('#c_try'); const old = Object.fromEntries([...host.querySelectorAll('input')].map((i) => [i.dataset.t, i.value]));
      host.innerHTML = toks.map((t) => fld(t, `<input data-t="${esc(t.slice(1, -1))}" type="number" step="any" value="${esc(old[t.slice(1, -1)] ?? '')}">`)).join('');
    };
    el.querySelector('#c_f').addEventListener('input', fillTry); fillTry();
    el.querySelector('#c_go').onclick = async (e) => {
      e.preventDefault();
      const values = Object.fromEntries([...el.querySelectorAll('#c_try input')].filter((i) => i.value !== '').map((i) => [i.dataset.t, Number(i.value)]));
      try { const r = await api('/methods/formula-test', { method: 'POST', body: { formula: el.querySelector('#c_f').value, values } });
        el.querySelector('#c_out').innerHTML = r.problem ? `<span class="bad">${esc(r.problem)}</span>` : `= <b>${esc(String(r.value))}</b> ${esc(el.querySelector('#c_u').value)}`; }
      catch (x) { el.querySelector('#c_out').textContent = x.message; }
    };
    return { read: () => { const c = { formula: tx('c_f'), result_unit: el.querySelector('#c_u').value || null, note: tx('c_note') };
      const ov = val(ovG).filter((o) => o.analyte_id); if (ov.length) c.overrides = ov.map((o) => ({ analyte_id: o.analyte_id, formula: o.formula })); return c; } };
  }
  if (type === 'Data Entry') {
    const ids = cfg.analyte_ids || [];
    el.innerHTML = `<div class="grid3">${fld('Value entered', inp('c_lbl', cfg.value_label, 'text', dis), 'e.g. Concentration in solution', true)}${fld('Unit of the value', sel('c_u', d.lists.units, cfg.value_unit || '', true, !ed))}
      ${fld('Raw data', `<label class="cb"><input type="checkbox" id="c_att" ${cfg.require_attachment === false ? '' : 'checked'} ${dis}> Instrument export must be attached</label>`, 'Untick for a manual observation (e.g. reading plates); then no instrument is needed.')}</div>
      ${fld('Analytes entered here', `<div class="wdchecks">${d.analytes.map((a) => `<label><input type="checkbox" data-an="${a.analyte_id}" ${ids.includes(a.analyte_id) ? 'checked' : ''} ${dis}> ${esc(a.analyte_name)}</label>`).join('') || '<span class="help">Add the analytes on tab 2 first.</span>'}</div>`, 'None ticked = all of the test\'s analytes.')}`;
    return { read: () => { const c = { value_label: tx('c_lbl'), value_unit: el.querySelector('#c_u').value || null, require_attachment: el.querySelector('#c_att').checked };
      const a = [...el.querySelectorAll('[data-an]')].filter((x) => x.checked).map((x) => x.dataset.an); if (a.length) c.analyte_ids = a; return c; } };
  }
  if (type === 'QC Review') {
    el.innerHTML = `<div class="grid3">${fld('Reviews', sel('c_scope', ['Batch', 'Timepoint'], cfg.scope || 'Batch', false, !ed), 'Timepoint: a review on its own branch (e.g. day 7 of a study) that never holds up the rest')}</div>
      <div class="help">The reviewer must not have done the reviewed steps; every step is opened and approved, every flag dispositioned, and the batch approved with one signature. These are fixed GMP rules, not settings.</div>`;
    return { read: () => ({ scope: el.querySelector('#c_scope').value }) };
  }
  el.innerHTML = '<div class="help">No settings for this type.</div>';
  return { read: () => ({}) };
}

// ---------------------------------------------------------------- 4 Review and approve
function tabReview(host, d, reload) {
  const v = d.version; const errors = d.problems.filter((p) => p.severity === 'Error'); const warns = d.problems.filter((p) => p.severity === 'Warning');
  const stepOf = (k) => d.steps.find((s) => s.step_key === k);
  const li = (p) => { const s = p.step_key ? stepOf(p.step_key) : null;
    return `<li class="${p.severity}">${s ? `<a href="#/methods/versions/${v.id}?tab=workflow&step=${s.id}">${esc(s.step_name)}</a>` : ''}${esc(p.problem)}</li>`; };
  const canApprove = v.status === 'Draft' && d.can_approve && !errors.length && !d.i_worked_on_it;
  host.innerHTML = `<div class="card">${section('What the database checks', 'Errors stop approval. Warnings are worth a look but do not stop it.')}
      ${d.problems.length ? `<ul class="wdprob">${errors.map(li).join('')}${warns.map(li).join('')}</ul>` : '<div class="wdok">No problems found: this version is complete.</div>'}</div>
    <div class="wdcards">${card('Analytes', d.analytes.length)}${card('Steps', d.steps.length)}${card('QC types in the batch', (d.steps.find((s) => s.step_type === 'Batching')?.config?.qc || []).length)}${card('Formulas', d.steps.filter((s) => s.step_type === 'Calculation').length)}</div>
    ${(d.qcCriteria || []).length ? `<div class="card">${section('QC acceptance per analyte', 'What each QC will judge for each analyte at the bench: one verdict per analyte against its own limit (set in the Batching step).')}<div id="qcx"></div></div>` : ''}
    <div class="card">${section('Workflow verification', 'An automated sample runs through the whole workflow and the results are checked against an independent calculation: the protocol, run and report are signed (WD-6).')}<div id="verif"><div class="loading">Loading…</div></div></div>
    <div class="card">${section('Approval', 'Approving makes this version Effective: new orders use it, and the previous effective version is superseded (tests already ordered keep theirs). The approver signs, holds methods.approve, and did not work on the version.')}
      ${v.status === 'Draft' ? `<p>Worked on this version: <b>${esc(d.authors.join(', ') || '—')}</b>${d.authors.length ? ' (they cannot approve it).' : ''}</p>
        ${canApprove ? '<button class="btn primary" id="approve">Approve version ' + v.version_no + '</button>'
          : `<div class="notice">${!d.can_approve ? 'Approving needs methods.approve in this lab.' : d.i_worked_on_it ? 'You worked on this version, so someone else must approve it.' : `Fix the ${errors.length} problem${errors.length === 1 ? '' : 's'} above first.`}</div>`}`
        : `<p>${esc(v.status)}${v.approved_by_name ? `: approved by <b>${esc(v.approved_by_name)}</b> on ${esc(dt(v.approved_at))} (electronic signature)` : ''}${v.effective_from ? `, effective from ${esc(dt(v.effective_from))}` : ''}.</p>`}</div>`;
  const qx = host.querySelector('#qcx');
  if (qx) {
    const lim = (r) => (!r.applies ? 'Not judged' : r.shape === 'Qualitative' ? r.limit_type
      : r.shape === 'Max' ? `≤ ${r.limit_ref || (r.max_value ?? '?')}` : `${r.min_value ?? '?'} to ${r.max_value ?? '?'}`);
    new Grid(qx, { readOnly: true, search: true, rows: d.qcCriteria, columns: [
      { field: 'qc_type', title: 'QC', type: 'readonly', width: 200 }, { field: 'limit_type', title: 'Criterion', type: 'readonly', width: 140 },
      { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 200 },
      { field: 'lim', title: 'Limit', type: 'readonly', width: 130, compute: lim, cellClass: (r) => (r.applies ? '' : 'mutedrow') },
      { field: 'source', title: 'Set as', type: 'readonly', width: 160, compute: (r) => ({ Analyte: 'For this analyte', Default: 'Default (all analytes)', Exception: 'Exception' }[r.source] || r.source) } ] });
  }
  // the gate (WD-6): with the lab's setting on, approval waits for a signed, passing verification of this design
  const vh = host.querySelector('#verif');
  if (vh) versionCard(vh, v.id, v.status).then((vd) => {
    const apb = host.querySelector('#approve');
    if (vd && vd.required && !vd.passing && apb) apb.insertAdjacentHTML('afterend', '<div class="notice" style="margin-top:8px">This lab requires a passing workflow verification first (above): approving now will be refused.</div>');
  });
  const ap = host.querySelector('#approve');
  if (ap) ap.onclick = () => signDialog({ what: `${d.test.test_code} ${d.test.test_name}, version ${v.version_no}`, meaning: 'Approved by', needReason: false,
    submit: async ({ signature }) => { await api(`/methods/versions/${v.id}/approve`, { method: 'POST', body: { signature, reason: 'Test version approved' } }); } })
    .then((ok) => { if (ok) { toast(`Version ${v.version_no} is Effective.`); reload(); } });
}
