// Inventory (slice 3, reworked in 3.1 after Alex's feedback): the inventory list, the item page (new, edit,
// duplicate), the in-house mixture page with calculated concentrations, Receive many (paste grid), the lot page,
// storage location pages, stock movements, reorder / receive / transfer / dispose, Supplier COAs, sample storage,
// the Supplier, Storage location and Warning rule lists, Excel export and upload on every tab.
// Admin: job roles, Units, Unit conversions.
import { api, esc, pageHeader, toast, modal, state, currentSite, currentUser, badge, link, signDialog, setDirtyCheck, can } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, section } from './common.js';
import { lotCard } from './logbooks.js';
import { bulkButtons, wireBulk, printTable } from '../bulkio.js';
import { printLabels } from '../labels.js';

// Every inventory create and change is signed (user ID + password; the meaning is set by the action). Routine usage is not.
// fn(reason, signature) runs while the dialog is open: a wrong password or a refused change keeps it open with the message.
const signed = (opts, fn) => signDialog({ ...opts, submit: ({ reason, signature }) => fn(reason, signature) });

// Page styles for this slice (kept here so no shared stylesheet changes)
const css = document.createElement('style');
css.textContent = `
.invtabs { display: flex; gap: 6px; flex-wrap: wrap; margin: -4px 0 14px; }
.invtabs a { text-decoration: none; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 6px 12px; border-radius: 7px; font-size: 13.5px; }
.invtabs a.on { background: var(--green-700); border-color: var(--green-700); color: #fff; }
.warnchips span { display: inline-block; font-size: 11.5px; font-weight: 600; padding: 0 7px; border-radius: 9px; margin-right: 4px; }
.w-bad { background: var(--err); color: var(--err-ink); } .w-warn { background: var(--warn); color: var(--warn-ink); } .w-info { background: #E8EEFB; color: #2F5BA8; } .w-ok { background: var(--green-50); color: var(--green-700); }
.actbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.invbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.invbar .sp { flex: 1; }
table.grid td.cbad { background: #FDECEA; color: var(--err-ink); font-weight: 600; }
table.grid td.cwarn { background: #FFF4DE; color: var(--warn-ink); font-weight: 600; }
.eyebrow { color: var(--muted); font-size: 12.5px; font-weight: 600; letter-spacing: .3px; margin-bottom: -2px; }
.itemform .aifill { background: #FFF8E6 !important; border-color: #E2A33B !important; }
.coarow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0 4px; }
.mqbox { border: 1px solid #F0D9A0; background: #FFF8E6; border-radius: 8px; padding: 8px 12px; margin: 0 0 14px; font-size: 13.5px; }
.mqbox.ok { border-color: #BFE6D6; background: var(--green-50); } .mqbox.bad { border-color: #F3C2BC; background: #FDECEA; }
.chips2 .badge { margin-right: 4px; }
.statcards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
.statcard { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; background: #fff; }
.statcard span { display: block; color: var(--muted); font-size: 12.5px; } .statcard b { font-size: 16px; }
.statcard.alert { background: #FFF4DE; border-color: #F3D19C; } .statcard.alert b, .statcard.alert span { color: var(--warn-ink); }
.statcard.deficient { background: #FDECEA; border-color: #F5B5AE; } .statcard.deficient b, .statcard.deficient span { color: var(--err-ink); }
.statcard.conforms b { color: var(--green-700); }
.rulelist .rule { display: flex; justify-content: space-between; gap: 12px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin-bottom: 6px; }
.res-Conforms { color: var(--green-700); font-weight: 700; } .res-Alert { color: var(--warn-ink); font-weight: 700; } .res-Deficient { color: var(--err-ink); font-weight: 700; }
.lotfoot { color: var(--muted); font-size: 12.5px; border-top: 1px solid var(--line); padding-top: 10px; margin-top: 6px; }
.itemform .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.itemform .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 16px; }
.itemform .field { margin-bottom: 10px; }
.itemform .field > label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 2px; }
.itemform input:not([type=checkbox]):not([type=radio]), .itemform select, .itemform textarea { width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.itemform input:disabled { background: #F2F4F6; color: var(--muted); }
.checks { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 4px 0; }
.checks label { display: inline-flex; gap: 6px; align-items: center; font-weight: 400 !important; font-size: 13.5px; white-space: nowrap; }
.modeswitch { display: flex; gap: 8px; margin-bottom: 12px; }
.modeswitch label { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; display: flex; gap: 8px; align-items: center; cursor: pointer; background: #fff; }
.modeswitch label:has(input:checked) { border-color: var(--green-700); background: var(--green-50); }
.calcnote { color: var(--muted); font-size: 12px; }
.bulksum { display: flex; gap: 18px; flex-wrap: wrap; background: #F7F9FA; border-radius: 8px; padding: 8px 12px; margin: 6px 0 10px; }
.bulksum .c-new b { color: var(--green-700); } .bulksum .c-upd b { color: #2F5BA8; } .bulksum .c-err b { color: var(--err-ink); }
table.grid tr.errrow td { background: #FDECEA; }
.coa-review { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; }
.coa-review iframe, .coa-review img { width: 100%; height: 62vh; border: 1px solid var(--line); border-radius: 8px; background: #F7F8FA; object-fit: contain; }
.coa-fields .cf { display: grid; grid-template-columns: 130px 1fr; gap: 4px 10px; align-items: start; margin-bottom: 10px; }
.coa-fields label { font-weight: 600; font-size: 13px; padding-top: 6px; }
.coa-fields input { width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.coa-fields .ev { grid-column: 2; font-size: 12px; color: var(--muted); }
.coa-fields .cur { grid-column: 2; font-size: 12px; color: var(--muted); }
.coa-fields .diff input { border-color: #E2A33B; background: #FFF8EC; }
.aiflag { background: #E8EEFB; color: #2F5BA8; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; font-size: 13px; }
#printarea { display: none; }
@media print { body.printing-list > *:not(#printarea) { display: none !important; } body.printing-list #printarea { display: block; } }
@media (max-width: 900px) { .coa-review, .itemform .grid2, .itemform .grid3, .statcards { grid-template-columns: 1fr; } }
`;
document.head.appendChild(css);

// ---------------------------------------------------------------- shared
let META = null;
async function meta() { if (!META) META = await api('/inventory/meta'); return META; }
async function me() { return api('/inventory/me'); }
const d8 = (v) => (v ? String(v).slice(0, 10) : '');
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
const fmtN = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 }));
const qty = (v, u) => (v === null || v === undefined ? '' : `${fmtN(v)} ${u || ''}`.trim());
const kv = (pairs) => `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v === null || v === undefined || v === '' ? '—' : v}</dd>`).join('')}</dl>`;
const today = () => { const t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 10); }; // local date
const isMixture = (l) => (l.chemical_types || []).includes('In-house mixture');
const closed = (r) => ['Disposed', 'Cancelled', 'Depleted'].includes(r.status);
const locLink = (id, code, path) => (id ? link('#/inventory/locations/' + id, code) + (path ? ` <span class="help">${esc(path)}</span>` : '') : '');

const TABS = [['#/inventory', 'Inventory'], ['#/inventory/samples', 'Sample storage'], ['#/inventory/suppliers', 'Suppliers and manufacturers'],
  ['#/inventory/locations', 'Storage locations'], ['#/inventory/thresholds', 'Warning rules'], ['#/inventory/qa-testing', 'QA testing']];
const tabs = (cur) => `<div class="invtabs">${TABS.map(([h, l]) => `<a href="${h}" class="${h === cur ? 'on' : ''}">${esc(l)}</a>`).join('')}</div>`;

// Multi-value list cells (supported conditions): typed or pasted as "Ambient, Refrigerated"
function listCol(field, title, allowed, width, extra = {}) {
  const canon = (v) => (v || []).map((x) => allowed.find((a) => a.toLowerCase() === String(x).toLowerCase()) || x);
  return { field, title, type: 'array', width, help: 'One or more of: ' + allowed.join(', ') + '. Separate with commas.',
    validate: (v) => { const bad = (v || []).filter((x) => !allowed.some((a) => a.toLowerCase() === String(x).toLowerCase())); return bad.length ? 'Not on the list: ' + bad.join(', ') : null; },
    canon, ...extra };
}
function canonRows(rows, cols) {
  return rows.map((r) => { const o = { ...r }; cols.filter((c) => c.canon).forEach((c) => { if (c.field in o) o[c.field] = c.canon(o[c.field]); }); return o; });
}

function needLab(main) {
  if (currentSite()) return true;
  main.innerHTML = '<div class="card err">Choose your lab (top right) first. If none is listed, ask an administrator to assign you to a lab.</div>';
  return false;
}

// A modal holding an editable grid (used for usage). Returns the rows or null.
function gridDialog({ title, intro = '', columns, rows = [], newRow = () => ({}), okText = 'Save', fields = '', collect = null, minRows = 5 }) {
  return new Promise((resolve) => {
    const m = document.createElement('div'); m.className = 'modal-bg';
    m.innerHTML = `<div class="modal xwide"><h3>${esc(title)}</h3>${intro ? `<p class="intro">${intro}</p>` : ''}${fields}<div id="dg"></div><div class="merr"></div>
      <div class="mbtns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>${esc(okText)}</button></div></div>`;
    document.body.appendChild(m);
    const start = rows.length ? rows : Array.from({ length: minRows }, () => newRow());
    const g = new Grid(m.querySelector('#dg'), { columns, rows: start, allowAdd: true, newRow });
    const close = (v) => { g.destroy(); m.remove(); resolve(v); };
    m.querySelector('[data-x]').onclick = () => close(null);
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.querySelector('.combo-list')) close(null); });
    m.querySelector('[data-ok]').onclick = () => {
      if (g.hasErrors()) { m.querySelector('.merr').textContent = 'Fix the cells marked in red first.'; return; }
      const out = g.rows.filter((r) => columns.some((c) => c.required && r[c.field] !== undefined && r[c.field] !== null && r[c.field] !== ''));
      const extra = collect ? collect(m) : {};
      if (extra === false) return;
      close({ rows: out, ...extra });
    };
  });
}

async function fileToBase64(file) {
  const buf = await file.arrayBuffer(); let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Options used by several screens (match: other spellings accepted when typing or pasting)
const locOpt = (l) => ({ value: l.id, label: `${l.location_code}: ${l.path}`, match: [l.location_code, l.location_name] });
const analyteOpt = (a) => ({ value: a.id, label: a.analyte_name + (a.cas_number ? ` (${a.cas_number})` : ''), match: [a.analyte_name, a.analyte_code, a.report_name, a.cas_number].filter(Boolean) });
async function lookups() {
  const [suppliers, locations, analytes, departments, waste] = await Promise.all([api('/inventory/suppliers'), api('/inventory/locations'), api('/analytes'), api('/departments').catch(() => []), api('/waste/options').catch(() => [])]);
  return {
    suppliers, locations, analytes,
    wasteOpts: waste.map((w) => ({ value: w.id, label: `${w.waste_name}${w.site_id ? '' : ''}`, match: [w.waste_code] })),
    supOpts: suppliers.filter((s) => s.status === 'Active' && s.supplier_type !== 'Manufacturer').map((s) => ({ value: s.id, label: s.supplier_name, match: [s.supplier_code] })),
    mfrOpts: suppliers.filter((s) => s.status === 'Active' && s.supplier_type !== 'Supplier').map((s) => ({ value: s.id, label: s.supplier_name, match: [s.supplier_code] })),
    locOpts: locations.filter((l) => l.status === 'Active').map(locOpt),
    deptOpts: departments.map((d) => ({ value: d.id, label: d.department_name, match: [d.department_code] })),
    sampleLocOpts: locations.filter((l) => l.status === 'Active' && l.holds_samples).map(locOpt),
    analyteOpts: analytes.filter((a) => a.status === 'Active').map(analyteOpt),
  };
}
const exp = (r) => (r.expiry_status === 'Expired' || r.expiry_status === 'Retest due' ? 'cbad' : r.expiry_status === 'Expiring soon' ? 'cwarn' : '');
const amt = (r) => (r.negative_stock ? 'cbad' : r.low_stock ? 'cwarn' : '');

// ================================================================ INVENTORY LIST (as in Alex's mock-up)
const FILTERS = {
  active: ['Active', (r) => !closed(r)],
  wasted: ['Show wasted', (r) => closed(r)],
  expired: ['Show expired', (r) => !closed(r) && ['Expired', 'Retest due'].includes(r.expiry_status)],
  negative: ['Show negative', (r) => r.negative_stock],
  order: ['On order', (r) => r.receipt_status !== 'Received' && r.status !== 'Cancelled'],
  qa: ['QA testing', (r) => !closed(r) && !!r.qa_status && !/^Released/.test(r.qa_status)],
  waste: ['Waste to classify', (r) => !closed(r) && (!r.waste_name || !!r.waste_review)],   // 0.30.0
};
// QA testing before use (migration 040): the colour of a lot's status
const qaCls = (st) => (!st || /^Released/.test(st) ? '' : /^Rejected/.test(st) ? 'cbad' : 'cwarn');
const LIST_COLS = [
  { title: 'ID', get: (r) => r.lot_code }, { title: 'Name', get: (r) => r.material }, { title: 'Lot#', get: (r) => (isMixture(r) ? r.lot_code : r.manufacturer_lot) },
  { title: 'Conc.', get: (r) => r.conc_display }, { title: 'Date made', get: (r) => d8(r.date_made) }, { title: 'CAS', get: (r) => r.cas_display },
  { title: 'Vendor', get: (r) => r.supplier_name }, { title: 'Exp date', get: (r) => d8(r.expiration_date) },
  { title: 'Amount', get: (r) => (r.receipt_status === 'Received' ? qty(r.on_hand, r.unit) : '') }, { title: 'Purchase status', get: (r) => (isMixture(r) ? 'In-house' : r.receipt_status) },
  { title: 'QA testing', get: (r) => r.qa_status || '' },
  { title: 'Waste', get: (r) => r.waste_name || '' },
];

export async function lots(main) {
  if (!needLab(main)) return;
  const rows = await api('/inventory/lots');
  const site = currentSite();
  const f = FILTERS[state.query.get('show')] ? state.query.get('show') : 'active'; // the menu link always opens on Active
  const count = (k) => rows.filter(FILTERS[k][1]).length;
  main.innerHTML = pageHeader(`Inventory: ${site.site_code}`, `Every item in ${esc(site.site_name)}: chemicals, standards, reagents, media, strains, consumables and in-house mixtures. Click an ID to open it.`,
    '', { kind: 'inventory' }) + tabs('#/inventory') + `
    <div class="invbar">
      ${Object.entries(FILTERS).map(([k, [l]]) => `<a class="tab ${k === f ? 'on' : ''}" href="#/inventory?show=${k}" style="text-decoration:none">${esc(l)} <small>${count(k)}</small></a>`).join('')}
      <span class="sp"></span>${bulkButtons('lots')}<button class="btn" id="print">Print</button>
      <button class="btn primary" id="newitem">+ New Inventory Item</button><button class="btn primary" id="mix">+ In-house mixture</button>
    </div>
    <div class="invbar"><span class="help">Also:</span><button class="btn" id="use">Record usage</button>
      <button class="btn" id="many">Receive many (paste)</button><button class="btn" id="labels" title="Barcode labels for the ticked rows (Dymo, 1 x 2 1/8 in.), one per container">Print labels</button></div>
    <div id="g"></div>`;
  const shown = rows.filter(FILTERS[f][1]).map((r) => ({ ...r, _pick: false }));
  const g = new Grid(main.querySelector('#g'), {
    rows: shown, search: true, filter: state.query.get('find') || '', emptyText: 'Nothing here.',
    onRowOpen: (r) => { location.hash = '#/inventory/lots/' + r.id; },
    rowClass: (r) => (closed(r) ? 'mutedrow' : ''),
    columns: [
      { field: '_dup', title: '', type: 'button', width: 82, label: 'Duplicate', onClick: (r) => { location.hash = '#/inventory/new?from=' + r.id; } },
      { field: '_reo', title: '', type: 'button', width: 74, label: (r) => (isMixture(r) || r.status === 'Cancelled' ? '' : 'Reorder'), onClick: (r) => { if (!isMixture(r)) reorderDialog(r); } },
      { field: 'lot_code', title: 'ID', type: 'link', width: 100, href: (r) => '#/inventory/lots/' + r.id },
      { field: 'material', title: 'Name', type: 'readonly', width: 230 },
      { field: 'lotno', title: 'Lot#', type: 'readonly', width: 110, compute: (r) => (isMixture(r) ? r.lot_code : r.manufacturer_lot || '–') },
      { field: 'conc_display', title: 'Conc.', type: 'readonly', width: 100, format: (v) => v || '–' },
      { field: 'date_made', title: 'Date made', type: 'readonly', width: 95, format: (v) => d8(v) || '–' },
      { field: 'cas_display', title: 'CAS', type: 'readonly', width: 95, format: (v) => v || '–' },
      { field: 'supplier_name', title: 'Vendor', type: 'readonly', width: 150, format: (v) => v || '–' },
      { field: 'expiration_date', title: 'Exp date', type: 'readonly', width: 95, format: (v) => d8(v) || '–', cellClass: exp },
      { field: 'amount', title: 'Amount', type: 'readonly', width: 90, align: 'right', compute: (r) => (r.receipt_status === 'Received' ? qty(r.on_hand, r.unit) : '–'), cellClass: amt },
      { field: 'receipt_status', title: 'Purchase status', type: 'readonly', width: 120, format: (v, r) => (isMixture(r) ? '–' : v) },
      { field: 'qa_status', title: 'QA testing', type: 'readonly', width: 170, format: (v) => v || '', help: 'QA testing before use: the item types your lab tests (Inventory > QA testing), or items sent for it, are tested on a sample with the lot\'s ID and released for every use or for named tests',
        cellClass: (r) => qaCls(r.qa_status) },
      { field: '_pick', title: '☐', type: 'bool', width: 40, help: 'Tick rows to export, print or label only those' },
      // waste classification (0.30.0): how the item is disposed of; "classify from the SDS" still needs a choice
      { field: 'waste_name', title: 'Waste', type: 'readonly', width: 200, format: (v, r) => (v ? (r.waste_review ? 'To classify (see SDS)' : v) : 'None'),
        cellClass: (r) => (!r.waste_name || r.waste_review ? 'cwarn' : ''), help: 'The item\'s waste classification (Admin > Lab setup > Waste classifications): how it is disposed of' },
    ],
  });
  const picked = () => g.rows.filter((r) => r._pick);
  wireBulk(main, { selected: () => picked().map((r) => r.id), done: () => lots(main) });
  main.querySelector('#print').onclick = () => { const p = picked(); printTable(`Inventory: ${site.site_code} (${FILTERS[f][0]})`, LIST_COLS, p.length ? p : g.v.map((i) => g.rows[i])); };
  main.querySelector('#newitem').onclick = () => { location.hash = '#/inventory/new'; };
  main.querySelector('#mix').onclick = () => { location.hash = '#/inventory/mixture'; };
  main.querySelector('#many').onclick = () => { location.hash = '#/inventory/receive'; };
  main.querySelector('#use').onclick = () => usageDialog(rows.filter((r) => r.use_eligible), () => lots(main));
  main.querySelector('#labels').onclick = () => {
    const p = picked().length ? picked() : g.selectedRows();
    if (!p.length) { toast('Tick the rows (or select them) to print labels for.', 'err'); return; }
    printLabels('lot', p.map((r) => r.id));
  };
}

// QA testing before use (migration 040; media qualification since 023): what the lot is released for when it passes (every
// use, or a named test) and the QA test that decides it. One test sample with the lot's own ID is made and goes to the
// backlog; QA's approval of its batch releases the lot, or rejects it.
async function qualifyDialog(l) {
  const o = await api(`/inventory/lots/${l.id}/qualify-options`);
  const opts = o.tests.map((t) => ({ value: t.id, label: t.test_name, match: [t.test_code, t.department_code].filter(Boolean) }));
  const useOpts = [{ value: 'ALL', label: 'Every use' }, ...opts];
  const media = (l.chemical_types || []).includes('Media');
  const guess = o.tests.find((t) => (media ? /growth promotion|media qualification|media qc/i : /identity|qa test|incoming|release|qualif/i).test(t.test_name));
  const rejected = /^Rejected/.test(l.qa_status || '');
  const res = await gridDialog({
    title: `${rejected ? 'Retest' : 'Send for QA testing'}: ${l.lot_code} ${l.material}`, okText: rejected ? 'Send for retest' : 'Send for QA testing', minRows: 1,
    newRow: () => ({ use_test_id: media ? '' : 'ALL', qualification_test_id: guess ? guess.id : '' }),
    intro: `One row per release: <b>Released for</b> is <i>Every use</i>, or the one test the lot may then be used for (as media is qualified for a test's organisms); <b>QA test</b> is the test that decides it. A test sample with this lot's ID (${esc(l.lot_code)}) is made on the lab's internal order and goes to the backlog; it joins batches without counting toward their size or QC. When QA approves its review the lot is released; if a result does not conform, the lot is rejected for every use until a retest passes.${rejected ? ' <b>This lot was rejected: this is its retest.</b>' : ''}`,
    columns: [
      { field: 'use_test_id', title: 'Released for', type: 'select', options: useOpts, width: 330, required: true },
      { field: 'qualification_test_id', title: 'QA test', type: 'select', options: opts, width: 330, required: true },
    ],
  });
  if (!res || !res.rows.length) return false;
  try {
    const r = await api(`/inventory/lots/${l.id}/qualify`, { method: 'POST', body: { items: res.rows.map((x) => ({ use_test_id: x.use_test_id === 'ALL' ? null : x.use_test_id, qualification_test_id: x.qualification_test_id })) } });
    toast(`Sent for QA testing: test sample ${r.sample_code} is in the backlog.`);
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

async function reorderDialog(l, after) {
  const v = await modal({ title: `Reorder ${l.material}`, okText: 'Create request', intro: 'Creates a purchase request like this lot (same item, analytes, vendor and catalog number). A Lab Supervisor approves it.',
    fields: [{ name: 'quantity', label: `Quantity (${l.unit || ''})`, type: 'number', value: l.quantity_received ?? l.requested_quantity, required: true }, { name: 'notes', label: 'Notes' }] });
  if (!v) return;
  const r = await signed({ what: `Reorder of ${l.lot_code} ${l.material}: ${v.quantity} ${l.unit || ''}`, meaning: 'Requested by', needReason: false },
    (reason, signature) => api(`/inventory/lots/${l.id}/reorder`, { method: 'POST', body: { quantity: Number(v.quantity), notes: v.notes, signature } }));
  if (r) { toast('Purchase request created and signed.'); location.hash = '#/inventory/lots/' + r.id; } else if (after) after();
}

async function usageDialog(usable, done) {
  if (!usable.length) { toast('No usable lots in this lab.', 'err'); return; }
  const opts = usable.map((r) => ({ value: r.lot_code, label: `${r.lot_code} ${r.material} (${qty(r.on_hand, r.unit)} left)` }));
  const res = await gridDialog({
    title: 'Record usage', okText: 'Record',
    intro: 'Routine usage: no signature needed (it is recorded under your name). One line per lot used. Paste from Excel or fill down (Ctrl+D) a reference such as the batch or work instruction. Only usable lots can be picked: expired, retest-due, on-hold and not-yet-received lots are refused.',
    columns: [
      { field: 'lot_code', title: 'Lot', type: 'select', options: opts, width: 330, required: true },
      { field: 'quantity', title: 'Quantity used', type: 'number', min: 0, width: 110, required: true },
      { field: 'unit', title: 'Unit', type: 'readonly', width: 60, compute: (r) => usable.find((u) => u.lot_code === r.lot_code)?.unit || '' },
      { field: 'reference', title: 'Reference (batch, sample, WI)', width: 220 },
      { field: 'notes', title: 'Notes', width: 200 },
    ],
  });
  if (!res || !res.rows.length) return;
  try { await api('/inventory/movements', { method: 'POST', body: { rows: res.rows.map((r) => ({ ...r, txn_type: 'Usage' })) } }); toast(`Recorded ${res.rows.length} usage line${res.rows.length === 1 ? '' : 's'}.`); done(); }
  catch (e) { toast(e.message, 'err'); }
}

// ================================================================ ITEM PAGE: new, duplicate, edit
const sel = (id, options, value, { blank = true, attrs = '' } = {}) => `<select id="${id}" ${attrs}>${blank ? '<option value=""></option>' : ''}${options.map((o) => {
  const v = o.value ?? o; const l = o.label ?? o; return `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
const inp = (id, value, type = 'text', attrs = '') => `<input id="${id}" type="${type}" ${type === 'number' ? 'step="any"' : ''} value="${esc(value ?? '')}" ${attrs}>`;
const fld = (label, ctrl, help = '', req = false) => `<div class="field"><label>${esc(label)}${req ? ' <span class="req">*</span>' : ''}</label>${ctrl}${help ? `<div class="help">${help}</div>` : ''}</div>`;

export async function itemPage(main, editId) {
  if (!needLab(main)) return;
  const fromId = state.query.get('from');
  const [M, L, QA, who] = await Promise.all([meta(), lookups(), editId ? null : api('/inventory/qa-defaults').catch(() => null), editId ? null : me()]);
  const src = editId || fromId ? await api('/inventory/lots/' + (editId || fromId)) : null;
  const l = src ? src.lot : {};
  const editing = !!editId; const received = editing && l.receipt_status === 'Received';
  const mixture = editing && isMixture(l);
  const v = editing ? { ...l } : src ? { // duplicate: same item, new lot details
    item_name: l.material, chemical_types: l.chemical_types, physical_form: l.physical_form, cas_number: l.cas_number, supplier_id: l.supplier_id,
    manufacturer_id: l.manufacturer_id, catalog_number: l.catalog_number, quantity_received: l.quantity_received, unit: l.unit,
    concentration: l.concentration, concentration_unit: l.concentration_unit, purity_pct: l.purity_pct, storage_condition: l.storage_condition,
    storage_location_id: l.storage_location_id, department_id: l.department_id, waste_classification_id: l.waste_classification_id, received_date: today() } : { received_date: today(), chemical_types: [] };
  const types = M.chemical_types.filter((t) => t !== 'In-house mixture' || mixture);
  const title = editing ? `Edit ${l.lot_code}: ${l.material}` : src ? `New inventory item (duplicate of ${l.lot_code})` : 'New inventory item';
  main.innerHTML = pageHeader(title, editing ? 'Changes are saved with a Reason for Change and your electronic signature, and kept in the audit trail.'
    : 'Fill in what you received, or record a purchase request for something not yet in the lab. Reference Standards and Microbiological Strains must name at least one analyte from the Analytes list.',
  `<a class="btn ghost" href="${editing ? '#/inventory/lots/' + editId : '#/inventory'}">Cancel</a> <button class="btn primary" id="save">${editing ? 'Save changes' : 'Save item'}</button>`) + `
  <div class="itemform">
    ${editing ? '' : `<div class="modeswitch"><label><input type="radio" name="mode" value="received" checked> Received now</label>
      <label><input type="radio" name="mode" value="request"> Purchase request (a Lab Supervisor approves it)</label></div>`}
    <div class="cols">
      <div class="card"><h2>Identity</h2>
        ${fld('Name', inp('f_item_name', v.item_name || v.material), 'As staff call it, e.g. "Sodium Standard 1000 ppm" or "Pipette tips, 1000 µL"', true)}
        ${fld('Type', `<div class="checks" id="f_types">${types.map((t) => `<label><input type="checkbox" value="${esc(t)}" ${(v.chemical_types || []).includes(t) ? 'checked' : ''} ${mixture && t === 'In-house mixture' ? 'disabled' : ''}> ${esc(t)}</label>`).join('')}</div>`, '', true)}
        ${editing || !QA ? '' : fld('QA testing before use', `<label class="checks"><input type="checkbox" id="f_qa"> Send for QA testing before use</label>`, '<span id="qahelp"></span>')}
        ${fld('Solid or liquid', `<div class="checks" id="f_form">${['Solid', 'Liquid'].map((x) => `<label><input type="radio" name="form" value="${x}" ${v.physical_form === x ? 'checked' : ''}> ${x}</label>`).join('')}
          <label><input type="radio" name="form" value="" ${!v.physical_form ? 'checked' : ''}> Not applicable</label></div>`, 'Used to calculate concentrations when the item goes into a mixture')}
        <div class="field"><label>Analytes and concentrations</label><div id="ag"></div>
          <div class="help">Pick from the Analytes list (type to search). A multi-element standard has one line per element. Leave empty for consumables, solvents and plain reagents.</div></div>
        <div class="grid2">${fld('CAS', inp('f_cas_number', v.cas_number), 'Filled in from a single analyte if left empty')}${fld('Catalog #', inp('f_catalog_number', v.catalog_number))}</div>
        <div class="grid2">${fld('Vendor', sel('f_supplier_id', L.supOpts, v.supplier_id))}${fld('Manufacturer', sel('f_manufacturer_id', L.mfrOpts, v.manufacturer_id))}</div>
        ${fld('Web link', inp('f_item_url', v.item_url, 'url', 'placeholder="https://"'), 'The item\'s page on the supplier\'s website (for reordering)')}
        ${fld('Department', sel('f_department_id', L.deptOpts, v.department_id), 'The department whose tests use it: its low stock flags that department\'s waiting samples on the dashboard')}
        ${fld('Waste classification', sel('f_waste_classification_id', L.wasteOpts, v.waste_classification_id), 'How it is disposed of (Admin > Lab setup > Waste classifications). Leave empty to use the default for its type; "classify from the SDS" is listed as needing review.')}
        <div class="grid2">${fld('Storage location', sel('f_storage_location_id', L.locOpts, v.storage_location_id))}${fld('Storage condition', sel('f_storage_condition', M.storage_conditions, v.storage_condition))}</div>
      </div>
      <div class="card"><h2>Quantitative</h2>
        <div class="recv">${fld(mixture ? 'Resource ID' : 'Lot #', mixture ? inp('f_manufacturer_lot_ro', l.lot_code, 'text', 'disabled') : inp('f_manufacturer_lot', v.manufacturer_lot), mixture ? '' : "The manufacturer's lot number")}</div>
        <div class="grid3">${fld('Concentration', inp('f_concentration', v.concentration, 'number'), 'For the item as a whole, e.g. 1.02 N acid')}${fld('Unit', sel('f_concentration_unit', M.conc_units, v.concentration_unit))}${fld('Purity %', inp('f_purity_pct', v.purity_pct, 'number'))}</div>
        <div class="grid3">
          <div class="recv">${fld('Quantity received', inp('f_quantity_received', v.quantity_received, 'number', received ? 'disabled' : ''), received ? 'Locked after receipt: correct stock with an Adjustment' : '', !editing)}</div>
          <div class="req1" style="display:none">${fld('Quantity requested', inp('f_requested_quantity', v.requested_quantity ?? v.quantity_received, 'number'), '', true)}</div>
          ${fld('Unit', sel('f_unit', M.units, v.unit, { attrs: received ? 'disabled' : '' }), '', true)}${fld('Containers', inp('f_container_count', v.container_count, 'number'))}</div>
        <div class="grid2 recv">${fld(mixture ? 'Date made' : 'Received date', inp('f_received_date', d8(v.received_date), 'date'))}${fld('Opened date', inp('f_opened_date', d8(v.opened_date), 'date'))}</div>
        <div class="grid2 recv">${fld('Expiration date', inp('f_expiration_date', d8(v.expiration_date), 'date'))}${fld('Retest date', inp('f_retest_date', d8(v.retest_date), 'date'))}</div>
        ${fld('Notes', `<textarea id="f_notes" rows="2">${esc(v.notes || '')}</textarea>`)}
      </div>
    </div>
    ${editing ? `<div class="card"><h2>Supplier COA</h2><div class="help">COAs for this item are on its page: <a href="#/inventory/lots/${esc(editId)}">${esc(l.lot_code)}</a> (Upload Supplier COA).</div></div>`
    : `<div class="card coanew"><h2>Supplier COA</h2>
      <div class="help">Attach the supplier's Certificate of Analysis (PDF or image, up to 3.5 MB). It is kept with the item exactly as uploaded, with its fingerprint.
        ${M.ai.enabled ? '<b>Read the COA</b> fills in this form from the document; check every value before saving (they are recorded as confirmed by you).'
        : 'Reading the COA automatically is switched off in this Sandbox until IT and QA approve it (the document would be sent to an AI service); type the values from the COA.'}</div>
      <div class="coarow"><input type="file" id="f_coa" accept="application/pdf,image/png,image/jpeg,image/gif,image/webp">${M.ai.enabled ? '<button class="btn" id="readcoa" disabled>Read the COA</button>' : ''}</div>
      <div class="help" id="coamsg"></div></div>`}
  </div>`;
  const q = (id) => main.querySelector('#' + id);
  const startAnalytes = (src ? src.analytes : []).map((a) => ({ analyte_id: a.analyte_id, concentration: a.concentration, concentration_unit: a.concentration_unit,
    target_concentration: a.target_concentration, tolerance_pct: a.tolerance_pct, expressed_as: a.expressed_as, formula_weight: a.formula_weight, analyte_per_unit: a.analyte_per_unit }));
  const ag = new Grid(q('ag'), { rows: startAnalytes.length ? startAnalytes : [], allowAdd: true, newRow: () => ({}), emptyText: 'No analytes: click + Add row.',
    columns: [
      { field: 'analyte_id', title: 'Analyte', type: 'select', options: L.analyteOpts, width: 220 },
      { field: 'concentration', title: 'Concentration', type: 'number', min: 0, width: 110 },
      { field: 'concentration_unit', title: 'Unit', type: 'select', options: M.conc_units, width: 90 },
      { field: 'expressed_as', title: 'Expressed as', width: 100, help: 'Only when the certificate states the concentration as a compound, e.g. NaCl for a sodium standard' },
      { field: 'formula_weight', title: 'Formula wt (g/mol)', type: 'number', min: 0, width: 110, help: 'Formula weight of the compound named in Expressed as, e.g. 58.44 for NaCl' },
      { field: 'analyte_per_unit', title: 'Atoms per formula', type: 'number', min: 0, width: 100, help: 'How many of the analyte are in one formula unit (1 for Na in NaCl, 2 for Na in Na2SO4). Empty = 1' },
    ],
    onChange: () => { // CAS from a single analyte, if not typed
      main.dispatchEvent(new Event('change'));
      const ids = ag.rows.filter((r) => r.analyte_id).map((r) => r.analyte_id);
      if (ids.length === 1 && !q('f_cas_number').value.trim()) { const a = L.analytes.find((x) => x.id === ids[0]); if (a && a.cas_number) q('f_cas_number').value = a.cas_number; }
    } });
  if (!startAnalytes.length && !editing) ag.addRows(1);
  const mode = () => (editing ? 'edit' : main.querySelector('input[name=mode]:checked').value);
  const setMode = () => {
    const req = mode() === 'request';
    main.querySelectorAll('.recv').forEach((x) => { x.style.display = req ? 'none' : ''; });
    main.querySelectorAll('.req1').forEach((x) => { x.style.display = req ? '' : 'none'; });
  };
  main.querySelectorAll('input[name=mode]').forEach((x) => { x.onchange = setMode; }); setMode();
  // QA testing before use (migration 040): ticked by the lab's default for the item's types; anyone may tick it, only QA
  // may untick it when the lab's default asks for it
  let qaTouched = false;
  const qaDefaultTypes = () => (QA ? QA.rows.filter((d) => d.required).map((d) => d.chemical_type) : []);
  const syncQa = () => {
    const box = q('f_qa'); if (!box) return;
    const ticked = [...main.querySelectorAll('#f_types input:checked')].map((x) => x.value);
    const hit = ticked.filter((t) => qaDefaultTypes().includes(t));
    if (!qaTouched) box.checked = hit.length > 0;
    box.disabled = hit.length > 0 && !(who && who.can_qa_configure);
    q('qahelp').innerHTML = hit.length ? `Your lab tests ${esc(hit.join(', '))} before use.${who && who.can_qa_configure ? ' As QA you may receive it without testing.' : ' Only QA can receive it without testing.'}`
      : 'Not required for these types in your lab (Inventory > QA testing). Tick it to test this item before it is used.';
  };
  if (q('f_qa')) { main.querySelectorAll('#f_types input').forEach((x) => x.addEventListener('change', syncQa)); q('f_qa').onchange = () => { qaTouched = true; }; syncQa(); }
  let changed = false;
  main.addEventListener('input', () => { changed = true; }); main.addEventListener('change', () => { changed = true; });
  setDirtyCheck(() => changed); // the analyte grid reports its edits as a change event on the page

  // the Supplier COA, attached on save; with AI reading on, it can fill in the form first (Alex, 2026-10-13)
  let coa = null; let proposal = null; let filled = [];
  const COA_MAP = [['chemical_name', 'f_item_name', true], ['cas_number', 'f_cas_number'], ['catalog_number', 'f_catalog_number'], ['manufacturer_lot', 'f_manufacturer_lot'],
    ['expiration_date', 'f_expiration_date'], ['retest_date', 'f_retest_date'], ['purity_pct', 'f_purity_pct'], ['concentration', 'f_concentration'], ['concentration_unit', 'f_concentration_unit']];
  if (q('f_coa')) q('f_coa').onchange = async (e) => {
    const f = e.target.files[0]; coa = null; proposal = null;
    if (q('readcoa')) q('readcoa').disabled = true;
    if (!f) { q('coamsg').textContent = ''; return; }
    if (f.size > 3.5 * 1024 * 1024) { q('coamsg').textContent = 'The file is larger than 3.5 MB. Save a smaller PDF and choose it again.'; e.target.value = ''; return; }
    coa = { file_name: f.name, mime_type: f.type || 'application/pdf', content_base64: await fileToBase64(f) };
    q('coamsg').textContent = `${f.name} will be attached to the item when you save.`;
    if (q('readcoa')) q('readcoa').disabled = false;
  };
  if (q('readcoa')) q('readcoa').onclick = async () => {
    if (!coa) return;
    const b = q('readcoa'); b.disabled = true; b.textContent = 'Reading…';
    try {
      const r = await api('/inventory/coa/read', { method: 'POST', body: { mime_type: coa.mime_type, content_base64: coa.content_base64 } });
      proposal = r.proposal || null; filled = [];
      for (const [k, id, onlyEmpty] of COA_MAP) {
        const val = proposal && proposal[k]; const el = q(id);
        if (val === null || val === undefined || val === '' || !el || el.disabled || (onlyEmpty && el.value.trim())) continue;
        if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === String(val))) continue;
        el.value = String(val); el.classList.add('aifill'); el.dispatchEvent(new Event('change', { bubbles: true })); filled.push(id);
      }
      if (proposal && proposal.manufacturer_name) {
        const o = L.mfrOpts.find((x) => x.label.toLowerCase().includes(String(proposal.manufacturer_name).toLowerCase()) || String(proposal.manufacturer_name).toLowerCase().includes(x.label.toLowerCase()));
        if (o && !q('f_manufacturer_id').value) { q('f_manufacturer_id').value = o.value; q('f_manufacturer_id').dispatchEvent(new Event('change', { bubbles: true })); filled.push('f_manufacturer_id'); }
      }
      q('coamsg').innerHTML = filled.length ? `Filled in ${filled.length} value${filled.length === 1 ? '' : 's'} from the COA (highlighted): <b>check each one against the document before saving</b>.`
        : 'The COA was read but no values could be filled in; type them from the document.';
    } catch (e) { toast(e.message, 'err'); }
    b.disabled = false; b.textContent = 'Read the COA';
  };

  q('save').onclick = async () => {
    const val = (id) => { const e = q(id); return e && !e.disabled ? e.value.trim() : undefined; };
    const n = (id) => { const x = val(id); return x === undefined ? undefined : x === '' ? null : Number(x); };
    const typesSel = [...main.querySelectorAll('#f_types input:checked')].map((x) => x.value).concat(mixture ? ['In-house mixture'] : []);
    const row = { item_name: val('f_item_name'), chemical_types: [...new Set(typesSel)], physical_form: main.querySelector('input[name=form]:checked')?.value || null,
      cas_number: val('f_cas_number') || null, catalog_number: val('f_catalog_number') || null, supplier_id: val('f_supplier_id') || null, manufacturer_id: val('f_manufacturer_id') || null,
      storage_location_id: val('f_storage_location_id') || null, storage_condition: val('f_storage_condition') || null,
      concentration: n('f_concentration'), concentration_unit: val('f_concentration_unit') || null, purity_pct: n('f_purity_pct'), container_count: n('f_container_count'),
      notes: val('f_notes') || null, item_url: val('f_item_url') || null, department_id: val('f_department_id') || null, waste_classification_id: val('f_waste_classification_id') || null };
    if (!row.item_name) { toast('Enter the item name.', 'err'); q('f_item_name').focus(); return; }
    if (!row.chemical_types.length) { toast('Tick at least one type.', 'err'); return; }
    if (ag.hasErrors()) { toast('Fix the analyte cells marked in red.', 'err'); return; }
    const analytes = ag.rows.filter((r) => r.analyte_id).map((r) => ({ analyte_id: r.analyte_id, concentration: r.concentration ?? null, concentration_unit: r.concentration_unit || null,
      target_concentration: r.target_concentration ?? null, tolerance_pct: r.tolerance_pct ?? null,
      expressed_as: r.expressed_as || null, formula_weight: r.formula_weight ?? null, analyte_per_unit: r.analyte_per_unit ?? null }));
    const request = mode() === 'request';
    if (request) Object.assign(row, { requested_quantity: n('f_requested_quantity'), unit: val('f_unit') || null });
    else {
      Object.assign(row, { manufacturer_lot: mixture ? undefined : val('f_manufacturer_lot') || null, received_date: val('f_received_date') || null, opened_date: val('f_opened_date') || null,
        expiration_date: val('f_expiration_date') || null, retest_date: val('f_retest_date') || null });
      if (!received) Object.assign(row, { quantity_received: n('f_quantity_received'), unit: val('f_unit') || null });
    }
    Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
    if (editing) {
      const ok = await signed({ what: `Changes to ${l.lot_code} ${l.material}`, meaning: 'Changed by' },
        (reason, signature) => api('/inventory/items/' + editId, { method: 'PUT', body: { row, analytes, reason, signature } }));
      if (ok) { setDirtyCheck(null); toast('Saved and signed.'); location.hash = '#/inventory/lots/' + editId; }
    } else {
      // what was saved from the COA's fields is what the person confirmed against it
      const confirmed = coa ? Object.fromEntries(COA_MAP.map(([, id]) => [id.slice(2), row[id.slice(2)]]).filter(([, x]) => x !== undefined && x !== null && x !== '')) : null;
      const r = await signed({ what: `${request ? 'Purchase request' : 'New inventory item'}: ${row.item_name}${coa ? ` (with Supplier COA ${coa.file_name})` : ''}`, meaning: request ? 'Requested by' : 'Created by', needReason: false },
        (reason, signature) => api('/inventory/items', { method: 'POST', body: { row, analytes, request, signature, coa: coa ? { ...coa, proposal, confirmed } : null,
          qa_testing: q('f_qa') ? (q('f_qa').checked ? '1' : '0') : undefined } }));
      if (r) { setDirtyCheck(null); toast(request ? 'Purchase request created and signed.' : 'Item saved and signed.'); location.hash = '#/inventory/lots/' + r.id; }
    }
  };
}

// ================================================================ IN-HOUSE MIXTURE PAGE (calculated concentration)
export async function mixturePage(main) {
  if (!needLab(main)) return;
  const [M, L, rows] = await Promise.all([meta(), lookups(), api('/inventory/lots')]);
  const usable = rows.filter((r) => r.use_eligible);
  // Amount used can be entered in any unit the Unit conversions table links to the lot's unit (e.g. mL of a solvent kept in L)
  const lotUnits = [...new Set(usable.map((r) => r.unit).filter(Boolean))];
  const conv = lotUnits.length ? await api('/units/convertible?units=' + encodeURIComponent(lotUnits.join(','))) : {};
  const unitsFor = (r) => { const l = usable.find((u) => u.id === r.lot_id); return l && l.unit ? [...new Set([l.unit, ...(conv[l.unit] || [])])] : []; };
  const PREFER = { L: 'mL', kg: 'g' }; // how analysts usually measure
  const compOpts = usable.map((r) => ({ value: r.id, label: `${r.lot_code} · ${r.material}${isMixture(r) ? '' : r.manufacturer_lot ? ' · lot ' + r.manufacturer_lot : ''} (${qty(r.on_hand, r.unit)}, exp. ${d8(r.expiration_date) || 'none'})`,
    match: [r.lot_code, r.material] }));
  const extraTypes = M.chemical_types.filter((t) => !['In-house mixture', 'Consumable'].includes(t));
  main.innerHTML = pageHeader('New in-house mixture', 'Pick the component lots and how much of each was used. The quantity made defaults to the total of the components, and the concentration of each analyte is calculated from the components using the Units and Unit conversions tables. The mixture gets a Resource ID (its lab ID) and cannot expire after its earliest-expiring component.',
    '<a class="btn ghost" href="#/inventory">Cancel</a> <button class="btn primary" id="save">Prepare mixture</button>') + `
  <div class="itemform">
    <div class="cols">
      <div class="card"><h2>Identity</h2>
        ${fld('Name', inp('m_name', ''), 'e.g. "Sodium Working Solution 10 ppm"', true)}
        ${fld('Solid or liquid', `<div class="checks">${['Liquid', 'Solid'].map((x) => `<label><input type="radio" name="mform" value="${x}" ${x === 'Liquid' ? 'checked' : ''}> ${x}</label>`).join('')}</div>`, 'Liquid: concentrations per volume (mg/L, ppm). Solid: per mass (mg/kg).', true)}
        ${fld('Also a', `<div class="checks" id="m_types">${extraTypes.map((t) => `<label><input type="checkbox" value="${esc(t)}"> ${esc(t)}</label>`).join('')}</div>`, 'It is always an In-house mixture; tick Reference Standard for a working standard.')}
        <div class="grid2">${fld('Storage location', sel('m_loc', L.locOpts, ''))}${fld('Storage condition', sel('m_cond', M.storage_conditions, ''))}</div>
        <div class="grid2">${fld('Expiration date', inp('m_exp', '', 'date'), 'Empty: the earliest-expiring component')}${fld('Retest date', inp('m_retest', '', 'date'))}</div>
        ${fld('Notes (work instruction)', inp('m_notes', ''))}
      </div>
      <div class="card"><h2>Quantitative</h2>
        <div class="grid2">${fld('Quantity made', inp('m_qty', '', 'number'), '<span id="m_qtyhelp"></span>', true)}${fld('Unit', sel('m_unit', M.units, 'mL', { blank: false }), '', true)}</div>
        <div class="field"><label>Calculated concentration</label><div id="cg"></div><div class="help">Set the unit to report in, and a target ± tolerance to check the result.</div></div>
      </div>
    </div>
    <div class="card">${section('Component lots', 'Only usable lots of this lab are offered (received, in date, not on hold). Each component is drawn from stock when the mixture is prepared.')}<div id="pg"></div></div>
  </div>`;
  const q = (id) => main.querySelector('#' + id);
  let qtyTouched = false; let calc = [];
  const comp = new Grid(q('pg'), { rows: [{}, {}, {}], allowAdd: true, newRow: () => ({}), onChange: (g) => { defaultUnits(g); schedule(); },
    columns: [
      { field: 'lot_id', title: 'Lot', type: 'select', options: compOpts, width: 460 },
      { field: 'quantity', title: 'Amount used', type: 'number', min: 0, width: 110 },
      { field: 'unit', title: 'Unit', type: 'select', width: 70, options: (r) => unitsFor(r), help: 'Any unit the Unit conversions table links to the unit the lot is kept in; converted when the stock is drawn' },
      { field: 'kept', title: 'Lot kept in', type: 'readonly', width: 80, compute: (r) => usable.find((u) => u.id === r.lot_id)?.unit || '' },
      { field: 'type', title: 'Type', type: 'readonly', width: 170, compute: (r) => usable.find((u) => u.id === r.lot_id)?.chemical_types_text || '' },
      { field: 'an', title: 'Analytes', type: 'readonly', width: 220, compute: (r) => usable.find((u) => u.id === r.lot_id)?.analytes_text || '' },
    ] });
  const targets = {}; // analyte id -> { unit, target, tolerance_pct }
  const cg = new Grid(q('cg'), { rows: [], emptyText: 'Add component lots that carry analytes to see their concentration here.',
    onChange: (g) => { g.rows.forEach((r) => { targets[r.analyte_id] = { unit: r.concentration_unit, target: r.target, tolerance_pct: r.tolerance_pct }; }); schedule(); },
    columns: [
      { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 120 },
      { field: 'concentration', title: 'Prepared', type: 'readonly', width: 95, align: 'right', format: (v) => (v === null || v === undefined ? 'Not calculated' : fmtN(v)) },
      { field: 'concentration_unit', title: 'Unit', type: 'select', options: M.conc_units, width: 80 },
      { field: 'target', title: 'Target', type: 'number', min: 0, width: 75 },
      { field: 'tolerance_pct', title: '± %', type: 'number', min: 0, width: 55 },
      { field: 'result', title: 'Result', type: 'readonly', width: 95, compute: (r) => (r.target === null || r.target === undefined || r.target === '' ? '' : r.concentration === null || r.concentration === undefined ? 'Not calculated'
        : Math.abs(r.concentration - r.target) <= r.target * (Number(r.tolerance_pct) || 0) / 100 ? 'Conforms' : 'Alert'), cellClass: (r) => '' },
    ] });
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 250); };
  const form = () => main.querySelector('input[name=mform]:checked').value;
  const components = () => comp.rows.filter((r) => r.lot_id && Number(r.quantity) > 0).map((r) => ({ lot_id: r.lot_id, quantity: Number(r.quantity), unit: r.unit || null }));
  // A newly picked (or scanned) lot gets the unit analysts usually measure it in, if the tables can convert it
  function defaultUnits(g) {
    let n = 0;
    for (const r of g.rows) {
      const ok = unitsFor(r);
      if (r.lot_id && (!r.unit || !ok.includes(r.unit))) { const kept = ok[0]; r.unit = ok.includes(PREFER[kept]) ? PREFER[kept] : kept; n++; }
      if (!r.lot_id && r.unit) { r.unit = null; n++; }
    }
    if (n) g.render();
  }
  async function refresh() {
    const out = Object.fromEntries(Object.entries(targets).filter(([, t]) => t.unit).map(([k, t]) => [k, t.unit]));
    try {
      const p = await api('/inventory/mixtures/preview', { method: 'POST', body: { components: components(), quantity: qtyTouched ? q('m_qty').value : null, unit: q('m_unit').value, form: form(), out_units: out } });
      if (!qtyTouched) q('m_qty').value = p.default_quantity ? Number(p.default_quantity).toFixed(6).replace(/\.?0+$/, '') : '';
      q('m_qtyhelp').textContent = p.default_quantity ? `Defaulted to the total of the components that can be expressed in ${q('m_unit').value}: ${fmtN(p.default_quantity)} ${q('m_unit').value}. Change it if you made it up to a different volume.` : '';
      calc = p.analytes.map((a) => ({ ...a, target: targets[a.analyte_id]?.target ?? null, tolerance_pct: targets[a.analyte_id]?.tolerance_pct ?? null }));
      const editingNow = cg.editing; if (!editingNow) cg.setRows(calc);
      q('cg').title = calc.map((a) => `${a.analyte_name}: ${a.calc_note}`).join('\n');
      if (!q('cgnotes')) q('cg').insertAdjacentHTML('afterend', '<div id="cgnotes" class="calcnote"></div>');
      q('cgnotes').innerHTML = calc.map((a) => `<div>${esc(a.analyte_name)}: ${esc(a.calc_note || '')}</div>`).join('');
    } catch (e) { toast(e.message, 'err'); }
  }
  q('m_qty').addEventListener('input', () => { qtyTouched = q('m_qty').value.trim() !== ''; schedule(); });
  q('m_unit').addEventListener('change', schedule); q('m_unit').addEventListener('input', schedule);
  main.querySelectorAll('input[name=mform]').forEach((x) => { x.onchange = () => { const u = q('m_unit'); if (!qtyTouched) { u.value = form() === 'Solid' ? 'g' : 'mL'; u.dispatchEvent(new Event('change')); } schedule(); }; });
  setDirtyCheck(() => components().length > 0);
  q('save').onclick = async () => {
    const name = q('m_name').value.trim();
    if (!name) { toast('Enter the mixture name.', 'err'); q('m_name').focus(); return; }
    if (!components().length) { toast('Add at least one component lot with the amount used.', 'err'); return; }
    if (comp.hasErrors() || cg.hasErrors()) { toast('Fix the cells marked in red.', 'err'); return; }
    const t = cg.rows.map((r) => ({ analyte_id: r.analyte_id, unit: r.concentration_unit, target: r.target ?? null, tolerance_pct: r.tolerance_pct ?? null }));
    const r = await signed({ what: `In-house mixture ${name}: ${q('m_qty').value} ${q('m_unit').value} from ${components().length} component lot(s)`, meaning: 'Prepared by', needReason: false },
      (reason, signature) => api('/inventory/mixtures/prepare', { method: 'POST', body: { signature, item_name: name, physical_form: form(), chemical_types: [...main.querySelectorAll('#m_types input:checked')].map((x) => x.value),
        quantity: Number(q('m_qty').value), unit: q('m_unit').value, expiration_date: q('m_exp').value || null, retest_date: q('m_retest').value || null,
        storage_location_id: q('m_loc').value || null, storage_condition: q('m_cond').value || null, notes: q('m_notes').value.trim() || null, components: components(), targets: t } }));
    if (r) { setDirtyCheck(null); toast('Mixture prepared and signed.'); location.hash = '#/inventory/lots/' + r.id; }
  };
}

// ================================================================ RECEIVE MANY (paste a packing list)
export async function receiveMany(main) {
  if (!needLab(main)) return;
  const [M, L] = await Promise.all([meta(), lookups()]);
  main.innerHTML = pageHeader('Receive many', 'Paste a packing list from Excel (Name, Type, Solid or liquid, Analyte, Concentration, Unit, Lot #, Quantity, Unit, Expires, …) or add rows, then fill down (Ctrl+D) the location and storage condition. For one item at a time, use + New Inventory Item.',
    '<a class="btn ghost" href="#/inventory">Inventory</a>', { kind: 'inventory' }) + '<div id="g"></div>';
  const types = M.chemical_types.filter((t) => t !== 'In-house mixture');
  const cols = [
    { field: 'item_name', title: 'Name', width: 200, required: true },
    listCol('chemical_types', 'Type', types, 150),
    { field: 'physical_form', title: 'Solid or liquid', type: 'select', options: ['Solid', 'Liquid'], width: 95 },
    { field: 'analyte_id', title: 'Analyte', type: 'select', options: L.analyteOpts, width: 150, help: 'For a standard or strain; one analyte per row here (use the item page for multi-element standards)' },
    { field: 'analyte_concentration', title: 'Analyte conc.', type: 'number', min: 0, width: 90 },
    { field: 'analyte_unit', title: 'Conc. unit', type: 'select', options: M.conc_units, width: 80 },
    { field: 'manufacturer_lot', title: 'Lot #', width: 110 },
    { field: 'quantity_received', title: 'Quantity', type: 'number', min: 0, width: 80 },
    { field: 'unit', title: 'Unit', type: 'select', options: M.units, width: 60 },
    { field: 'expiration_date', title: 'Expires', type: 'date', width: 95 },
    { field: 'storage_location_id', title: 'Location', type: 'select', width: 150, options: L.locOpts },
    { field: 'storage_condition', title: 'Storage condition', type: 'select', width: 150, options: M.storage_conditions },
    { field: 'supplier_id', title: 'Vendor', type: 'select', width: 150, options: L.supOpts },
    { field: 'manufacturer_id', title: 'Manufacturer', type: 'select', width: 150, options: L.mfrOpts },
    { field: 'catalog_number', title: 'Catalog #', width: 100 },
    { field: 'purity_pct', title: 'Purity %', type: 'number', min: 0, max: 100, width: 70 },
    { field: 'cas_number', title: 'CAS', width: 95 },
    { field: 'received_date', title: 'Received on', type: 'date', width: 95 },
  ];
  const g = editableGrid({
    el: main.querySelector('#g'), rows: [], allowAdd: true, what: 'inventory received', emptyText: 'Add rows, or click a cell and paste lines from a packing list.',
    newRow: () => ({}), columns: cols, // received date defaults to today when saved
    sign: (rows) => ({ meaning: 'Received by', action: `Receive many: ${rows.length} item(s)` }),
    save: (changes, reason, signature) => api('/inventory/lots/bulk', { method: 'POST', body: { rows: canonRows(changes, cols), reason, signature } }),
    afterSave: () => { location.hash = '#/inventory'; },
  });
  g.addRows(5);
}

// ================================================================ ONE LOT (as in Alex's mock-up)
function statCard(label, text, cls) { return `<div class="statcard ${cls || ''}"><span>${esc(label)}</span><b>${esc(text)}</b></div>`; }

export async function lot(main, id) {
  const [M, d, who] = await Promise.all([meta(), api('/inventory/lots/' + id), me()]);
  const l = d.lot;
  const isClosed = ['Disposed', 'Cancelled'].includes(l.status);
  const received = l.receipt_status === 'Received';
  const mixture = isMixture(l);
  const btn = (key, label, show, primary) => (show ? `<button class="btn ${primary ? 'primary' : ''}" data-act="${key}">${esc(label)}</button>` : '');
  const qRule = d.rules.find((r) => r.detail.startsWith('Quantity on hand'));
  const eRule = d.rules.find((r) => r.detail.startsWith('Expiration'));
  const days = l.days_to_expiry;
  const expText = !l.expiration_date ? 'No expiry date' : days < 0 ? `${eRule?.result || 'Deficient'}: expired ${-days} day${days === -1 ? '' : 's'} ago` : `${eRule?.result || 'Conforms'}: ${days} day${days === 1 ? '' : 's'} left`;
  const pct = l.pct_remaining;
  const qtyText = !received ? 'Not received yet' : `${qRule?.result || 'Conforms'}: ${pct === null || pct === undefined ? qty(l.on_hand, l.unit) : fmtN(pct) + '% remaining'}`;
  const cls = (r) => (!r ? '' : r.result === 'Alert' ? 'alert' : r.result === 'Deficient' ? 'deficient' : r.result === 'Conforms' ? 'conforms' : '');
  // Analyte-eligible (vault: Inventory Lot): a Reference Standard or Microbiological Strain that names its analyte
  const eligible = (l.chemical_types || []).some((t) => ['Reference Standard', 'Microbiological Strain'].includes(t)) && Number(l.analyte_count) > 0;
  const typesBadges = (l.chemical_types || []).map((t) => `<span class="badge w-info">${esc(t)}</span>`).join('') + (eligible ? '<span class="badge w-ok">Analyte-eligible</span>' : '');
  main.innerHTML = `<div class="eyebrow">${esc(l.lot_code)} · ${esc(l.site_code)}</div>` + pageHeader(l.material, `<span class="chips2">${typesBadges}</span> ${badge(received ? l.status : l.receipt_status)}`,
    `<a class="btn ghost" href="#/inventory">All items</a> <a class="btn" href="#/inventory/new?from=${l.id}">Duplicate</a>
     <button class="btn" data-act="reorder" ${mixture || l.status === 'Cancelled' ? 'disabled title="A mixture is prepared, not ordered"' : ''}>Reorder</button>
     <a class="btn primary" href="#/inventory/lots/${l.id}/edit">Edit</a>`, { kind: 'lot', id }) + `
    <div class="actbar">
      ${btn('approve', 'Approve request', l.receipt_status === 'Requested' && !isClosed && who.can_approve, true)}
      ${btn('ordered', 'Mark as ordered', l.receipt_status === 'Approved' && !isClosed && who.can_order, true)}
      ${btn('receive', 'Receive', ['Ordered', 'In Transit'].includes(l.receipt_status) && !isClosed, true)}
      ${btn('use', 'Record usage', l.use_eligible)}
      ${btn('adjust', 'Adjust stock', received && !isClosed)}
      ${btn('coa', 'Upload Supplier COA', !isClosed && !mixture)}
      ${btn('transfer', 'Transfer to another lab', received && !isClosed)}
      ${btn('cancel', 'Cancel request', !received && !isClosed)}
      ${btn('dispose', 'Dispose', received && !isClosed)}
      ${btn('qualify', /^Rejected$/.test(l.qa_status || '') ? 'Retest…' : 'Send for QA testing…', received && !isClosed && who.can_qualify && !/In QA testing|retest under way/.test(l.qa_status || ''), ['Awaiting QA testing', 'Rejected'].includes(l.qa_status))}
      ${btn('waiveqa', 'Waive QA testing…', l.qa_status === 'Awaiting QA testing' && !d.qualifications.length && !isClosed && who.can_qa_configure)}
      ${btn('labels', 'Print label', received && !isClosed)}
    </div>
    ${l.qa_required ? `<div class="mqbox ${/^Released/.test(l.qa_status) ? 'ok' : /^Rejected/.test(l.qa_status) ? 'bad' : ''}"><b>QA testing: ${esc(l.qa_status)}.</b>
      ${l.qa_status === 'Awaiting QA testing' ? `${l.qa_default ? 'Your lab tests this type of item before use.' : 'This lot was marked for QA testing when it was received.'} It cannot be used until it passes. Use <b>Send for QA testing</b> to choose the QA test and what it is released for (every use, or a named test); a test sample with this lot's ID goes to the backlog.`
        : l.qa_status === 'In QA testing' ? `Its test sample ${l.sample_id ? link('#/samples/' + l.sample_id, l.lot_code) : esc(l.lot_code)} is being tested. The lot cannot be used until QA approves the result.`
        : l.qa_status === 'Released for every use' ? 'Released for every use by the QA testing below.'
        : l.qa_status === 'Released for named tests' ? 'Released for the tests below only: the bench refuses it for any other test, and it cannot go into a mixture.'
        : l.qa_status === 'Rejected, retest under way' ? `Rejected; its retest is being tested (sample ${l.sample_id ? link('#/samples/' + l.sample_id, l.lot_code) : esc(l.lot_code)}). It stays blocked for every use until the retest passes.`
        : 'Rejected: blocked for every use. QA can send it for a <b>Retest</b>, or <b>Dispose</b> of it (or return it to the supplier, noting that as the reason).'}<div id="mqg" style="margin-top:8px"></div></div>` : ''}
    ${l.receipt_status === 'Requested' && !who.can_approve ? '<div class="notice">Waiting for a Lab Supervisor to approve this request.</div>' : ''}
    ${d.purchase ? `<div class="notice">Purchase request ${link('#/purchasing/requests/' + d.purchase.id, d.purchase.line_code)}: ${esc(d.purchase.status)}${d.purchase.po_code ? ` on ${esc(d.purchase.po_code)}${d.purchase.external_po_number ? ' (PO ' + esc(d.purchase.external_po_number) + ')' : ''}` : ''}. Approval, ordering and receiving are also done in Purchasing.</div>` : ''}
    ${l.not_usable_because && !isClosed ? `<div class="notice">Not usable: ${esc(l.not_usable_because)}.</div>` : ''}
    <div class="statcards">
      ${statCard('Purchase status', mixture ? 'N/A: in-house' : l.receipt_status + (l.approved_by_name ? ` (approved by ${l.approved_by_name})` : ''), '')}
      ${statCard('Expiration', expText, cls(eRule))}
      ${statCard('Quantity on hand', qtyText, received ? cls(qRule) : '')}
    </div>
    <div class="cols">
      <div class="card"><h2>Identity</h2>${kv([
        ['Analytes', d.analytes.length ? d.analytes.map((a) => link('#/analytes?find=' + encodeURIComponent(a.analyte_code), a.analyte_name) + (a.analyte_cas ? ` (CAS ${esc(a.analyte_cas)})` : '')).join(', ') : ''],
        ['CAS', esc(l.cas_display)],
        [mixture ? 'Resource ID' : 'Lot #', esc(mixture ? `${l.lot_code} (system-generated)` : l.manufacturer_lot)],
        mixture ? ['Prepared by', esc(l.created_by_name)] : ['Vendor', esc(l.supplier_name)],
        mixture ? null : ['Manufacturer', esc(l.manufacturer_name)], mixture ? null : ['Catalog #', esc(l.catalog_number)],
        ['Department', esc(l.department_name || '')],
        ['Waste', l.waste ? `${esc(l.waste.waste_name)}${l.waste.needs_review ? ' <span class="bad">to classify from the SDS</span>' : ''}` : '<span class="bad">none</span>'],
        mixture ? null : ['Web link', l.item_url ? `<a href="${esc(l.item_url)}" target="_blank" rel="noopener">${esc(l.item_url.replace(/^https?:\/\//, '').slice(0, 60))}</a>` : ''],
        ['Solid or liquid', esc(l.physical_form)],
        ['Storage location', locLink(l.storage_location_id, l.location_code, l.location_path)], ['Storage condition', esc(l.storage_condition)],
        ['Came from', l.transferred_from_code ? link('#/inventory/lots/' + l.transferred_from_lot_id, `${l.transferred_from_code} (${l.transferred_from_site})`) : (l.reorder_of_code ? 'Reorder of ' + link('#/inventory/lots/' + l.reorder_of_lot_id, l.reorder_of_code) : '')],
      ])}</div>
      <div class="card"><h2>Quantitative</h2>${kv([
        ['Concentration', esc(l.conc_display)], ['Purity / potency', l.purity_pct === null ? '' : esc(fmtN(l.purity_pct) + '%')],
        [mixture ? 'Prepared quantity' : 'Received quantity', esc(received ? qty(l.quantity_received, l.unit) : `${qty(l.requested_quantity, l.unit)} requested`)],
        ['Quantity on hand', `<b>${esc(qty(l.on_hand, l.unit))}</b>${l.negative_stock ? ' <span class="bad">negative: reconcile with a stock count</span>' : ''}`],
        [mixture ? 'Date made' : 'Received date', esc(d8(l.received_date))], ['Expiration date', esc(d8(l.expiration_date)) + (mixture && l.expiration_date ? ' <span class="help">(not after the earliest component)</span>' : '')],
        ['Retest date', esc(d8(l.retest_date))], ['Opened date', esc(d8(l.opened_date))], ['Notes', esc(l.notes)],
      ])}</div>
      ${l.waste ? `<div class="card" id="wastecard"><h2>Waste and disposal</h2>${kv([
        ['Classification', `${esc(l.waste.waste_code)} ${esc(l.waste.waste_name)}${l.waste.needs_review ? ' <span class="bad">to classify: read the SDS, then choose its classification (Edit)</span>' : ''}`],
        ['Hazard classes', esc(String(l.waste.hazard_classes || '').replace(/[{}"]/g, '').replace(/,/g, ', '))], ['EPA waste codes', esc(l.waste.epa_codes)],
        ['Waste stream', esc(l.waste.waste_stream)], ['Container', esc(l.waste.container)], ['How to dispose of it', esc(l.waste.disposal_instructions)], ['Keep away from', esc(l.waste.segregation)],
      ])}</div>` : ''}
    </div>
    ${d.analytes.length ? `<div class="card">${section(mixture ? 'Calculated concentration' : 'Analytes', mixture ? 'Calculated from the component lots when the mixture was prepared, using the Units and Unit conversions tables.' : '')}<div id="ang"></div></div>` : ''}
    <div class="card">${section('Threshold rules applied')}<div class="rulelist">${d.rules.length ? d.rules.map((r) => `<div class="rule"><span><b>${esc(r.rule_name)}</b><br><span class="help">${esc(r.detail)}</span></span><span class="res-${esc(r.result)}">${esc(r.result)}</span></div>`).join('') : '<p class="help">No warning rules apply.</p>'}</div></div>
    ${mixture ? `<div class="card">${section('Component lots', 'The lots this mixture was prepared from. Each was drawn from stock when the mixture was made.')}<div id="cg"></div></div>` : ''}
    ${d.usedIn.length ? `<div class="card">${section('Used to prepare')}<div id="ug"></div></div>` : ''}
    ${d.related.length ? `<div class="card">${section('Linked lots')}${d.related.map((x) => `<div>${esc(x.relation)} ${link('#/inventory/lots/' + x.id, `${x.lot_code} (${x.site_code})`)} ${badge(x.receipt_status === 'Received' ? x.status : x.receipt_status)}</div>`).join('')}</div>` : ''}
    ${mixture ? '' : `<div class="card">${section('Supplier COA', 'The uploaded document is kept exactly as uploaded, with its SHA-256 fingerprint. Values read from it (by a person, or proposed by AI) are only saved to the lot when a person confirms them.')}<div id="coag"></div></div>`}
    <div id="lotlb"></div>
    <div class="card">${section('Stock movements', 'Append-only. Corrections are recorded as Adjustments with a reason.')}<div id="mg"></div></div>
    <div class="lotfoot">${mixture ? 'Prepared' : 'Received'} ${esc(d8(l.received_date) || '—')}${mixture ? ' by ' + esc(l.created_by_name || '') : ''} · Last modified ${esc(dt(l.modified_at))} by ${esc(l.modified_by_name || '')} · Audit trail: the clock icon next to the name</div>`;
  lotCard(main.querySelector('#lotlb'), l.id);   // logbook entries about the lot (L-1/L-2, migrations 034-035)

  if (d.analytes.length) new Grid(main.querySelector('#ang'), { readOnly: true, rows: d.analytes, columns: [
    { field: 'analyte_name', title: 'Analyte', type: 'link', width: 150, href: (r) => '#/analytes?find=' + encodeURIComponent(r.analyte_code) },
    { field: 'analyte_cas', title: 'CAS', type: 'readonly', width: 95 },
    { field: 'concentration', title: mixture ? 'Prepared concentration' : 'Concentration', type: 'readonly', width: 150, format: (v, r) => (v === null || v === undefined ? (mixture ? 'Not calculated' : '') : `${fmtN(v)} ${r.concentration_unit || ''}`) },
    { field: 'target_concentration', title: 'Target', type: 'readonly', width: 140, format: (v, r) => (v === null || v === undefined ? '' : `${fmtN(v)} ${r.concentration_unit} ± ${fmtN(r.tolerance_pct || 0)}%`) },
    { field: 'conformance', title: 'Result', type: 'readonly', width: 100, cellClass: (r) => (r.conformance === 'Alert' ? 'cwarn' : '') },
    { field: 'calc_note', title: 'How', type: 'readonly', width: 420 }] });
  if (mixture) new Grid(main.querySelector('#cg'), { readOnly: true, rows: d.components, emptyText: 'No components recorded.', columns: [
    { field: 'lot_code', title: 'Lot', type: 'link', width: 100, href: (r) => '#/inventory/lots/' + r.component_lot_id },
    { field: 'material', title: 'Name', type: 'readonly', width: 230 }, { field: 'chemical_types_text', title: 'Type', type: 'readonly', width: 160 },
    { field: 'quantity_used', title: 'Amount used', type: 'readonly', width: 170, format: (v, r) => (r.entered_unit && r.entered_unit !== r.unit ? `${qty(r.entered_quantity, r.entered_unit)} (= ${qty(v, r.unit)})` : qty(v, r.unit)) },
    { field: 'manufacturer_lot', title: 'Lot #', type: 'readonly', width: 110 }, { field: 'expiration_date', title: 'Expires', type: 'readonly', width: 100, format: d8 }] });
  if (d.usedIn.length) new Grid(main.querySelector('#ug'), { readOnly: true, rows: d.usedIn, columns: [
    { field: 'lot_code', title: 'Mixture', type: 'link', width: 100, href: (r) => '#/inventory/lots/' + r.id },
    { field: 'material', title: 'Name', type: 'readonly', width: 300 }, { field: 'quantity_used', title: 'Used', type: 'readonly', width: 90, format: (v) => qty(v, l.unit) },
    { field: 'expiration_date', title: 'Expires', type: 'readonly', width: 100, format: d8 }, { field: 'status', title: 'Status', type: 'readonly', width: 90 }] });
  if (!mixture) new Grid(main.querySelector('#coag'), { readOnly: true, rows: d.coas, emptyText: 'No Supplier COA uploaded yet.', columns: [
    { field: 'file_name', title: 'Document', type: 'link', width: 200, href: () => '#', onClick: (r) => window.open(coaUrl(r.id), '_blank') },
    { field: 'extraction_method', title: 'How values were read', type: 'readonly', width: 190 },
    { field: 'values_confirmed', title: 'Values confirmed', type: 'readonly', width: 260, format: (v) => (v ? Object.entries(v).map(([k, x]) => `${k.replace(/_/g, ' ')}: ${x}`).join('; ') : 'Not confirmed yet') },
    { field: 'confirmed_by_name', title: 'Confirmed by', type: 'readonly', width: 140, format: (v, r) => (v ? `${v} ${dt(r.confirmed_at)}` : '') },
    { field: 'uploaded_by', title: 'Uploaded', type: 'readonly', width: 150, format: (v, r) => `${v} ${dt(r.created_at)}` },
    { field: 'sha256', title: 'SHA-256', type: 'readonly', width: 120, format: (v) => (v ? v.slice(0, 12) + '…' : '') },
    { field: 'review', title: '', type: 'button', width: 90, label: (r) => (r.values_confirmed ? 'View' : 'Review'), onClick: (r) => coaReview(r, l, () => lot(main, id)) }] });
  if (main.querySelector('#mqg') && d.qualifications.length) new Grid(main.querySelector('#mqg'), { readOnly: true, rows: d.qualifications, columns: [
    { field: 'qualification_code', title: 'QA testing', type: 'readonly', width: 110, format: (v, r) => v + (r.retest_of_id ? ' (retest)' : '') },
    { field: 'use_test_name', title: 'Released for', type: 'readonly', width: 240 },
    { field: 'qualification_test_name', title: 'QA test', type: 'readonly', width: 230 },
    { field: 'status', title: 'Status', type: 'readonly', width: 90, cellClass: (r) => (r.status === 'Failed' ? 'cbad' : r.status === 'Testing' ? 'cwarn' : '') },
    { field: 'batch_code', title: 'Batch', type: 'link', width: 105, href: (r) => (r.batch_id ? '#/testing/batches/' + r.batch_id : null) },
    { field: 'decision_note', title: 'Decision', type: 'readonly', width: 330, format: (v, r) => (v ? `${v}${r.decided_by_name ? ' (' + r.decided_by_name + ', ' + dt(r.decided_at) + ')' : ''}` : 'Waiting for the test and QA\'s review') }] });
  new Grid(main.querySelector('#mg'), { readOnly: true, rows: d.movements, emptyText: 'No stock movements yet.', columns: [
    { field: 'txn_at', title: 'When', type: 'readonly', width: 140, format: dt },
    { field: 'txn_type', title: 'Movement', type: 'readonly', width: 100 },
    { field: 'quantity_change', title: 'Quantity', type: 'readonly', width: 90, align: 'right', format: (v) => (v > 0 ? '+' : '') + qty(v) },
    { field: 'running_total', title: 'On hand after', type: 'readonly', width: 100, align: 'right', format: (v) => qty(v, l.unit) },
    { field: 'reference', title: 'Reference', type: 'readonly', width: 230 },
    { field: 'related_code', title: 'Related lot', type: 'link', width: 110, href: (r) => (r.related_id ? '#/inventory/lots/' + r.related_id : null), format: (v, r) => (v ? `${v}${r.related_site && r.related_site !== l.site_code ? ' (' + r.related_site + ')' : ''}` : '') },
    { field: 'reason', title: 'Reason', type: 'readonly', width: 160 }, { field: 'by_name', title: 'By', type: 'readonly', width: 130 }] });

  const reload = () => lot(main, id);
  const name = `${l.lot_code} ${l.material}`;
  const post = (path, body) => (reason, signature) => api(path, { method: 'POST', body: { ...body, reason: reason || body.reason, signature } });
  const act = async (key) => {
    try {
      let done = null;
      if (key === 'approve') done = await signed({ what: `Approve purchase request ${name}`, meaning: 'Approved by', needReason: false }, post(`/inventory/lots/${id}/purchase-status`, { receipt_status: 'Approved' }));
      if (key === 'ordered') done = await signed({ what: `Mark ${name} as ordered`, meaning: 'Ordered by', needReason: false }, post(`/inventory/lots/${id}/purchase-status`, { receipt_status: 'Ordered' }));
      if (key === 'receive') done = await receiveDialog(M, l);
      if (key === 'use') { await usageDialog([l], () => {}); done = true; }
      if (key === 'adjust') {
        const v = await modal({ title: `Adjust stock: ${l.lot_code}`, okText: 'Next: sign', intro: `On hand now: ${esc(qty(l.on_hand, l.unit))}. Enter the change (negative to reduce), for example after a stock count.`,
          fields: [{ name: 'quantity', label: `Change (${l.unit})`, type: 'number', required: true }] });
        if (!v) return;
        done = await signed({ what: `Stock adjustment ${name}: ${Number(v.quantity) > 0 ? '+' : ''}${v.quantity} ${l.unit || ''}`, meaning: 'Adjusted by' },
          post('/inventory/movements', { rows: [{ lot_id: id, txn_type: 'Adjustment', quantity: Number(v.quantity) }] }));
      }
      if (key === 'coa') { const r = await coaUpload(l); if (!r) return; reload(); const fresh = await api('/inventory/lots/' + id); const c = fresh.coas.find((x) => x.id === r.id); if (c) coaReview(c, fresh.lot, reload, r); return; }
      if (key === 'reorder') { await reorderDialog(l, reload); return; }
      if (key === 'labels') { await printLabels('lot', [id]); return; }
      if (key === 'qualify') { if (await qualifyDialog({ ...l })) reload(); return; }
      if (key === 'waiveqa') done = await signed({ what: `Waive QA testing of ${name}: it can be used without being tested`, meaning: 'Approved by' }, post(`/inventory/lots/${id}/waive-qa`, {}));
      if (key === 'transfer') {
        const sites = (await api('/inventory/sites')).filter((s) => s.id !== l.site_id);
        const v = await modal({ title: `Transfer ${l.lot_code} to another lab`, okText: 'Next: sign',
          intro: `The quantity leaves ${esc(l.site_code)} now. The receiving lab gets a new lot (same item, manufacturer lot, expiry, analytes and Supplier COA) marked In Transit, and receives it like any new lot.`,
          fields: [{ name: 'to_site_id', label: 'To lab', type: 'select', options: sites.map((s) => ({ value: s.id, label: `${s.site_code} ${s.site_name}` })), required: true },
            { name: 'quantity', label: `Quantity (${l.unit})`, type: 'number', required: true }, { name: 'notes', label: 'Notes' }] });
        if (!v) return;
        const to = sites.find((s) => s.id === v.to_site_id);
        done = await signed({ what: `Transfer ${v.quantity} ${l.unit || ''} of ${name} to ${to ? to.site_code : 'another lab'}`, meaning: 'Transferred by', needReason: false },
          post(`/inventory/lots/${id}/transfer`, { ...v, quantity: Number(v.quantity) }));
        if (done) toast('Transferred. The receiving lab will see it In Transit.');
      }
      if (key === 'cancel') done = await signed({ what: `Cancel purchase request ${name}`, meaning: 'Cancelled by' }, post(`/inventory/lots/${id}/cancel`, {}));
      if (key === 'dispose') done = await signed({ what: `Dispose of ${name} (${qty(l.on_hand, l.unit)} will be written off)${l.waste ? ` as ${l.waste.waste_name}${l.waste.waste_stream ? ' (' + l.waste.waste_stream + ')' : ''}` : ''}`, meaning: 'Disposed by' }, post(`/inventory/lots/${id}/dispose`, {}));
      if (!done) return;
      if (['approve', 'ordered', 'adjust', 'cancel', 'dispose'].includes(key)) toast({ approve: 'Request approved and signed.', ordered: 'Marked as ordered and signed.', adjust: 'Adjustment recorded and signed.', cancel: 'Request cancelled and signed.', dispose: 'Lot disposed and signed.' }[key]);
      reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  main.querySelectorAll('[data-act]').forEach((b) => { b.onclick = () => act(b.dataset.act); });
}

async function receiveDialog(M, l) {
  const L = await lookups();
  const v = await modal({ title: `Receive ${l.lot_code}: ${l.material}`, okText: 'Receive',
    intro: l.receipt_status === 'In Transit' ? `Transferred from ${esc(l.transferred_from_code || '')} (${esc(l.transferred_from_site || '')}). Check what arrived and where it is stored.` : 'Fill in what arrived. This completes the same lot; it does not create a second one.',
    fields: [
      { name: 'quantity', label: `Quantity received (${l.unit || ''})`, type: 'number', value: l.quantity_received ?? l.requested_quantity, required: true },
      { name: 'manufacturer_lot', label: 'Lot #', value: l.manufacturer_lot || '' },
      { name: 'expiration_date', label: 'Expiration date', type: 'date', value: d8(l.expiration_date) },
      { name: 'retest_date', label: 'Retest date', type: 'date', value: d8(l.retest_date) },
      { name: 'storage_location_id', label: 'Storage location', type: 'select', options: L.locOpts, value: l.storage_location_id || '' },
      { name: 'received_date', label: 'Received on', type: 'date', value: today() },
    ] });
  if (!v) return false;
  const ok = await signed({ what: `Receive ${l.lot_code} ${l.material}: ${v.quantity} ${l.unit || ''}`, meaning: 'Received by', needReason: false },
    (reason, signature) => api(`/inventory/lots/${l.id}/receive`, { method: 'POST', body: { ...v, quantity: Number(v.quantity), signature } }));
  if (ok) toast('Received and signed. The lot is now usable (if in date).');
  return !!ok;
}

// Opened in a new tab: the session cookie says who is asking; the lab comes in the link
function coaUrl(id) { return `/api/inventory/coa/${id}/file?s=${encodeURIComponent(state.site || '')}`; }

async function coaUpload(l) {
  const M = await meta();
  return new Promise((resolve) => {
    const m = document.createElement('div'); m.className = 'modal-bg';
    m.innerHTML = `<div class="modal wide"><h3>Upload Supplier COA: ${esc(l.lot_code)} ${esc(l.material)}</h3>
      <p class="intro">PDF or image, up to about 3.5 MB. The file is stored unchanged with its SHA-256 fingerprint.</p>
      ${M.ai.enabled ? `<div class="aiflag">AI reading is on (${esc(M.ai.model)}): the document is sent to Anthropic's API, which proposes the values. You check every value before anything is saved.</div>
        <label class="cb"><input type="checkbox" id="useai" checked> Let AI propose the values</label>`
        : '<div class="aiflag">AI reading is off in this Sandbox (no API key set). You will type the values beside the document; nothing changes about the record keeping.</div>'}
      <div class="field"><input type="file" id="f" accept="application/pdf,image/png,image/jpeg"></div><div class="merr"></div>
      <div class="mbtns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Upload</button></div></div>`;
    document.body.appendChild(m);
    const close = (v) => { m.remove(); resolve(v); };
    m.querySelector('[data-x]').onclick = () => close(null);
    m.querySelector('[data-ok]').onclick = async () => {
      const file = m.querySelector('#f').files[0];
      if (!file) { m.querySelector('.merr').textContent = 'Choose the COA file.'; return; }
      if (file.size > 3.5 * 1024 * 1024) { m.querySelector('.merr').textContent = 'The file is larger than 3.5 MB. Save a smaller PDF and try again.'; return; }
      const b = m.querySelector('[data-ok]'); b.disabled = true; b.textContent = M.ai.enabled ? 'Uploading and reading…' : 'Uploading…';
      const body = { file_name: file.name, mime_type: file.type || 'application/pdf', content_base64: await fileToBase64(file), use_ai: !!m.querySelector('#useai')?.checked };
      const r = await signed({ what: `Supplier COA ${file.name} for ${l.lot_code} ${l.material}`, meaning: 'Uploaded by', needReason: false },
        (reason, signature) => api(`/inventory/lots/${l.id}/coa`, { method: 'POST', body: { ...body, signature } }));
      if (!r) { b.disabled = false; b.textContent = 'Upload'; return; }
      if (r.aiError) toast(r.aiError + ' Type the values instead.', 'err');
      close(r);
    };
  });
}

// Side by side: the document, and the values to confirm (AI proposal or the lot's current values)
async function coaReview(c, l, done) {
  const FIELDS = [['manufacturer_lot', 'Lot #', 'text'], ['expiration_date', 'Expiration date', 'date'], ['retest_date', 'Retest date', 'date'],
    ['purity_pct', 'Purity %', 'number'], ['concentration', 'Concentration', 'number'], ['concentration_unit', 'Concentration unit', 'text'], ['catalog_number', 'Catalog number', 'text']];
  const p = c.ai_proposed || {}; const conf = c.values_confirmed;
  const curOf = (k) => (k.endsWith('_date') ? d8(l[k]) : l[k] ?? '');
  const valOf = (k) => (conf ? conf[k] ?? '' : (p[k] !== null && p[k] !== undefined ? p[k] : curOf(k)));
  const isImg = /^image\//.test(c.mime_type || '');
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal xwide"><h3>Supplier COA: ${esc(c.file_name)}</h3>
    ${c.ai_proposed ? `<div class="aiflag">Values proposed by AI (${esc(c.ai_model || '')}). Check each against the document. Fields that differ from the lot are highlighted. ${p.chemical_name ? `The COA names <b>${esc(p.chemical_name)}</b>${p.cas_number ? ` (CAS ${esc(p.cas_number)})` : ''}${p.manufacturer_name ? `, made by ${esc(p.manufacturer_name)}` : ''}: check it matches ${esc(l.material)}.` : ''}</div>` : ''}
    <div class="coa-review">${isImg ? `<img src="${coaUrl(c.id)}" alt="Supplier COA">` : `<iframe src="${coaUrl(c.id)}" title="Supplier COA"></iframe>`}
      <div class="coa-fields">${FIELDS.map(([k, label, t]) => {
        const v = valOf(k); const cur = curOf(k); const differs = String(v ?? '') !== String(cur ?? '');
        return `<div class="cf ${differs ? 'diff' : ''}"><label for="cf_${k}">${esc(label)}</label><input id="cf_${k}" type="${t}" ${t === 'number' ? 'step="any"' : ''} value="${esc(v ?? '')}" ${conf ? 'disabled' : ''}>
          ${p.evidence && p.evidence[k] ? `<div class="ev">On the COA: “${esc(p.evidence[k])}”</div>` : ''}${differs ? `<div class="cur">On the lot now: ${esc(cur === '' ? 'empty' : cur)}</div>` : ''}</div>`; }).join('')}
        ${conf ? `<p class="help">Confirmed by ${esc(c.confirmed_by_name || '')} ${dt(c.confirmed_at)}.</p>` : '<p class="help">Confirming asks for your reason and electronic signature (Verified by).</p>'}
      </div></div><div class="merr"></div>
    <div class="mbtns"><button class="btn ghost" data-x>${conf ? 'Close' : 'Cancel'}</button>${conf ? '' : '<button class="btn primary" data-ok>Confirm and save to the lot</button>'}</div></div>`;
  document.body.appendChild(m);
  const close = () => { m.remove(); };
  m.querySelector('[data-x]').onclick = close;
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  const ok = m.querySelector('[data-ok]');
  if (ok) ok.onclick = async () => {
    const values = Object.fromEntries(FIELDS.map(([k, , t]) => { const v = m.querySelector('#cf_' + k).value.trim(); return [k, v === '' ? null : t === 'number' ? Number(v) : v]; }));
    const r = await signed({ what: `Supplier COA values for ${l.lot_code} ${l.material}`, meaning: 'Verified by' },
      (reason, signature) => api(`/inventory/coa/${c.id}/confirm`, { method: 'POST', body: { values, reason, signature } }));
    if (r) { toast('Values confirmed, signed and saved to the lot.'); close(); done(); }
  };
}

// ================================================================ STORAGE LOCATION PAGE
export async function locationPage(main, id) {
  const d = await api('/inventory/locations/' + id);
  const l = d.location;
  main.innerHTML = `<div class="eyebrow">${esc(l.site_code)} · ${esc(l.path || '')}</div>` + pageHeader(`${l.location_code}: ${l.location_name}`,
    `${esc(l.location_type)} ${badge(l.status)}${l.holds_samples ? ' <span class="badge w-info">Holds samples</span>' : ''}`,
    '<a class="btn ghost" href="#/inventory/locations">All locations</a>', { kind: 'location', id }) + `
    <div class="cols"><div class="card"><h2>Location</h2>${kv([
      ['Code', esc(l.location_code)], ['Inside', l.parent_location_id ? link('#/inventory/locations/' + l.parent_location_id, l.parent_code) : 'Top level'],
      ['Full path', esc(l.path)], ['Conditions it provides', esc((l.supported_conditions || []).join(', ') || 'Not checked (none listed)')],
      ['Holds samples', l.holds_samples ? 'Yes' : 'No']])}</div>
    <div class="card"><h2>Inside this location</h2><div id="chg"></div></div></div>
    <div class="card">${section(`Inventory stored here (${d.lots.length})`)}<div id="lg"></div></div>
    ${d.samples.length || l.holds_samples ? `<div class="card">${section(`Samples stored here (${d.samples.length})`)}<div id="sg"></div></div>` : ''}`;
  new Grid(main.querySelector('#chg'), { readOnly: true, rows: d.children, emptyText: 'Nothing inside.', columns: [
    { field: 'location_code', title: 'Code', type: 'link', width: 110, href: (r) => '#/inventory/locations/' + r.id },
    { field: 'location_name', title: 'Name', type: 'readonly', width: 180 }, { field: 'lot_count', title: 'Lots', type: 'readonly', width: 50 }, { field: 'sample_count', title: 'Samples', type: 'readonly', width: 65 }] });
  new Grid(main.querySelector('#lg'), { readOnly: true, rows: d.lots, emptyText: 'No open lots here.', columns: [
    { field: 'lot_code', title: 'ID', type: 'link', width: 100, href: (r) => '#/inventory/lots/' + r.id }, { field: 'material', title: 'Name', type: 'readonly', width: 240 },
    { field: 'storage_condition', title: 'Condition', type: 'readonly', width: 160 },
    { field: 'amount', title: 'Amount', type: 'readonly', width: 90, compute: (r) => (r.receipt_status === 'Received' ? qty(r.on_hand, r.unit) : r.receipt_status), cellClass: amt },
    { field: 'expiration_date', title: 'Exp date', type: 'readonly', width: 95, format: d8, cellClass: exp }] });
  if (main.querySelector('#sg')) new Grid(main.querySelector('#sg'), { readOnly: true, rows: d.samples, emptyText: 'No samples here.', columns: [
    { field: 'sample_code', title: 'Sample ID', type: 'link', width: 125, href: (r) => '#/samples/' + r.id }, { field: 'client_name', title: 'Client', type: 'readonly', width: 180 },
    { field: 'retained_quantity', title: 'Retained', type: 'readonly', width: 90, format: (v, r) => qty(v, r.retained_unit) }] });
}

// ================================================================ SAMPLE STORAGE
export async function samples(main) {
  if (!needLab(main)) return;
  const [M, L, rows] = await Promise.all([meta(), lookups(), api('/inventory/samples')]);
  main.innerHTML = pageHeader(`Sample storage: ${currentSite().site_code}`, 'Where each logged sample is kept and how much retained sample is left. A client retest needs retained sample, so low retains are flagged (never blocked). Select a block and press Ctrl+D to shelve many samples at once.',
    '', { kind: 'samplestorage' }) + tabs('#/inventory/samples') + `<div class="invbar"><span class="sp"></span>${bulkButtons('samplestorage')}</div><div id="g"></div>`;
  wireBulk(main, { done: () => samples(main) });
  editableGrid({
    el: main.querySelector('#g'), rows, search: true, filter: state.query.get('find') || '', what: 'sample storage and retained quantity',
    emptyText: 'No logged samples in this lab yet.',
    rowClass: (r) => (r.retain_used_up ? 'mutedrow' : ''),
    columns: [
      { field: 'sample_code', title: 'Sample ID', type: 'link', width: 125, href: (r) => '#/samples/' + r.id },
      { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 120 },
      { field: 'description', title: 'Description', type: 'readonly', width: 180 },
      { field: 'client_name', title: 'Client', type: 'readonly', width: 160 },
      { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
      { field: 'received', title: 'Received', type: 'readonly', width: 85, compute: (r) => qty(r.quantity_received, r.quantity_unit) },
      { field: 'loc', title: 'Code', type: 'link', width: 90, compute: (r) => r.location_code || '', href: (r) => (r.storage_location_id ? '#/inventory/locations/' + r.storage_location_id : null), help: 'Opens the storage location' },
      { field: 'storage_location_id', title: 'Location', type: 'select', width: 210, options: L.sampleLocOpts },
      { field: 'storage_condition', title: 'Storage condition', type: 'select', width: 160, options: M.storage_conditions },
      { field: 'retained_quantity', title: 'Retained', type: 'number', min: 0, width: 80 },
      { field: 'retained_unit', title: 'Unit', width: 55, help: 'Defaults to the unit the sample was received in' },
      { field: 'flag', title: 'Retain', type: 'readonly', width: 110, compute: (r) => (r.retain_used_up ? 'Used up' : r.retain_low ? 'Low' : r.retained_quantity === null || r.retained_quantity === undefined ? '' : 'OK') },
    ],
    sign: (rows) => ({ meaning: 'Changed by', action: `Sample storage: ${rows.length} sample(s)` }),
    save: (changes, reason, signature) => api('/inventory/samples/bulk', { method: 'POST', body: { rows: changes, reason, signature } }),
    afterSave: () => samples(main),
  });
}

// ================================================================ LISTS
function readOnlyNote(who) {
  return who.can_maintain ? '' : '<div class="notice">You can view this list. Lab Supervisors, QA, General Managers and administrators maintain it.</div>';
}

export async function suppliers(main) {
  const [M, rows] = await Promise.all([meta(), api('/inventory/suppliers')]);
  const canEdit = can('purchasing.suppliers'); // QA and General Managers by default (migration 011)
  main.innerHTML = pageHeader('Suppliers and manufacturers', 'Shared by every lab. Whether each supplier is approved for your lab, and its qualification history, is on Purchasing > Suppliers (click a code).', '', { kind: 'suppliers' })
    + tabs('#/inventory/suppliers') + (canEdit ? '' : '<div class="notice">You can view this list. Changing it needs the purchasing.suppliers permission (QA and General Managers by default).</div>')
    + `<div class="invbar"><span class="sp"></span>${bulkButtons('suppliers')}</div><div id="g"></div>`;
  wireBulk(main, { done: () => suppliers(main) });
  editableGrid({
    el: main.querySelector('#g'), rows, allowAdd: canEdit, readOnly: !canEdit, search: true, filter: state.query.get('find') || '', what: 'the Supplier list',
    newRow: () => ({ status: 'Active', supplier_type: 'Supplier and Manufacturer' }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'supplier_code', title: 'Code', type: 'link', width: 85, href: (r) => (r.id ? '#/purchasing/suppliers/' + r.id : null) },
      { field: 'supplier_name', title: 'Name', required: true, width: 230 },
      { field: 'supplier_type', title: 'Type', type: 'select', options: M.supplier_types, width: 190 },
      { field: 'account_number', title: 'Our account #', width: 110 }, { field: 'contact_name', title: 'Contact', width: 130 },
      { field: 'website', title: 'Website', width: 170 }, { field: 'email', title: 'Email', width: 200 }, { field: 'phone', title: 'Phone', width: 110 },
      { field: 'address', title: 'Address', width: 200 }, { field: 'notes', title: 'Notes', width: 160 }, { field: 'lot_count', title: 'Lots', type: 'readonly', width: 50 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
    ],
    sign: (rows) => ({ meaning: 'Changed by', action: `Supplier list: ${rows.length} row(s)` }),
    save: (r, reason, signature) => api('/inventory/suppliers/bulk', { method: 'POST', body: { rows: r, reason, signature } }),
    afterSave: () => suppliers(main),
  });
}

export async function locations(main) {
  if (!needLab(main)) return;
  const [M, rows, who] = await Promise.all([meta(), api('/inventory/locations'), me()]);
  const parentOpts = (r) => rows.filter((x) => x.id && x.id !== r.id).map((x) => ({ value: x.id, label: `${x.location_code}: ${x.path}`, match: [x.location_code] }));
  const cond = listCol('supported_conditions', 'Conditions it provides', M.storage_conditions, 260);
  main.innerHTML = pageHeader(`Storage locations: ${currentSite().site_code}`, 'Nested locations (building, room, fridge, shelf) with the storage conditions each provides. A lot or sample is refused in a location that does not provide the condition it needs. Tick "Holds samples" for retain shelves and fridges. Click a code to see what is stored there.',
    '', { kind: 'locations' }) + tabs('#/inventory/locations') + readOnlyNote(who) + `<div class="invbar"><span class="sp"></span>${bulkButtons('locations')}</div><div id="g"></div>`;
  wireBulk(main, { done: () => locations(main) });
  const cols = [
    { field: 'location_code', title: 'Code', required: true, width: 110, editable: (r, isNew) => isNew, href: (r) => (r.id ? '#/inventory/locations/' + r.id : null) },
    { field: 'location_name', title: 'Name', required: true, width: 180 },
    { field: 'location_type', title: 'Type', type: 'select', options: M.location_types, width: 110 },
    { field: 'parent_location_id', title: 'Inside', type: 'select', options: parentOpts, width: 220 },
    cond,
    { field: 'holds_samples', title: 'Holds samples', type: 'bool', width: 95 },
    { field: 'path', title: 'Full path', type: 'readonly', width: 240 },
    { field: 'lot_count', title: 'Lots', type: 'readonly', width: 50 }, { field: 'sample_count', title: 'Samples', type: 'readonly', width: 65 },
    { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
  ];
  editableGrid({
    el: main.querySelector('#g'), rows, allowAdd: who.can_maintain, readOnly: !who.can_maintain, search: true, filter: state.query.get('find') || '', what: 'storage locations',
    newRow: () => ({ status: 'Active', location_type: 'Shelf', supported_conditions: [], holds_samples: false }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: cols,
    sign: (rows) => ({ meaning: 'Changed by', action: `Storage locations: ${rows.length} row(s)` }),
    save: (r, reason, signature) => api('/inventory/locations/bulk', { method: 'POST', body: { rows: canonRows(r, cols), reason, signature } }),
    afterSave: () => locations(main),
  });
}

export async function thresholds(main) {
  const [M, rows, who, sites] = await Promise.all([meta(), api('/inventory/thresholds'), me(), api('/inventory/sites')]);
  main.innerHTML = pageHeader('Warning rules', 'When to warn about low stock, expiry and low retained sample. Warnings never block work. Leave Lab empty for every lab.',
    '', { kind: 'thresholds' }) + tabs('#/inventory/thresholds') + readOnlyNote(who) + `<div class="invbar"><span class="sp"></span>${bulkButtons('thresholds')}</div><div id="g"></div>`
    + '<p class="help">Lot Quantity and Sample Retain: Percentage of Base (below this % of the amount received) or Absolute Max-Min (below this amount). Lot Expiry: Days Until/Since (warn this many days before expiry). On a lot page each rule shows Conforms, Alert or Deficient (out of stock or expired).</p>';
  wireBulk(main, { done: () => thresholds(main) });
  editableGrid({
    el: main.querySelector('#g'), rows, allowAdd: who.can_maintain, readOnly: !who.can_maintain, what: 'warning rules',
    newRow: () => ({ status: 'Active' }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'rule_name', title: 'Rule', required: true, width: 300 },
      { field: 'subject', title: 'Watches', type: 'select', options: M.threshold_subjects, width: 120, required: true },
      { field: 'rule_type', title: 'Type', type: 'select', width: 160, required: true,
        options: (r) => (r && r.subject === 'Lot Expiry' ? ['Days Until/Since'] : r && r.subject ? ['Percentage of Base', 'Absolute Max-Min'] : M.threshold_types) },
      { field: 'value', title: 'Value', type: 'number', min: 0, width: 80, required: true },
      { field: 'site_id', title: 'Lab', type: 'select', options: sites.map((s) => ({ value: s.id, label: s.site_code })), width: 80 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
    ],
    sign: (rows) => ({ meaning: 'Changed by', action: `Warning rules: ${rows.length} row(s)` }),
    save: (r, reason, signature) => api('/inventory/thresholds/bulk', { method: 'POST', body: { rows: r, reason, signature } }),
    afterSave: () => thresholds(main),
  });
}

// ================================================================ ADMIN: job roles, Units, Unit conversions

const canUnits = () => can('master.units');
const unitsNote = () => (canUnits() ? '' : '<div class="notice">You can view this list. People with the Units permission (QA and administrators by default) maintain it.</div>');

export async function units(main) {
  const [M, rows] = await Promise.all([meta(), api('/units')]);
  main.innerHTML = pageHeader('Units', 'Admin. The controlled list of units used for quantities and concentrations everywhere in the system. Maintained by QA and administrators; every change is audited. A unit already used on inventory keeps its code: set it Inactive and add a new one instead.',
    '', { kind: 'units' }) + unitsNote() + `<div class="invbar"><a class="btn ghost" href="#/admin/conversions">Unit conversions</a><span class="sp"></span>${bulkButtons('units')}</div><div id="g"></div>`;
  wireBulk(main, { done: () => { META = null; units(main); } });
  editableGrid({
    el: main.querySelector('#g'), rows, allowAdd: canUnits(), readOnly: !canUnits(), search: true, filter: state.query.get('find') || '', what: 'the Units list',
    newRow: () => ({ status: 'Active', sort_order: 200 }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'unit_code', title: 'Code', required: true, width: 100, editable: (r, isNew) => isNew || !Number(r.used_count) },
      { field: 'unit_name', title: 'Name', required: true, width: 260 },
      { field: 'dimension', title: 'Measures', type: 'select', options: M.dimensions, width: 140, required: true },
      { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
      { field: 'is_serving_unit', title: 'Serving unit', type: 'bool', width: 95, help: 'Offered when a sample\'s serving is entered (e.g. 2 capsules, 1 scoop)' },
      { field: 'conversion_count', title: 'Conversions', type: 'readonly', width: 95 },
      { field: 'used_count', title: 'Used on lots', type: 'readonly', width: 95 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
    ],
    sign: (rows) => ({ meaning: 'Changed by', action: `Units list: ${rows.length} row(s)` }),
    save: (r, reason, signature) => api('/units/bulk', { method: 'POST', body: { rows: r, reason, signature } }),
    afterSave: () => { META = null; units(main); },
  });
}

export async function conversions(main) {
  const [rows, unitRows] = await Promise.all([api('/unit-conversions'), api('/units')]);
  const uOpts = unitRows.filter((u) => u.status === 'Active').map((u) => ({ value: u.id, label: u.unit_code, match: [u.unit_name] }));
  main.innerHTML = pageHeader('Unit conversions', 'Admin. How units convert: 1 [From] = Factor × [To]. Conversions work in both directions and can be chained (for example µg/mL → mg/L → g/L), so only one conversion per pair is needed. ppm-type conversions apply to liquids or to solids only. Maintained by QA and administrators; every change is audited.',
    '', { kind: 'conversions' }) + unitsNote() + `<div class="invbar"><a class="btn ghost" href="#/admin/units">Units</a><span class="sp"></span>${bulkButtons('conversions')}</div>
    <div class="card"><h2>Try a conversion</h2><div class="invbar"><input id="c_v" type="number" step="any" value="1" style="width:90px" class="gsearch">
      <select id="c_f">${unitRows.map((u) => `<option>${esc(u.unit_code)}</option>`).join('')}</select> to <select id="c_t">${unitRows.map((u) => `<option>${esc(u.unit_code)}</option>`).join('')}</select>
      <select id="c_form"><option value="">Any</option><option>Liquid</option><option>Solid</option></select><button class="btn" id="c_go">Convert</button><b id="c_out"></b></div></div>
    <div id="g"></div>`;
  wireBulk(main, { done: () => conversions(main) });
  main.querySelector('#c_go').onclick = async () => {
    const f = main.querySelector('#c_f').value; const t = main.querySelector('#c_t').value; const v = Number(main.querySelector('#c_v').value);
    const r = await api(`/units/convert?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}&form=${encodeURIComponent(main.querySelector('#c_form').value)}`);
    main.querySelector('#c_out').textContent = r.factor === null || r.factor === undefined ? 'Cannot convert with the current table' : `${fmtN(v)} ${f} = ${fmtN(v * r.factor)} ${t}`;
  };
  editableGrid({
    el: main.querySelector('#g'), rows, allowAdd: canUnits(), readOnly: !canUnits(), search: true, what: 'unit conversions',
    newRow: () => ({ status: 'Active', applies_to: 'Any' }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'from_unit_id', title: 'From', type: 'select', options: uOpts, width: 100, required: true },
      { field: 'factor', title: 'Factor', type: 'number', min: 0, width: 140, required: true },
      { field: 'to_unit_id', title: 'To', type: 'select', options: uOpts, width: 100, required: true },
      { field: 'applies_to', title: 'Applies to', type: 'select', options: ['Any', 'Liquid', 'Solid'], width: 90 },
      { field: 'assumption', title: 'Assumption', width: 320 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 },
    ],
    sign: (rows) => ({ meaning: 'Changed by', action: `Unit conversions: ${rows.length} row(s)` }),
    save: (r, reason, signature) => api('/unit-conversions/bulk', { method: 'POST', body: { rows: r, reason, signature } }),
    afterSave: () => conversions(main),
  });
}

// ================================================================ QA TESTING BEFORE USE (migration 040)
// Which item types the lab tests before use (QA keeps the list, with a reason), and the lots waiting for or failing it
export async function qaTesting(main) {
  if (!needLab(main)) return;
  const d = await api('/inventory/qa-defaults');
  const site = currentSite();
  main.innerHTML = pageHeader(`QA testing before use: ${site.site_code}`, 'Items of the types ticked here are quarantined when they are received: they cannot be used at the bench or in a mixture until a QA test, run on a sample carrying the lot\'s ID, releases them (for every use, or for named tests). A lot that fails is rejected for every use until a retest passes. Any item can also be sent for QA testing from its page.',
    '', { kind: 'qa_testing' }) + tabs('#/inventory/qa-testing')
    + (d.can_edit ? '' : '<div class="notice">You can view these settings. QA keeps them (inventory.qa_configure).</div>')
    + `<div class="card">${section('Item types tested before use', 'Changing a type affects items received from now on. Items already received keep their status; a lot can still be sent for QA testing, or QA can waive it, from the lot\'s page.')}<div id="g"></div></div>
    <div class="card">${section('Lots waiting for QA testing, being tested, or rejected', 'Open a lot to send it for QA testing, retest it or dispose of it.')}<div id="lg"></div></div>`;
  editableGrid({
    el: main.querySelector('#g'), rows: d.rows, allowAdd: false, readOnly: !d.can_edit, what: 'QA testing defaults',
    columns: [
      { field: 'chemical_type', title: 'Item type', type: 'readonly', width: 190 },
      { field: 'required', title: 'Tested before use', type: 'bool', width: 130, help: 'Tick for the types your lab tests before use (fill down with Ctrl+D)' },
      { field: 'note', title: 'Note (e.g. the SOP)', width: 300 },
      { field: 'waiting', title: 'Lots waiting', type: 'readonly', width: 100, align: 'right' },
      { field: 'modified_by_name', title: 'Last changed by', type: 'readonly', width: 160, format: (v, r) => `${v || ''} ${r.modified_at ? new Date(r.modified_at).toLocaleDateString() : ''}` },
    ],
    save: (rows, reason) => api('/inventory/qa-defaults', { method: 'POST', body: { rows, reason } }),
    afterSave: () => qaTesting(main),
  });
  new Grid(main.querySelector('#lg'), { readOnly: true, rows: d.lots, search: true, emptyText: 'No lot is waiting for QA testing.',
    onRowOpen: (r) => { location.hash = '#/inventory/lots/' + r.id; },
    columns: [
      { field: 'lot_code', title: 'ID', type: 'link', width: 100, href: (r) => '#/inventory/lots/' + r.id },
      { field: 'material', title: 'Name', type: 'readonly', width: 260 },
      { field: 'manufacturer_lot', title: 'Lot#', type: 'readonly', width: 120 },
      { field: 'chemical_types_text', title: 'Type', type: 'readonly', width: 170 },
      { field: 'received_date', title: 'Received', type: 'readonly', width: 100, format: d8 },
      { field: 'qa_status', title: 'QA testing', type: 'readonly', width: 200, cellClass: (r) => qaCls(r.qa_status) },
    ] });
}
