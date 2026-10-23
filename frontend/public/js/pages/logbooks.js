// Electronic logbooks (L-1, migration 034; L-2, migration 035). Testing > Logbooks (the lab's logbooks and what is
// due), a logbook's page (Entries, Record entries in a grid signed once, Design versions approved by QA, Equipment
// covered with limits per unit), an entry's page (values against their limits, the failure and the batches and
// stability studies it flags, the results that used it, correct / return / approve / void) and QA > Logbook review
// (approve entries, signed; overdue first).
import { api, esc, pageHeader, toast, modal, signDialog, askReason, state, badge, link, setDirtyCheck } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, section } from './common.js';

const css = document.createElement('style');
css.textContent = `
.lb-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px 18px; margin: 4px 0 6px; }
.lb-facts div { font-size: 13px; } .lb-facts b { display: block; font-size: 11px; color: var(--muted); font-weight: 600; text-transform: none; }
.lb-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.lb-bar label { font-size: 12px; color: var(--muted); display: inline-flex; gap: 6px; align-items: center; }
.lb-due { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 2px; }
.lb-due span { border: 1px solid #F1C27D; background: #FFF6E5; color: #8A5300; border-radius: 999px; padding: 3px 10px; font-size: 12px; }
.lb-due span.ok { border-color: #BFE3CF; background: #EEF8F2; color: #1F6B45; }
.lb-fail td { background: #FDF0EF; }
.lb-probs { margin: 4px 0 0; padding-left: 18px; } .lb-probs li { color: var(--err-ink); }
.lb-probs li.Warning { color: var(--warn-ink); } .lb-probs li.ok { color: #1F6B45; list-style: none; margin-left: -18px; }
.lb-vals { border-collapse: collapse; width: 100%; max-width: 900px; } .lb-vals th, .lb-vals td { text-align: left; padding: 5px 10px; border-bottom: 1px solid #EEF1F3; font-size: 13px; }
.lb-vals th { background: #F0F3F5; font-weight: 600; } .lb-vals td.out { color: var(--err-ink); font-weight: 700; } .lb-vals td.in { color: #1F6B45; }
.lb-failbox { border: 1px solid #F3B9B3; background: #FDF0EF; border-radius: 8px; padding: 10px 14px; margin: 10px 0; }
.lb-note { color: var(--muted); font-size: 12.5px; }
.lb-set { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px 18px; }
.lb-set .field { margin: 0; } .lb-set input, .lb-set select, .lb-set textarea { width: 100%; }
`;
document.head.appendChild(css);

const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const loc = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');   // a lab-local timestamp as stored
const fmtN = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v); if (!Number.isFinite(n)) return String(v);
  if (n !== 0 && (Math.abs(n) >= 1e6 || Math.abs(n) < 1e-3)) return n.toExponential(3).replace('e+', ' x 10^').replace('e-', ' x 10^-');
  return String(Number(n.toPrecision(6)));
};
const showVal = (f, v) => (v === null || v === undefined || v === '' ? '' : typeof v === 'number' || ['Number', 'Calculated'].includes(f.field_type) ? fmtN(v) + (f.unit ? ' ' + f.unit : '') : String(v));
const ABOUT = { Equipment: 'a piece of equipment', Lot: 'an inventory lot', Sample: 'a sample', None: 'nothing in particular (one per day, week...)' };
const KINDS = ['Equipment check', 'Temperature', 'Culture', 'Inoculum', 'Control', 'Sample weights', 'General'];
const TYPES = ['Number', 'Text', 'Choice', 'Pass/Fail', 'Date/time', 'Equipment', 'Lot', 'Calculated'];

// ---------------------------------------------------------------- formulas and limits in the browser (a preview only:
// the database calculates and judges every entry when it is saved)
function evalFormula(formula, vals) {
  let ok = true;
  const expr = String(formula || '').replace(/\{([a-z][a-z0-9_]*)(\.[a-z][a-z0-9_]*)?\}/g, (m, k, sub) => {
    if (sub) { ok = false; return '0'; }
    const v = vals[k]; if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) { ok = false; return '0'; }
    return '(' + Number(v) + ')';
  });
  if (!ok || !/^[\s0-9+\-*/^().,eEa-z_]*$/.test(expr)) return null;
  return calcExpr(expr);
}
// A small arithmetic evaluator for the live preview (0.33.0: the page runs under a Content-Security-Policy that
// forbids building code from text, so no Function()). Numbers, + - * / ^, brackets and the functions below.
// The database recalculates every value when the entry is saved; this is only what the screen shows meanwhile.
const CALC_FN = { log10: Math.log10, ln: Math.log, sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, min: Math.min, max: Math.max, power: Math.pow };
function calcExpr(src) {
  const t = String(src).match(/\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|[a-z_][a-z0-9_]*|[-+*/^(),]/gi) || [];
  if (t.join('') !== String(src).replace(/\s+/g, '')) return null;
  let k = 0;
  const peek = () => t[k]; const next = () => t[k++];
  const expect = (x) => { if (next() !== x) throw new Error('syntax'); };
  function atom() {
    const x = next();
    if (x === undefined) throw new Error('syntax');
    if (x === '(') { const v = sum(); expect(')'); return v; }
    if (/^[\d.]/.test(x)) return Number(x);
    if (CALC_FN[x.toLowerCase()]) {
      expect('('); const args = [sum()];
      while (peek() === ',') { next(); args.push(sum()); }
      expect(')'); return CALC_FN[x.toLowerCase()](...args);
    }
    throw new Error('syntax');
  }
  function power() { const b = atom(); if (peek() === '^') { next(); return Math.pow(b, unary()); } return b; }
  function unary() { if (peek() === '-') { next(); return -unary(); } if (peek() === '+') { next(); return unary(); } return power(); }
  function product() { let v = unary(); while (peek() === '*' || peek() === '/') { const op = next(); const r = unary(); v = op === '*' ? v * r : v / r; } return v; }
  function sum() { let v = product(); while (peek() === '+' || peek() === '-') { const op = next(); const r = product(); v = op === '+' ? v + r : v - r; } return v; }
  try { const r = sum(); if (k !== t.length) return null; return Number.isFinite(r) ? r : null; } catch (_) { return null; }
}
function limitsFor(f, eqRow) {
  let lo = f.limit_min ?? null; let hi = f.limit_max ?? null;
  if (f.equipment_limits && eqRow) {
    const l = (eqRow.limits || {})[f.field_key];
    if (l) return { lo: l.min ?? null, hi: l.max ?? null };
    if (eqRow.temperature_c !== null && eqRow.temperature_c !== undefined && f.field_key === 'temperature') return { lo: Number(eqRow.temperature_c) - Number(eqRow.temperature_tol || 0), hi: Number(eqRow.temperature_c) + Number(eqRow.temperature_tol || 0) };
    if (eqRow.humidity_pct !== null && eqRow.humidity_pct !== undefined && f.field_key === 'humidity') return { lo: Number(eqRow.humidity_pct) - Number(eqRow.humidity_tol || 0), hi: Number(eqRow.humidity_pct) + Number(eqRow.humidity_tol || 0) };
  }
  return { lo: lo === null ? null : Number(lo), hi: hi === null ? null : Number(hi) };
}
// entries from the sensor feed (0.25.0): when they cover, and whether a person still has to give the reason
const tloc = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
const sensorWhen = (x) => (!x.sensor ? null : x.sensor.kind === 'Hour' ? (x.sensor.summary || {}).label || tloc(x.sensor.start)
  : `${tloc(x.sensor.start)} to ${x.sensor.end ? new Date(x.sensor.end).toLocaleTimeString([], { timeStyle: 'short' }) : 'now'}`);
const needsReason = (x) => x.result === 'Fail' && !x.failure_reason && x.status !== 'Voided';
const limText = (l) => (l.lo !== null && l.hi !== null ? `${fmtN(l.lo)} to ${fmtN(l.hi)}` : l.lo !== null ? `at least ${fmtN(l.lo)}` : l.hi !== null ? `at most ${fmtN(l.hi)}` : '');
// what a row would be: its calculated values and what is outside a limit
function judge(fields, row, eqRow) {
  const vals = {}; const probs = [];
  for (const f of fields) {
    let v = row['f_' + f.field_key];
    if (f.field_type === 'Calculated') { v = evalFormula(f.formula, vals); if (v !== null) vals[f.field_key] = v; }
    else if (f.field_type === 'Number') { if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) vals[f.field_key] = Number(v); }
    if (f.field_type === 'Pass/Fail' && String(v || '').toLowerCase().startsWith('f')) probs.push(`${f.label}: Fail`);
    if (['Number', 'Calculated'].includes(f.field_type) && vals[f.field_key] !== undefined) {
      const l = limitsFor(f, eqRow); const n = vals[f.field_key];
      if (l.lo !== null && n < l.lo) probs.push(`${f.label} ${fmtN(n)}${f.unit ? ' ' + f.unit : ''} is below ${fmtN(l.lo)}`);
      if (l.hi !== null && n > l.hi) probs.push(`${f.label} ${fmtN(n)}${f.unit ? ' ' + f.unit : ''} is above ${fmtN(l.hi)}`);
    }
  }
  return { vals, probs };
}

// ================================================================ Testing > Logbooks
export async function list(main) {
  const d = await api('/logbooks');
  main.innerHTML = pageHeader('Logbooks', 'Equipment checks, temperatures, cultures, inocula, daily controls and sample weights, recorded in a grid and signed once. QA approves each logbook\'s entries daily or weekly; a failed entry on a piece of equipment flags the batches that used it in QC Review.',
    `${d.can_review ? `<a class="btn" href="#/logbooks/review">Logbook review (${d.to_review}${d.overdue ? `, ${d.overdue} overdue` : ''})</a>` : ''}${d.can_design ? '<button class="btn primary" id="new">+ New logbook</button>' : ''}`, { kind: 'logbooks' })
    + `${d.due.length ? `<div class="card"><h3 style="margin:0 0 6px">Due now</h3><div class="lb-note">Entries the lab owes today, this week or this month (a Daily, Weekly or Monthly logbook, per piece of equipment it covers).</div><div id="due"></div></div>` : ''}
      <div class="card"><div id="g"></div></div>`;
  if (d.due.length) {
    new Grid(main.querySelector('#due'), { readOnly: true, rows: d.due.map((x, i) => ({ ...x, key: i })), keyField: 'key',
      columns: [
        { field: 'logbook_code', title: 'Logbook', type: 'link', width: 90, href: (x) => `#/logbooks/${x.logbook_id}?tab=record` },
        { field: 'logbook_name', title: 'Name', type: 'readonly', width: 260 },
        { field: 'entry_frequency', title: 'Due', type: 'readonly', width: 90 },
        { field: 'equipment_code', title: 'Equipment', type: 'link', width: 260, href: (x) => (x.equipment_id ? '#/equipment/' + x.equipment_id : null), compute: (x) => (x.equipment_id ? `${x.equipment_code} ${x.equipment_name}` : '(the logbook)') },
        { field: 'last_entry_at', title: 'Last entry', type: 'readonly', width: 170, format: (v) => (v ? dt(v) : 'none yet') },
      ] });
  }
  new Grid(main.querySelector('#g'), { readOnly: true, rows: d.rows, search: true, emptyText: 'No logbooks yet.', rowClass: (x) => (x.status !== 'Active' ? 'mutedrow' : ''),
    columns: [
      { field: 'logbook_code', title: 'Logbook', type: 'link', width: 90, href: (x) => '#/logbooks/' + x.id },
      { field: 'logbook_name', title: 'Name', type: 'readonly', width: 280 },
      { field: 'kind', title: 'Kind', type: 'readonly', width: 130 },
      { field: 'subject', title: 'About', type: 'readonly', width: 100, format: (v, x) => (v === 'Equipment' ? `${x.equipment_count} unit${x.equipment_count === 1 ? '' : 's'}` : v === 'None' ? '-' : v) },
      { field: 'entry_frequency', title: 'Entries', type: 'readonly', width: 90 },
      { field: 'review_frequency', title: 'QA review', type: 'readonly', width: 90 },
      { field: 'effective_version', title: 'Design', type: 'readonly', width: 120, compute: (x) => (x.effective_version ? `v${x.effective_version}` : 'not approved') + (x.draft_version ? ` (v${x.draft_version} draft)` : '') },
      { field: 'to_review', title: 'To approve', type: 'readonly', width: 90, align: 'right', cellClass: (x) => (x.overdue ? 'tbfail' : '') , format: (v, x) => (v ? `${v}${x.overdue ? ` (${x.overdue} late)` : ''}` : '') },
      { field: 'due_now', title: 'Due now', type: 'readonly', width: 75, align: 'right', format: (v) => v || '' , cellClass: (x) => (x.due_now ? 'tbwait' : '') },
      { field: 'last_entry_at', title: 'Last entry', type: 'readonly', width: 160, format: (v) => dt(v) },
      { field: 'status', title: 'Status', type: 'readonly', width: 80 },
    ] });
  const nb = main.querySelector('#new');
  if (nb) nb.onclick = () => newLogbook();
}

async function newLogbook() {
  const r = await modal({ title: 'New logbook', okText: 'Create', wide: true,
    intro: 'The design (its fields and limits) is added next and approved by QA before entries can be recorded. These settings can be changed later, with a reason.',
    fields: [
      { name: 'logbook_name', label: 'Name', required: true },
      { name: 'kind', label: 'Kind', type: 'select', blank: false, value: 'Equipment check', options: KINDS },
      { name: 'subject', label: 'Each entry is about', type: 'select', blank: false, value: 'Equipment', options: [{ value: 'Equipment', label: 'A piece of equipment' }, { value: 'Lot', label: 'An inventory lot' }, { value: 'Sample', label: 'A sample (weighed aliquots)' }, { value: 'None', label: 'Nothing in particular' }] },
      { name: 'entry_frequency', label: 'Entries due', type: 'select', blank: false, value: 'Daily', options: ['Daily', 'Weekly', 'Monthly', 'As needed'] },
      { name: 'review_frequency', label: 'QA approves the entries', type: 'select', blank: false, value: 'Weekly', options: ['Daily', 'Weekly'] },
      { name: 'signing', label: 'Entries are', type: 'select', blank: false, value: 'Signature', options: [{ value: 'Signature', label: 'Signed (user ID and password)' }, { value: 'Recorded', label: 'Recorded (no signature)' }] },
      { name: 'description', label: 'What it is for', type: 'textarea' },
    ] });
  if (!r) return;
  if (r.kind === 'Sample weights') { r.subject = 'Sample'; r.review_route = 'Batch'; }
  try { const x = await api('/logbooks', { method: 'POST', body: r }); toast(`${x.logbook_code} created: add its fields, then QA approves the design.`); location.hash = `#/logbooks/${x.id}?tab=design`; }
  catch (e) { toast(e.message, 'err'); }
}

// ================================================================ a logbook
export async function page(main, id) {
  const q = state.query;
  const qs = new URLSearchParams(); for (const k of ['from', 'to', 'equipment', 'status']) if (q.get(k)) qs.set(k, q.get(k));
  const d = await api(`/logbooks/${id}${qs.toString() ? '?' + qs : ''}`);
  const l = d.logbook;
  const eff = d.fields.filter((f) => f.version_id === d.effective_id);
  const draftF = d.fields.filter((f) => f.version_id === d.draft_id);
  const tab = q.get('tab') || (d.effective_id ? 'entries' : 'design');
  const dueN = d.due.filter((x) => x.due).length;
  const tabs = [['entries', `Entries <small>${d.entries.length}${d.entries.length >= 500 ? '+' : ''}</small>`], ...(d.can_record && d.effective_id && l.status === 'Active' ? [['record', `Record entries${dueN ? ` <small>${dueN} due</small>` : ''}`]] : []),
    ['design', `Design <small>${d.effective_id ? 'v' + l.effective_version : 'not approved'}${d.draft_id ? ', draft' : ''}</small>`], ...(l.subject === 'Equipment' ? [['equipment', `Equipment covered <small>${d.equipment.length}</small>`]] : [])];
  main.innerHTML = pageHeader(`${l.logbook_code} ${l.logbook_name}`,
    `${esc(l.kind)} logbook about ${esc(ABOUT[l.subject] || l.subject)}. Entries ${l.entry_frequency === 'As needed' ? 'as needed' : 'due ' + l.entry_frequency.toLowerCase()}; QA approves them ${l.review_route === 'Batch' ? 'in the batch that uses them' : l.review_frequency.toLowerCase()}; entries are ${l.signing === 'Signature' ? 'signed' : 'recorded without a signature'}.${l.validity_hours ? ` An entry can be used for ${fmtN(l.validity_hours)} h.` : ''}${l.creates_lot ? ' Each entry makes an inventory lot.' : ''}`,
    '', { kind: 'logbook', id: l.id })
    + `<div class="tabs">${tabs.map(([k, t]) => `<a class="tab ${k === tab ? 'on' : ''}" href="#/logbooks/${l.id}?tab=${k}">${t}</a>`).join('')}</div><div id="body"></div>`;
  const body = main.querySelector('#body');
  if (tab === 'record') return recordTab(body, d, l, eff);
  if (tab === 'design') return designTab(body, d, l, eff, draftF);
  if (tab === 'equipment') return equipmentTab(body, d, l, d.draft_id ? draftF : eff);
  return entriesTab(body, d, l);
}

function entriesTab(body, d, l) {
  const q = state.query;
  const allFields = [...d.fields.filter((f) => f.version_id === d.effective_id), ...d.old_fields];
  const keys = []; for (const f of allFields) if (!keys.find((k) => k.field_key === f.field_key)) keys.push(f);
  const due = d.due.filter((x) => x.due);
  body.innerHTML = `<div class="card">
      ${d.due.length ? `<div class="lb-due">${d.due.map((x) => `<span class="${x.due ? '' : 'ok'}">${esc(x.equipment_code ? x.equipment_code + ' ' + x.equipment_name : l.logbook_code)}: ${x.due ? 'due ' + (l.entry_frequency === 'Daily' ? 'today' : l.entry_frequency === 'Weekly' ? 'this week' : 'this month') : 'done'}</span>`).join('')}</div>` : ''}
      <div class="lb-bar">
        <label>From <input type="date" id="f_from" value="${esc(q.get('from') || '')}"></label><label>To <input type="date" id="f_to" value="${esc(q.get('to') || '')}"></label>
        ${l.subject === 'Equipment' ? `<label>Equipment <select id="f_eq"><option value="">All</option>${d.equipment.map((e) => `<option value="${e.equipment_id}" ${q.get('equipment') === e.equipment_id ? 'selected' : ''}>${esc(e.equipment_code + ' ' + e.equipment_name)}</option>`).join('')}</select></label>` : ''}
        <label>Status <select id="f_st">${['', 'Recorded', 'Approved', 'Returned', 'Voided', 'All'].map((s) => `<option value="${s}" ${(q.get('status') || '') === s ? 'selected' : ''}>${s || 'All but voided'}</option>`).join('')}</select></label>
        <button class="btn" id="f_go">Show</button>${due.length && d.can_record ? `<a class="btn primary" href="#/logbooks/${l.id}?tab=record">Record entries (${due.length} due)</a>` : ''}
      </div><div id="g"></div></div>`;
  body.querySelector('#f_go').onclick = () => {
    const p = new URLSearchParams({ tab: 'entries' });
    const v = (s) => body.querySelector(s)?.value || '';
    if (v('#f_from')) p.set('from', v('#f_from')); if (v('#f_to')) p.set('to', v('#f_to')); if (v('#f_eq')) p.set('equipment', v('#f_eq')); if (v('#f_st')) p.set('status', v('#f_st'));
    location.hash = `#/logbooks/${l.id}?${p}`;
  };
  const subjectCol = l.subject === 'Equipment' ? [{ field: 'equipment_code', title: 'Equipment', type: 'link', width: 230, href: (x) => '#/equipment/' + x.equipment_id, compute: (x) => `${x.equipment_code} ${x.equipment_name}` }]
    : l.subject === 'Lot' ? [{ field: 'lot_code', title: 'Lot', type: 'link', width: 220, href: (x) => (x.lot_id ? '#/inventory/lots/' + x.lot_id : null), compute: (x) => `${x.lot_code || ''} ${x.lot_name || ''}`.trim() }]
      : l.subject === 'Sample' ? [{ field: 'sample_code', title: 'Sample', type: 'link', width: 130, href: (x) => '#/samples/' + x.sample_id }] : [];
  new Grid(body.querySelector('#g'), { readOnly: true, rows: d.entries, search: true, emptyText: 'No entries.', rowClass: (x) => (x.result === 'Fail' ? 'lb-fail' : x.status === 'Voided' ? 'mutedrow' : ''),
    columns: [
      { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.id },
      { field: 'entry_local', title: 'When', type: 'readonly', width: 130, format: (v, x) => (x.sensor ? sensorWhen(x) : loc(v)) },
      ...subjectCol,
      ...keys.map((f) => ({ field: 'v_' + f.field_key, title: f.label + (f.unit ? ` (${f.unit})` : ''), type: 'readonly', width: Math.max(90, Math.min(200, f.label.length * 8 + 30)),
        align: ['Number', 'Calculated'].includes(f.field_type) ? 'right' : undefined, compute: (x) => { const v = (x.display || {})[f.field_key]; return v === undefined ? '' : ['Number', 'Calculated'].includes(f.field_type) ? fmtN(v) : String(v); } })),
      { field: 'result', title: 'Result', type: 'readonly', width: 70, cellClass: (x) => ({ Pass: 'tbpass', Fail: 'tbfail' }[x.result] || '') },
      { field: 'problems', title: 'Outside its limit / reason', type: 'readonly', width: 320, cellClass: (x) => (needsReason(x) ? 'tbfail' : ''), compute: (x) => [...(x.problems || []), x.failure_reason ? 'Reason: ' + x.failure_reason : needsReason(x) ? 'REASON NEEDED' : ''].filter(Boolean).join('; ') },
      ...(l.creates_lot ? [{ field: 'created_lot_code', title: 'Lot made', type: 'link', width: 110, href: (x) => (x.created_lot_id ? '#/inventory/lots/' + x.created_lot_id : null) }] : []),
      ...(l.validity_hours ? [{ field: 'valid_until', title: 'Usable until', type: 'readonly', width: 160, format: (v, x) => (v ? dt(v) + (x.expired ? ' (expired)' : '') : '') }] : []),
      { field: 'recorded_by_name', title: 'Recorded by', type: 'readonly', width: 150 },
      { field: 'status', title: 'Status', type: 'readonly', width: 230, cellClass: (x) => (x.overdue ? 'tbfail' : x.status === 'Returned' ? 'tbwait' : ''),
        compute: (x) => (x.status === 'Approved' ? (x.approved_in_batch_code ? `Reviewed in ${x.approved_in_batch_code}` : `Approved by ${x.approved_by_name || ''}`) : x.status === 'Recorded' && x.review_due ? `Recorded; QA by ${x.review_due}${x.overdue ? ' (overdue)' : ''}` : x.status) },
    ] });
}

// ---------------------------------------------------------------- Record entries: a grid, one save, one signature
function recordTab(body, d, l, fields) {
  const eqById = Object.fromEntries(d.equipment.map((e) => [e.equipment_id, e]));
  const dueSet = new Set(d.due.filter((x) => x.due).map((x) => x.equipment_id));
  const subjectCols = l.subject === 'Equipment'
    ? [{ field: 'equipment_id', title: 'Equipment', type: 'select', width: 260, required: true, options: d.equipment.map((e) => ({ value: e.equipment_id, label: `${e.equipment_code} ${e.equipment_name}`, match: [e.equipment_code, e.equipment_name] })) }]
    : l.subject === 'Lot' && !l.creates_lot ? [{ field: 'lot_id', title: 'Lot', type: 'select', width: 260, required: true, options: d.opts.lots.map((x) => ({ value: x.id, label: `${x.lot_code} ${x.item_name}`, match: [x.lot_code] })) }]
      : l.subject === 'Sample' ? [{ field: 'sample', title: 'Sample', type: 'text', width: 130, required: true }] : [];
  const lotOpts = d.opts.lots.map((x) => ({ value: x.id, label: `${x.lot_code} ${x.item_name}`, match: [x.lot_code] }));
  const eqOpts = d.opts.equipment.filter((e) => e.availability === 'Available' && e.calibration_status !== 'Deficient').map((e) => ({ value: e.id, label: `${e.equipment_code} ${e.equipment_name}`, match: [e.equipment_code, e.equipment_name] }));
  const fieldCol = (f) => {
    const base = { field: 'f_' + f.field_key, title: f.label + (f.unit ? ` (${f.unit})` : '') + (f.required && f.field_type !== 'Calculated' ? ' *' : ''), width: Math.max(100, Math.min(220, f.label.length * 8 + 40)) };
    if (f.field_type === 'Number') return { ...base, type: 'number', align: 'right' };
    if (f.field_type === 'Choice') return { ...base, type: 'select', options: f.choices || [] };
    if (f.field_type === 'Pass/Fail') return { ...base, type: 'select', options: ['Pass', 'Fail'], width: 110 };
    if (f.field_type === 'Equipment') return { ...base, type: 'select', options: eqOpts, width: 240 };
    if (f.field_type === 'Lot') return { ...base, type: 'select', options: lotOpts, width: 260 };
    if (f.field_type === 'Calculated') {
      return { ...base, type: 'readonly', align: 'right', title: f.label + (f.unit ? ` (${f.unit})` : ''),
        compute: (row) => { const j = judge(fields, row, eqById[row.equipment_id]); const v = j.vals[f.field_key]; return v === undefined ? (/\{[a-z_0-9]+\.[a-z_0-9]+\}/.test(f.formula || '') ? 'on save' : '') : fmtN(v); } };
    }
    if (f.field_type === 'Date/time') return { ...base, type: 'text', width: 150, validate: (v) => (v && !/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(v) ? 'YYYY-MM-DD HH:MM' : null) };
    return { ...base, type: 'text' };
  };
  const hasInput = (row) => fields.some((f) => f.field_type !== 'Calculated' && row['f_' + f.field_key] !== undefined && row['f_' + f.field_key] !== null && row['f_' + f.field_key] !== '');
  const columns = [
    { field: 'entry_at', title: 'When (blank = now)', type: 'text', width: 145, validate: (v) => (v && !/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}$/.test(String(v).trim()) ? 'YYYY-MM-DD HH:MM, or blank for now' : null) },
    ...subjectCols, ...fields.map(fieldCol),
    { field: 'judged', title: 'Result', type: 'readonly', width: 75, compute: (row) => { if (!hasInput(row)) return ''; const j = judge(fields, row, eqById[row.equipment_id]); return j.probs.length ? 'Fail' : fields.some((f) => f.field_type === 'Pass/Fail' || f.limit_min !== null || f.limit_max !== null || f.equipment_limits) ? 'Pass' : ''; },
      cellClass: (row) => { if (!hasInput(row)) return ''; return judge(fields, row, eqById[row.equipment_id]).probs.length ? 'tbfail' : 'tbpass'; } },
    { field: 'failure_reason', title: 'Reason (when it fails)', type: 'text', width: 260 },
  ];
  const rows = l.subject === 'Equipment' ? d.equipment.filter((e) => e.admin_status === 'In Service' || dueSet.has(e.equipment_id)).map((e, i) => ({ k: 'r' + i, equipment_id: e.equipment_id }))
    : Array.from({ length: 5 }, (_, i) => ({ k: 'r' + i }));
  body.innerHTML = `<div class="card">
    <div class="lb-note" style="margin-bottom:8px">${l.subject === 'Equipment' ? 'One row per piece of equipment the logbook covers; leave a row empty to skip it. ' : ''}Type or paste from Excel, fill down with Ctrl+D. Calculated values and Pass / Fail are a preview: the system calculates and judges each entry when it is saved. A row that fails needs its reason. ${l.signing === 'Signature' ? 'One signature records every row.' : 'Entries are recorded under your name (no signature).'}</div>
    <div class="lb-bar"><button class="btn primary" id="save">Record entries</button><span class="lb-note" id="cnt"></span></div>
    <div id="g"></div></div>`;
  let grid;
  const count = () => { const n = grid.rows.filter(hasInput).length; body.querySelector('#cnt').textContent = n ? `${n} row${n === 1 ? '' : 's'} to record` : ''; };
  grid = new Grid(body.querySelector('#g'), { rows, columns, keyField: 'k', allowAdd: true, newRow: () => ({ k: 'n' + Math.random().toString(36).slice(2) }), onChange: () => { count(); grid.render(); } });
  setDirtyCheck(() => grid.rows.some(hasInput));
  body.querySelector('#save').onclick = async () => {
    if (grid.hasErrors()) { toast('Fix the cells marked in red first (hover a red cell to see why).', 'err'); return; }
    const todo = grid.rows.filter(hasInput);
    if (!todo.length) { toast('Nothing to record: type the values first.', 'err'); return; }
    // a failing row needs its reason: asked for here, before signing (Alex: "a reason is prompted at failure")
    const failing = todo.map((row) => ({ row, j: judge(fields, row, eqById[row.equipment_id]) })).filter((x) => x.j.probs.length && !String(x.row.failure_reason || '').trim());
    if (failing.length) {
      const label = (row) => (l.subject === 'Equipment' ? (eqById[row.equipment_id] ? `${eqById[row.equipment_id].equipment_code} ${eqById[row.equipment_id].equipment_name}` : 'Row') : l.subject === 'Sample' ? row.sample || 'Row' : 'Row');
      const m = await modal({ title: `${failing.length} entr${failing.length === 1 ? 'y fails' : 'ies fail'}: give the reason`, okText: 'Continue', wide: true,
        intro: 'Say what happened and what was done about it (for example: re-checked, adjusted, taken out of use, supervisor informed). The reason is kept with the entry; any batch step that used the equipment while it was failing is flagged in QC Review.',
        fields: failing.map((x, i) => ({ name: 'r' + i, label: `${label(x.row)}: ${x.j.probs.join('; ')}`, type: 'textarea', required: true })) });
      if (!m) return;
      failing.forEach((x, i) => { x.row.failure_reason = m['r' + i]; });
      grid.render();
    }
    const payload = todo.map((row) => {
      const values = {};
      for (const f of fields) if (f.field_type !== 'Calculated') { const v = row['f_' + f.field_key]; if (v !== undefined && v !== null && v !== '') values[f.field_key] = v; }
      return { entry_at: row.entry_at || '', equipment_id: row.equipment_id, lot_id: row.lot_id, sample: row.sample, values, failure_reason: row.failure_reason || '' };
    });
    const send = async (signature) => api(`/logbooks/${l.id}/entries`, { method: 'POST', body: { rows: payload, signature } });
    const done = (x) => {
      setDirtyCheck(null);
      toast(`Recorded ${x.made.length} entr${x.made.length === 1 ? 'y' : 'ies'}${x.failed.length ? ` (${x.failed.length} failed, with their reasons)` : ''}${x.lots && x.lots.length ? `; lot${x.lots.length > 1 ? 's' : ''} made: ${x.lots.map((y) => y.lot_code).join(', ')}` : ''}.`);
      location.hash = `#/logbooks/${l.id}?tab=entries`;
    };
    if (l.signing === 'Signature') {
      const r = await signDialog({ what: `${payload.length} entr${payload.length === 1 ? 'y' : 'ies'} in ${l.logbook_code} ${l.logbook_name}`, meaning: 'Recorded by', needReason: false, submit: ({ signature }) => send(signature) });
      if (r) done(r);
    } else {
      try { done(await send(null)); } catch (e) { toast(e.message, 'err'); }
    }
  };
  count();
}

// ---------------------------------------------------------------- Design: settings, fields (versioned, approved by QA)
function designTab(body, d, l, eff, draftF) {
  const draft = d.versions.find((v) => v.status === 'Draft');
  const effV = d.versions.find((v) => v.status === 'Effective');
  const editable = !!draft && d.can_design;
  const errors = d.problems.filter((p) => p.severity === 'Error');
  body.innerHTML = `
    <div class="card">${section('Settings', 'Who it is for and how it is reviewed. Not versioned: a change is kept in the audit trail with its reason.', d.can_design ? '<button class="btn" id="saveset">Save settings</button>' : '')}
      <div class="lb-set" id="set"></div></div>
    <div class="card">${section(draft ? `Design version ${draft.version_no} (Draft)` : effV ? `Design version ${effV.version_no} (Effective)` : 'Design',
      draft ? 'Fields in the order they are entered. A Calculated field uses the fields before it ({nominal_g}) or a value published on a Lot field\'s lot ({culture_lot.passage}). Limits make an entry Pass or Fail; per equipment when the limits differ by unit (Equipment covered).'
        : 'Approved and locked: entries use it. Start a new version to change it; QA approves it before it replaces this one.',
      `${editable && d.can_review ? '' : ''}${!draft && d.can_design ? '<button class="btn" id="newv">New version</button>' : ''}${draft && d.can_review ? `<button class="btn primary" id="approve" ${errors.length ? 'disabled title="Fix the errors listed first"' : ''}>Approve design (QA)</button>` : ''}`)}
      ${draft ? `<ul class="lb-probs">${d.problems.length ? d.problems.map((p) => `<li class="${esc(p.severity)}">${esc(p.severity)}: ${esc(p.problem)}</li>`).join('') : '<li class="ok">No problems found: ready for QA to approve.</li>'}</ul>` : ''}
      <div id="fg" style="margin-top:8px"></div></div>
    <div class="card">${section('Versions')}<div id="vg"></div></div>`;
  // settings
  const s = l; const ro = !d.can_design;
  const sel = (n, opts, v) => `<select id="s_${n}" ${ro ? 'disabled' : ''}>${opts.map((o) => { const val = typeof o === 'object' ? o.value : o; const lab = typeof o === 'object' ? o.label : o; return `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
  const fld = (lab, html) => `<div class="field"><label>${esc(lab)}</label>${html}</div>`;
  body.querySelector('#set').innerHTML = [
    fld('Name', `<input id="s_logbook_name" value="${esc(s.logbook_name)}" ${ro ? 'disabled' : ''}>`),
    fld('Kind', sel('kind', KINDS, s.kind)),
    fld('Each entry is about', sel('subject', [{ value: 'Equipment', label: 'A piece of equipment' }, { value: 'Lot', label: 'An inventory lot' }, { value: 'Sample', label: 'A sample' }, { value: 'None', label: 'Nothing in particular' }], s.subject)),
    fld('Entries due', sel('entry_frequency', ['Daily', 'Weekly', 'Monthly', 'As needed'], s.entry_frequency)),
    fld('QA approves entries', sel('review_frequency', ['Daily', 'Weekly'], s.review_frequency)),
    fld('Reviewed', sel('review_route', [{ value: 'Logbook', label: 'In the logbook (QA)' }, { value: 'Batch', label: 'In the batch that uses it' }], s.review_route)),
    fld('Entries are', sel('signing', [{ value: 'Signature', label: 'Signed' }, { value: 'Recorded', label: 'Recorded (no signature)' }], s.signing)),
    fld('Usable for (hours)', `<input id="s_validity_hours" type="number" value="${esc(s.validity_hours ?? '')}" ${ro ? 'disabled' : ''}>`),
    fld('Each entry makes a lot', sel('creates_lot', [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes (e.g. an inoculum)' }], String(!!s.creates_lot))),
    fld('Name of the lots it makes', `<input id="s_lot_name" value="${esc(s.lot_name || '')}" ${ro ? 'disabled' : ''}>`),
    fld('Unit of those lots', `<input id="s_lot_unit" value="${esc(s.lot_unit || 'mL')}" ${ro ? 'disabled' : ''}>`),
    fld('Status', sel('status', ['Active', 'Inactive'], s.status)),
    `<div class="field" style="grid-column: 1 / -1"><label>What it is for</label><textarea id="s_description" rows="2" ${ro ? 'disabled' : ''}>${esc(s.description || '')}</textarea></div>`,
  ].join('');
  const ss = body.querySelector('#saveset');
  if (ss) ss.onclick = async () => {
    const v = (k) => body.querySelector('#s_' + k).value;
    const b = {}; for (const k of ['logbook_name', 'kind', 'subject', 'entry_frequency', 'review_frequency', 'review_route', 'signing', 'validity_hours', 'creates_lot', 'lot_name', 'lot_unit', 'status', 'description']) b[k] = v(k);
    const reason = await askReason(`the settings of ${l.logbook_code}`); if (reason === null) return;
    try { await api(`/logbooks/${l.id}/settings`, { method: 'POST', body: { ...b, reason } }); toast('Settings saved.'); location.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  // fields
  const rows = (draft ? draftF : eff).map((f) => ({ ...f, choices: f.choices || [] }));
  const cols = [
    { field: 'sort_order', title: 'Order', type: 'int', width: 60 },
    { field: 'label', title: 'Label', type: 'text', width: 200, required: true },
    { field: 'field_key', title: 'Key (formulas)', type: 'text', width: 140, help: 'Made from the label when left empty' },
    { field: 'field_type', title: 'Type', type: 'select', width: 110, options: TYPES, required: true },
    { field: 'unit', title: 'Unit', type: 'text', width: 70 },
    { field: 'limit_min', title: 'Lower limit', type: 'number', width: 90 },
    { field: 'limit_max', title: 'Upper limit', type: 'number', width: 90 },
    { field: 'equipment_limits', title: 'Per equipment', type: 'bool', width: 95 },
    { field: 'required', title: 'Required', type: 'bool', width: 80 },
    { field: 'choices', title: 'Choices (a; b)', type: 'array', width: 160 },
    { field: 'formula', title: 'Formula', type: 'text', width: 280 },
    { field: 'publish', title: 'Published (lot value)', type: 'bool', width: 130 },
    { field: 'help', title: 'Help', type: 'text', width: 200 },
    { field: 'status', title: 'Status', type: 'select', width: 85, options: ['Active', 'Inactive'] },
  ];
  if (editable) {
    editableGrid({ el: body.querySelector('#fg'), rows, columns: cols, allowAdd: true, what: `the design of ${l.logbook_code}`,
      newRow: () => ({ field_type: 'Number', required: true, equipment_limits: false, publish: false, status: 'Active', sort_order: (rows.length + 1) * 10, choices: [] }),
      save: (changed, reason) => api(`/logbooks/${l.id}/fields`, { method: 'POST', body: { rows: changed, reason } }), afterSave: () => location.reload() });
  } else {
    new Grid(body.querySelector('#fg'), { readOnly: true, rows, columns: cols.map((c) => ({ ...c, type: c.type === 'bool' ? 'bool' : c.type === 'array' ? 'array' : 'readonly' })), emptyText: 'No fields yet.' });
  }
  new Grid(body.querySelector('#vg'), { readOnly: true, rows: d.versions, columns: [
    { field: 'version_no', title: 'Version', type: 'readonly', width: 70 },
    { field: 'status', title: 'Status', type: 'readonly', width: 100 },
    { field: 'change_summary', title: 'Change', type: 'readonly', width: 300 },
    { field: 'created_by_name', title: 'Started by', type: 'readonly', width: 160 },
    { field: 'approved_by_name', title: 'Approved by (QA)', type: 'readonly', width: 160 },
    { field: 'approved_at', title: 'Approved', type: 'readonly', width: 170, format: (v) => dt(v) },
  ] });
  const nv = body.querySelector('#newv');
  if (nv) nv.onclick = async () => {
    const m = await modal({ title: `New version of ${l.logbook_code}`, okText: 'Start it', intro: 'The fields are copied from the Effective version into a Draft. Entries keep using the Effective version until QA approves the new one.',
      fields: [{ name: 'summary', label: 'What changes', required: true }] });
    if (!m) return;
    try { await api(`/logbooks/${l.id}/new-version`, { method: 'POST', body: { summary: m.summary, reason: 'New version: ' + m.summary } }); toast('Draft started.'); location.reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const ap = body.querySelector('#approve');
  if (ap) ap.onclick = async () => {
    const r = await signDialog({ what: `Design version ${draft.version_no} of ${l.logbook_code} ${l.logbook_name}`, meaning: 'Approved by', needReason: false,
      submit: ({ signature }) => api(`/logbooks/${l.id}/approve`, { method: 'POST', body: { signature } }) });
    if (r) { toast('Design approved: entries now use it.'); location.reload(); }
  };
}

// ---------------------------------------------------------------- Equipment covered (limits per unit)
function equipmentTab(body, d, l, fields) {
  const limF = fields.filter((f) => f.equipment_limits && ['Number', 'Calculated'].includes(f.field_type));
  const rows = d.equipment.map((e) => { const r = { ...e }; for (const f of limF) { const x = (e.limits || {})[f.field_key] || {}; r['lo_' + f.field_key] = x.min ?? null; r['hi_' + f.field_key] = x.max ?? null; } return r; });
  body.innerHTML = `<div class="card">${section('Equipment covered', `Entries are recorded for these units only. ${limF.length ? 'Limits per unit for the fields marked "Per equipment"; empty uses the field\'s own limit, and a stability chamber\'s temperature and humidity come from its condition.' : 'No field has limits per equipment.'}`)}<div id="g"></div></div>`;
  const opts = d.opts.equipment.map((e) => ({ value: e.id, label: `${e.equipment_code} ${e.equipment_name} (${e.type_name})`, match: [e.equipment_code, e.equipment_name] }));
  const g = editableGrid({ el: body.querySelector('#g'), rows, allowAdd: d.can_design, readOnly: !d.can_design, what: `the equipment covered by ${l.logbook_code}`,
    newRow: () => ({ status: 'Active' }),
    columns: [
      { field: 'equipment_id', title: 'Equipment', type: 'select', width: 300, options: opts, required: true, editable: (r, isNew) => isNew },
      { field: 'cond', title: 'Stability condition', type: 'readonly', width: 210, compute: (r) => (r.condition_name ? `${r.condition_name}${r.temperature_tol ? ` (± ${fmtN(r.temperature_tol)} °C${r.humidity_tol ? `, ± ${fmtN(r.humidity_tol)} % RH` : ''})` : ''}` : '') },
      ...limF.flatMap((f) => [{ field: 'lo_' + f.field_key, title: `${f.label} min`, type: 'number', width: 110 }, { field: 'hi_' + f.field_key, title: `${f.label} max`, type: 'number', width: 110 }]),
      { field: 'notes', title: 'Notes', type: 'text', width: 220 },
      { field: 'status', title: 'Status', type: 'select', width: 90, options: ['Active', 'Inactive'] },
    ],
    save: (changed, reason) => {
      const out = changed.map((c) => {
        const full = c.id ? { ...g.rows.find((x) => x.id === c.id), ...c } : c;
        const limits = {};
        for (const f of limF) {
          const lo = full['lo_' + f.field_key]; const hi = full['hi_' + f.field_key];
          if ((lo !== null && lo !== undefined && lo !== '') || (hi !== null && hi !== undefined && hi !== '')) limits[f.field_key] = { ...(lo !== null && lo !== '' && lo !== undefined ? { min: Number(lo) } : {}), ...(hi !== null && hi !== '' && hi !== undefined ? { max: Number(hi) } : {}) };
        }
        return { id: c.id, equipment_id: full.equipment_id, limits, notes: full.notes, status: full.status };
      });
      return api(`/logbooks/${l.id}/equipment`, { method: 'POST', body: { rows: out, reason } });
    },
    afterSave: () => location.reload() });
}

// ================================================================ an entry
export async function entry(main, id) {
  const d = await api('/logbooks/entries/' + id);
  const e = d.entry; const lb = d.logbook;
  const own = [e.created_by].includes(d.me);
  const acts = [];
  if (e.sensor && d.can_record && needsReason(e) && e.sensor.kind !== 'Hour') acts.push('<button class="btn primary" id="reason">Give the reason…</button>');
  if (d.can_review && e.status === 'Recorded' && e.review_route === 'Logbook' && !own && !needsReason(e)) acts.push('<button class="btn primary" id="approve">Approve (QA)</button>');
  if (d.can_review && ['Recorded', 'Approved'].includes(e.status) && e.review_route === 'Logbook' && !own) acts.push('<button class="btn" id="return">Return for correction</button>');
  if (d.can_record && e.status !== 'Voided' && !e.sensor) acts.push('<button class="btn" id="correct">Correct…</button>');
  if ((d.can_record || d.can_review) && e.status !== 'Voided') acts.push('<button class="btn ghost" id="void">Void…</button>');
  const subj = e.equipment_id ? link('#/equipment/' + e.equipment_id, `${e.equipment_code} ${e.equipment_name}`) : e.lot_id ? link('#/inventory/lots/' + e.lot_id, `${e.lot_code} ${e.lot_name || ''}`) : e.sample_id ? link('#/samples/' + e.sample_id, e.sample_code) : '-';
  const statusText = e.status === 'Approved' ? (e.approved_in_batch_code ? `Reviewed in ${esc(e.approved_in_batch_code)}` : `Approved by ${esc(e.approved_by_name || '')} ${dt(e.approved_at)}`)
    : e.status === 'Recorded' ? (e.review_route === 'Batch' ? 'Recorded: reviewed in the batch that uses it' : `Recorded: QA approves it by ${esc(e.review_due)}${e.overdue ? ' (overdue)' : ''}`)
      : e.status === 'Returned' ? `Returned by QA: ${esc(e.returned_note || '')}` : `Voided: ${esc(e.void_reason || '')}`;
  main.innerHTML = pageHeader(`${e.entry_code}`, `Entry in ${esc(e.logbook_code)} ${esc(e.logbook_name)} (design v${e.version_no})`, acts.join(''), { kind: 'logbook_entry', id: e.id })
    + `<div class="card"><div class="lb-facts">
        <div><b>Logbook</b>${link('#/logbooks/' + e.logbook_id, e.logbook_code + ' ' + e.logbook_name)}</div>
        <div><b>When</b>${esc(e.sensor ? sensorWhen(e) : loc(e.entry_local))}</div>
        <div><b>About</b>${subj}</div>
        <div><b>Result</b>${e.result ? `<span class="${e.result === 'Fail' ? 'short' : ''}">${esc(e.result)}</span>` : 'No limits'}</div>
        <div><b>Recorded by</b>${esc(e.recorded_by_name)}${e.recorded_signature_id ? ' (signed)' : ''}</div>
        <div><b>Status</b>${statusText}</div>
        ${e.valid_until ? `<div><b>Usable until</b>${dt(e.valid_until)}${e.expired ? ' (expired)' : ''}</div>` : ''}
        ${e.created_lot_id ? `<div><b>Lot made</b>${link('#/inventory/lots/' + e.created_lot_id, e.created_lot_code)}</div>` : ''}
        ${d.review ? `<div><b>QA review</b>${esc(d.review.by_name)} ${dt(d.review.created_at)}${d.review.comment ? ': ' + esc(d.review.comment) : ''}</div>` : ''}
      </div></div>
      ${e.sensor ? sensorBox(e) : ''}
      ${e.result === 'Fail' ? `<div class="lb-failbox"><b>Outside its limit:</b> ${esc((e.problems || []).join('; '))}<br><b>Reason:</b> ${esc(e.failure_reason || (needsReason(e) ? 'not given yet: someone who records in this logbook gives it' : ''))}
        ${d.failure && e.sensor ? `<div class="lb-note" style="margin-top:6px">Any batch step that used ${esc(e.equipment_code)} from ${dt(d.failure.window_start)} ${d.failure.window_end ? 'to ' + dt(d.failure.window_end) : 'until the sensor is back inside its limits'} (this period, from the sensor's readings) is flagged in QC Review.</div>` : ''}
        ${d.failure && !e.sensor ? `<div class="lb-note" style="margin-top:6px">${e.equipment_id ? `Any batch step that used ${esc(e.equipment_code)} from ${dt(d.failure.window_start)} (the last passing entry before it) ${d.failure.window_end ? 'to ' + dt(d.failure.window_end) + ' (the next passing entry)' : 'until the next passing entry (none yet)'} is flagged in QC Review.` : ''}</div>` : ''}</div>` : ''}
      <div class="card">${section('Values')}<table class="lb-vals"><tr><th>Field</th><th>Value</th><th>Limit</th></tr>
        ${d.fields.map((f) => { const v = (e.display || {})[f.field_key]; const lim = d.limits[f.field_key] || {}; const lt = limText({ lo: lim.lo ?? null, hi: lim.hi ?? null });
          const n = Number(v); const out = lt && v !== undefined && ((lim.lo !== null && lim.lo !== undefined && n < Number(lim.lo)) || (lim.hi !== null && lim.hi !== undefined && n > Number(lim.hi)));
          return `<tr><td>${esc(f.label)}${f.field_type === 'Calculated' ? ` <span class="lb-note">= ${esc(f.formula || '')}</span>` : ''}${f.publish ? ' <span class="lb-note">(published on the lot)</span>' : ''}</td>
            <td class="${lt ? (out || (f.field_type === 'Pass/Fail' && v === 'Fail') ? 'out' : 'in') : f.field_type === 'Pass/Fail' ? (v === 'Fail' ? 'out' : 'in') : ''}">${esc(showVal(f, v))}</td><td>${esc(lt)}</td></tr>`; }).join('')}
      </table></div>
      ${d.flags.length ? `<div class="card">${section('Batches flagged', 'Batch steps that used the equipment while this entry was failing. The reviewer accepts each flag with a justification in QC Review.')}<div id="fl"></div></div>` : ''}
      ${d.excursions.length ? `<div class="card">${section('Stability studies in this chamber', 'Study material stored in the chamber at the time of the excursion.')}<div id="ex"></div></div>` : ''}
      ${(d.uses || []).length ? `<div class="card">${section('Used by results', 'Results whose calculation used a value of this entry (its lot was scanned at the bench), or that weighed this aliquot. A correction flags them for review.')}<div id="us"></div></div>` : ''}`;
  if (d.flags.length) new Grid(main.querySelector('#fl'), { readOnly: true, rows: d.flags.map((x, i) => ({ ...x, key: i })), keyField: 'key', columns: [
    { field: 'batch_code', title: 'Batch', type: 'link', width: 120, href: (x) => `#/testing/batches/${x.batch_id}?step=review` },
    { field: 'batch_status', title: 'Batch status', type: 'readonly', width: 130 },
    { field: 'step_name', title: 'Step', type: 'readonly', width: 200 },
    { field: 'used_at', title: 'Used', type: 'readonly', width: 160, format: (v) => dt(v) },
    { field: 'acc', title: 'Accepted', type: 'readonly', width: 360, compute: (x) => (x.accepted ? `${x.accepted_by_name}: ${x.justification}` : 'Not accepted yet'), cellClass: (x) => (x.accepted ? 'tbpass' : 'tbwait') },
  ] });
  if (d.excursions.length) new Grid(main.querySelector('#ex'), { readOnly: true, rows: d.excursions.map((x, i) => ({ ...x, key: i })), keyField: 'key', columns: [
    { field: 'study_code', title: 'Study', type: 'link', width: 120, href: (x) => '#/stability/studies/' + x.study_id },
    { field: 'storage_code', title: 'Material', type: 'readonly', width: 140 },
    { field: 'rack_code', title: 'Rack', type: 'readonly', width: 80 },
    { field: 'condition_name', title: 'Condition', type: 'readonly', width: 180 },
  ] });
  if ((d.uses || []).length) new Grid(main.querySelector('#us'), { readOnly: true, rows: d.uses.map((x, i) => ({ ...x, key: i })), keyField: 'key', columns: [
    { field: 'sample_code', title: 'Sample', type: 'link', width: 130, href: (x) => '#/samples/' + x.sample_id },
    { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 180 },
    { field: 'reported', title: 'Result', type: 'readonly', width: 100 },
    { field: 'batch_code', title: 'Batch', type: 'link', width: 120, href: (x) => '#/testing/batches/' + x.batch_id },
    { field: 'flag', title: 'After a correction', type: 'readonly', width: 360, compute: (x) => (x.flag_status === 'Open' ? 'Flagged: the entry was corrected after the result used it' : x.flag_status === 'Resolved' ? `Reviewed: ${x.flag_note || ''}` : ''), cellClass: (x) => (x.flag_status === 'Open' ? 'tbfail' : '') },
    { field: 'act', title: '', type: 'button', width: 95, label: (x) => (d.can_resolve && x.flag_status === 'Open' ? 'Resolve…' : ''), onClick: async (x) => {
      if (!d.can_resolve || x.flag_status !== 'Open') return;
      const m = await modal({ title: `Review ${x.analyte_name} of ${x.sample_code}`, okText: 'Resolve', intro: `${esc(e.entry_code)} was corrected after this result used it. Say what the correction means for the result: it stands (and why), or what was done (re-tested, a new COA version). Someone who did not correct the entry resolves it.`,
        fields: [{ name: 'note', label: 'Review', type: 'textarea', required: true }] });
      if (!m) return;
      try { await api(`/logbooks/flags/${x.flag_id}/resolve`, { method: 'POST', body: { note: m.note } }); toast('Flag resolved.'); location.reload(); } catch (err) { toast(err.message, 'err'); }
    } },
  ] });
  const $ = (s) => main.querySelector(s);
  if ($('#approve')) $('#approve').onclick = async () => {
    const r = await signDialog({ what: `QA approval of ${e.entry_code}`, meaning: 'Approved by', needReason: false, submit: ({ signature }) => api('/logbooks/review/approve', { method: 'POST', body: { ids: [e.id], signature } }) });
    if (r) { toast(`${e.entry_code} approved.`); location.reload(); }
  };
  if ($('#return')) $('#return').onclick = async () => {
    const m = await modal({ title: `Return ${e.entry_code}`, okText: 'Return it', intro: 'The person who recorded it corrects it (with a reason); it then comes back to QA.', fields: [{ name: 'note', label: 'What needs correcting', type: 'textarea', required: true }] });
    if (!m) return;
    try { await api(`/logbooks/entries/${e.id}/return`, { method: 'POST', body: { note: m.note } }); toast('Returned for correction.'); location.reload(); } catch (err) { toast(err.message, 'err'); }
  };
  if ($('#void')) $('#void').onclick = async () => {
    const m = await modal({ title: `Void ${e.entry_code}`, okText: 'Continue', intro: 'Only for an entry made in error (wrong logbook, wrong unit). It stays in the logbook, marked Voided. An entry used by a result cannot be voided: correct it instead.', fields: [{ name: 'why', label: 'Why it is voided', type: 'textarea', required: true }] });
    if (!m) return;
    const go = (signature, reason) => api(`/logbooks/entries/${e.id}/void`, { method: 'POST', body: { void_reason: m.why, reason: reason || 'Recorded in error', signature } });
    if (e.signing === 'Signature') {
      const r = await signDialog({ what: `Void ${e.entry_code}`, meaning: 'Changed by', needReason: true, defaultReason: m.why, submit: ({ signature, reason }) => go(signature, reason) });
      if (r) { toast('Entry voided.'); location.reload(); }
    } else { try { await go(null, m.why); toast('Entry voided.'); location.reload(); } catch (err) { toast(err.message, 'err'); } }
  };
  if ($('#correct')) $('#correct').onclick = () => correctEntry(e, d);
  if ($('#reason')) $('#reason').onclick = async () => {
    const m = await modal({ title: `Reason for ${e.entry_code}`, okText: 'Continue', intro: `${esc((e.problems || []).join('; '))}. Say what happened and what was done about it (the readings stay as the sensor sent them).`,
      fields: [{ name: 'why', label: 'Reason', type: 'textarea', required: true }] });
    if (!m) return;
    const go = (signature, reason) => api(`/logbooks/entries/${e.id}/reason`, { method: 'POST', body: { failure_reason: m.why, reason: reason || 'Reason given for a sensor excursion', signature } });
    const r = await signDialog({ what: `Reason for ${e.entry_code}`, meaning: 'Changed by', needReason: false, sign: e.signing === 'Signature', submit: ({ signature, reason }) => go(signature, reason) });
    if (r) { toast('Reason recorded.'); location.reload(); }
  };
}

// a sensor entry (0.25.0): what it covers and the readings behind it
function sensorBox(e) {
  const s = e.sensor; const m = s.summary || {};
  const head = s.kind === 'Hour' ? `Hourly summary of ${esc(m.label || '')}: ${esc(m.n)} readings, lowest ${esc(fmtN(m.min))}, highest ${esc(fmtN(m.max))}, average ${esc(fmtN(m.mean))}${(m.excursions || []).length ? '. Part of excursion ' + esc(m.excursions.join(', ')) : ''}`
    : s.kind === 'Excursion' ? `Readings outside the limits from ${esc(tloc(s.start))} ${s.end ? 'to ' + esc(tloc(s.end)) + ' (the first reading back inside)' : '(still outside)'}: ${esc(m.n)} readings, peak ${esc(fmtN(m.peak))}`
      : `No reading from the sensor from ${esc(tloc(s.start))} ${s.end ? 'to ' + esc(tloc(s.end)) + ` (${esc(m.minutes)} minutes)` : '(still silent)'}`;
  const rd = s.kind === 'Excursion' && Array.isArray(m.readings) ? `<table class="lb-vals" style="margin-top:8px;max-width:420px"><tr><th>Reading at</th><th>Value</th></tr>${m.readings.map((x) => `<tr><td>${esc(tloc(x.at))}</td><td class="out">${esc(fmtN(x.value))}</td></tr>`).join('')}</table>` : '';
  const lim = m.lo !== undefined || m.hi !== undefined ? ` Judged against ${m.lo !== undefined && m.hi !== undefined ? `${fmtN(m.lo)} to ${fmtN(m.hi)}` : m.lo !== undefined ? 'at least ' + fmtN(m.lo) : 'at most ' + fmtN(m.hi)}, the limits when it was recorded.` : '';
  return `<div class="card">${section('From the sensor', `Sensor ${esc(s.sensor || '')}, recorded by the automated sensor feed. The readings cannot be changed by hand.`)}<div>${head}.${esc(lim)}</div>${rd}</div>`;
}

async function correctEntry(e, d) {
  const inputs = d.fields.filter((f) => f.field_type !== 'Calculated');
  let lots = []; let eqs = [];
  if (inputs.some((f) => ['Lot', 'Equipment'].includes(f.field_type))) {
    const lb = await api('/logbooks/' + e.logbook_id).catch(() => null);
    if (lb) { lots = lb.opts.lots; eqs = lb.opts.equipment; }
  }
  const fields = [
    { name: '__at', label: 'When (YYYY-MM-DD HH:MM)', value: loc(e.entry_local) },
    ...inputs.map((f) => {
      const v = (e.entry_values || {})[f.field_key];
      if (f.field_type === 'Choice') return { name: f.field_key, label: f.label, type: 'select', options: f.choices || [], value: v ?? '' };
      if (f.field_type === 'Pass/Fail') return { name: f.field_key, label: f.label, type: 'select', options: ['Pass', 'Fail'], value: v ?? '' };
      if (f.field_type === 'Lot') return { name: f.field_key, label: f.label, type: 'select', options: lots.map((x) => ({ value: x.id, label: `${x.lot_code} ${x.item_name}` })), value: v ?? '' };
      if (f.field_type === 'Equipment') return { name: f.field_key, label: f.label, type: 'select', options: eqs.map((x) => ({ value: x.id, label: `${x.equipment_code} ${x.equipment_name}` })), value: v ?? '' };
      return { name: f.field_key, label: f.label + (f.unit ? ` (${f.unit})` : ''), value: v ?? '' };
    }),
    { name: '__reason_fail', label: 'Reason (when it fails)', type: 'textarea', value: e.failure_reason || '' },
  ];
  const m = await modal({ title: `Correct ${e.entry_code}`, okText: 'Continue', wide: true,
    intro: `The old values stay in the audit trail. ${e.status === 'Approved' ? 'It is approved: the correction sends it back to QA.' : ''} Calculated values and the result are worked out again.`, fields });
  if (!m) return;
  const values = {}; for (const f of inputs) if (m[f.field_key] !== '') values[f.field_key] = m[f.field_key];
  const go = (signature, reason) => api(`/logbooks/entries/${e.id}/correct`, { method: 'POST', body: { values, entry_at: m.__at, failure_reason: m.__reason_fail, reason, signature } });
  const r = await signDialog({ what: `Correct ${e.entry_code}`, meaning: 'Changed by', needReason: true, sign: e.signing === 'Signature', submit: ({ signature, reason }) => go(signature, reason) });
  if (r) { toast('Entry corrected.'); location.reload(); }
}

// ================================================================ QA > Logbook review
export async function review(main) {
  const d = await api('/logbooks/review');
  const logbooks = [...new Set(d.rows.map((x) => x.logbook_code + ' ' + x.logbook_name))];
  const late = d.rows.filter((x) => x.overdue).length;
  main.innerHTML = pageHeader('Logbook review', 'QA approves each logbook\'s entries daily or weekly (as the logbook says); late ones first. Tick the entries checked, then approve them with one signature. Entries you recorded or corrected are approved by someone else. A sample weights logbook is reviewed in the batch that uses it, not here.',
    '', { kind: 'logbooks' })
    + `<div class="card"><div class="lb-bar">${d.can_review ? `<button class="btn primary" id="ok">Approve ticked (signed)</button><button class="btn" id="all">Tick all I may approve</button>` : '<span class="lb-note">QA (logbook.review) approves these.</span>'}
        <label>Logbook <select id="f_lb"><option value="">All</option>${logbooks.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
        <span class="lb-note">${d.rows.length} waiting${late ? `, <b class="short">${late} overdue</b>` : ''}</span></div><div id="g"></div></div>`;
  const rows = d.rows.map((x) => ({ ...x, pick: false, mine: x.created_by === d.me }));
  const grid = new Grid(main.querySelector('#g'), { rows, search: true, emptyText: 'Nothing waiting for QA.', rowClass: (x) => (x.result === 'Fail' ? 'lb-fail' : x.mine ? 'mutedrow' : ''),
    columns: [
      { field: 'pick', title: 'Approve', type: 'bool', width: 70, editable: (x) => d.can_review && !x.mine && x.status === 'Recorded' && !needsReason(x) },
      { field: 'logbook_code', title: 'Logbook', type: 'link', width: 85, href: (x) => '#/logbooks/' + x.logbook_id },
      { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.id },
      { field: 'entry_local', title: 'When', type: 'readonly', width: 125, format: (v) => loc(v) },
      { field: 'about', title: 'About', type: 'readonly', width: 210, compute: (x) => (x.equipment_code ? `${x.equipment_code} ${x.equipment_name}` : x.lot_code ? `${x.lot_code} ${x.lot_name || ''}` : x.sample_code || '') },
      { field: 'summary', title: 'Values', type: 'readonly', width: 420 },
      { field: 'result', title: 'Result', type: 'readonly', width: 65, cellClass: (x) => ({ Pass: 'tbpass', Fail: 'tbfail' }[x.result] || '') },
      { field: 'why', title: 'Outside its limit / reason', type: 'readonly', width: 300, compute: (x) => [...(x.problems || []), x.failure_reason ? 'Reason: ' + x.failure_reason : ''].filter(Boolean).join('; ') },
      { field: 'recorded_by_name', title: 'Recorded by', type: 'readonly', width: 140 },
      { field: 'review_due', title: 'Approve by', type: 'readonly', width: 115, format: (v, x) => (v ? String(v).slice(0, 10) + (x.overdue ? ' (late)' : '') : ''), cellClass: (x) => (x.overdue ? 'tbfail' : '') },
      { field: 'status', title: 'Status', type: 'readonly', width: 210, cellClass: (x) => (needsReason(x) ? 'tbfail' : ''), compute: (x) => (x.status === 'Returned' ? `Returned: ${x.returned_note || ''}` : needsReason(x) ? 'Reason needed first' : x.mine ? 'Recorded by you' : 'Recorded') },
      { field: 'ret', title: '', type: 'button', width: 90, label: (x) => (d.can_review && !x.mine ? 'Return…' : ''), onClick: async (x) => {
        if (!d.can_review || x.mine) return;
        const m = await modal({ title: `Return ${x.entry_code}`, okText: 'Return it', fields: [{ name: 'note', label: 'What needs correcting', type: 'textarea', required: true }] });
        if (!m) return;
        try { await api(`/logbooks/entries/${x.id}/return`, { method: 'POST', body: { note: m.note } }); toast('Returned for correction.'); review(main); } catch (e) { toast(e.message, 'err'); }
      } },
    ] });
  const flt = main.querySelector('#f_lb');
  flt.onchange = () => { grid.filter = flt.value; grid._view(); grid.render(); };
  const all = main.querySelector('#all');
  if (all) all.onclick = () => { grid.rows.forEach((x) => { if (!x.mine && x.status === 'Recorded' && !needsReason(x) && (!flt.value || (x.logbook_code + ' ' + x.logbook_name) === flt.value)) x.pick = true; }); grid.render(); };
  const ok = main.querySelector('#ok');
  if (ok) ok.onclick = async () => {
    const ids = grid.rows.filter((x) => x.pick).map((x) => x.id);
    if (!ids.length) { toast('Tick the entries to approve first.', 'err'); return; }
    const m = await modal({ title: `Approve ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}`, okText: 'Continue', fields: [{ name: 'comment', label: 'Comment (optional)', type: 'textarea' }] });
    if (!m) return;
    const r = await signDialog({ what: `QA approval of ${ids.length} logbook entr${ids.length === 1 ? 'y' : 'ies'}`, meaning: 'Approved by', needReason: false,
      submit: ({ signature }) => api('/logbooks/review/approve', { method: 'POST', body: { ids, comment: m.comment, signature } }) });
    if (r) { toast(`Approved ${r.approved} entr${r.approved === 1 ? 'y' : 'ies'}.`); review(main); }
  };
}

// ================================================================ pieces for other pages
// QC Review: the batch's steps that used equipment while a logbook entry on it was failing (accepted with a justification)
export async function flagsCard(host, ctx, can, stepRunIds = null) {
  let d; try { d = await api(`/testing/batches/${ctx.b.id}/equipment-flags`); } catch (_) { return; }
  const rows = d.rows.filter((x) => !stepRunIds || stepRunIds.includes(x.step_run_id));
  if (!rows.length) { host.innerHTML = ''; return; }
  host.innerHTML = '<h3 style="margin:14px 0 6px">Equipment flagged by its logbook</h3><div class="lb-note" style="margin-bottom:6px">A check or reading of this equipment failed while the batch used it (from the last passing entry before the failure to the next passing one). Accept each with a justification, or return the batch.</div><div class="g"></div>';
  new Grid(host.querySelector('.g'), { readOnly: true, rows: rows.map((x, i) => ({ ...x, key: i })), keyField: 'key', rowClass: (x) => (x.accepted ? '' : 'tbrerun'),
    columns: [
      { field: 'equipment_code', title: 'Equipment', type: 'link', width: 95, href: (x) => '#/equipment/' + x.equipment_id },
      { field: 'step_name', title: 'Step', type: 'readonly', width: 170 },
      { field: 'entry_code', title: 'Logbook entry', type: 'link', width: 115, href: (x) => '#/logbooks/entries/' + x.logbook_entry_id },
      { field: 'what', title: 'What failed', type: 'readonly', width: 440, cellClass: () => 'tbfail' },
      { field: 'acc', title: 'Accepted', type: 'readonly', width: 280, compute: (x) => (x.accepted ? `${x.accepted_by_name}: ${x.justification}` : 'Not accepted yet'), cellClass: (x) => (x.accepted ? 'tbpass' : 'tbwait') },
      { field: 'act', title: '', type: 'button', width: 90, label: (x) => (can && !x.accepted ? 'Accept…' : ''), onClick: async (x) => {
        if (!can || x.accepted) return;
        const m = await modal({ title: `Accept the flag on ${x.equipment_code}`, okText: 'Accept', intro: `${esc(x.what)}. Write why the results can still be reported (it is kept with your name).`,
          fields: [{ name: 'justification', label: 'Justification', type: 'textarea', required: true }] });
        if (!m) return;
        try { await api(`/testing/batches/${ctx.b.id}/accept-flag`, { method: 'POST', body: { logbook_entry_id: x.logbook_entry_id, justification: m.justification } }); toast('Flag accepted with your justification.'); ctx.reload(); }
        catch (e) { toast(e.message, 'err'); }
      } },
    ] });
}

// QC Review: every weighed aliquot of the batch's samples (used here or not), who weighed it, when, the balance and its
// calibration at the time; the reviewer may not be the person who weighed it (L-2, migration 035)
export async function aliquotsCard(host, ctx) {
  let d; try { d = await api(`/testing/batches/${ctx.b.id}/aliquots`); } catch (_) { return; }
  if (!host || !d.rows.length) { if (host) host.innerHTML = ''; return; }
  host.innerHTML = '<h3 style="margin:14px 0 6px">Weighed aliquots (sample weights logbook)</h3><div class="lb-note" style="margin-bottom:6px">Reviewed here, not by QA in the logbook: check each weight\'s source. Repeat weighings and aliquots not used are listed too. Approving the batch reviews the aliquots it used; the reviewer may not be the person who weighed them.</div><div class="g"></div>';
  new Grid(host.querySelector('.g'), { readOnly: true, rows: d.rows.map((x, i) => ({ ...x, key: i })), keyField: 'key', rowClass: (x) => (x.corrected || x.entry_status === 'Voided' ? 'tbrerun' : !x.used ? 'mutedrow' : ''),
    columns: [
      { field: 'entry_code', title: 'Aliquot', type: 'link', width: 110, href: (x) => '#/logbooks/entries/' + x.logbook_entry_id },
      { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (x) => '#/samples/' + x.sample_id },
      { field: 'weight', title: 'Weight', type: 'readonly', width: 90, align: 'right', format: (v, x) => (v === null ? '' : fmtN(v) + (x.unit ? ' ' + x.unit : '')) },
      { field: 'used', title: 'In this batch', type: 'readonly', width: 190, compute: (x) => (x.used ? `Used for ${x.entry_label}${x.corrected ? ` (scanned at ${fmtN(x.used_weight)}: corrected since)` : ''}` : 'Not used'), cellClass: (x) => (x.corrected ? 'tbfail' : '') },
      { field: 'balance_code', title: 'Balance', type: 'link', width: 200, href: (x) => (x.balance_id ? '#/equipment/' + x.balance_id : null), compute: (x) => (x.balance_code ? `${x.balance_code} ${x.balance_name}` : '') },
      { field: 'calibration', title: 'Calibration then', type: 'readonly', width: 240, cellClass: (x) => (/^Out|failed|No calibration/.test(x.calibration || '') ? 'tbfail' : '') },
      { field: 'weighed_by_name', title: 'Weighed by', type: 'readonly', width: 150 },
      { field: 'weighed_at', title: 'When', type: 'readonly', width: 160, format: (v) => dt(v) },
      { field: 'entry_status', title: 'Status', type: 'readonly', width: 100 },
    ] });
}

// The equipment page: the logbooks covering it, its recent entries and any failure still open
export async function equipmentCard(host, equipmentId) {
  let d; try { d = await api('/logbooks/for-equipment/' + equipmentId); } catch (_) { return; }
  if (!d.logbooks.length && !d.entries.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="card">${section('Logbooks', 'Checks and readings of this equipment (Testing > Logbooks).')}
    ${d.open_failures.length ? `<div class="lb-failbox"><b>Failing:</b> ${d.open_failures.map((f) => `${link('#/logbooks/entries/' + f.logbook_entry_id, f.entry_code)} (${esc(f.logbook_name)}, ${dt(f.entry_at)}): ${esc((f.problems || []).join('; '))}; reason: ${esc(f.failure_reason || '')}`).join('<br>')}<div class="lb-note">No passing entry since: batch steps using it are flagged in QC Review.</div></div>` : ''}
    <div class="lb-due">${d.logbooks.map((x) => `<span class="${x.due ? '' : 'ok'}">${link(`#/logbooks/${x.id}?tab=record`, x.logbook_code)} ${esc(x.logbook_name)}: ${x.last_result ? 'last ' + esc(x.last_result) : 'no entry yet'}${x.due ? ', due now' : ''}</span>`).join('')}</div><div class="g"></div></div>`;
  new Grid(host.querySelector('.g'), { readOnly: true, rows: d.entries, emptyText: 'No entries yet.', rowClass: (x) => (x.result === 'Fail' ? 'lb-fail' : ''), columns: [
    { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.id },
    { field: 'logbook_code', title: 'Logbook', type: 'link', width: 85, href: (x) => '#/logbooks/' + x.logbook_id },
    { field: 'entry_local', title: 'When', type: 'readonly', width: 125, format: (v) => loc(v) },
    { field: 'summary', title: 'Values', type: 'readonly', width: 380 },
    { field: 'result', title: 'Result', type: 'readonly', width: 65, cellClass: (x) => ({ Pass: 'tbpass', Fail: 'tbfail' }[x.result] || '') },
    { field: 'failure_reason', title: 'Reason', type: 'readonly', width: 240 },
    { field: 'status', title: 'Status', type: 'readonly', width: 90 },
  ] });
}

// The lot page: entries about the lot (a culture's passages, the inoculum that made it) and its published values
export async function lotCard(host, lotId) {
  let d; try { d = await api('/logbooks/for-lot/' + lotId); } catch (_) { return; }
  if (!d.entries.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="card">${section('Logbook entries', 'Entries about this lot. A value published by an approved entry inside its validity can be used by a formula at the bench when the lot is scanned.')}<div class="g"></div></div>`;
  new Grid(host.querySelector('.g'), { readOnly: true, rows: d.entries, columns: [
    { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.id },
    { field: 'logbook_code', title: 'Logbook', type: 'link', width: 85, href: (x) => '#/logbooks/' + x.logbook_id },
    { field: 'entry_local', title: 'When', type: 'readonly', width: 125, format: (v) => loc(v) },
    { field: 'summary', title: 'Values', type: 'readonly', width: 420 },
    { field: 'result', title: 'Result', type: 'readonly', width: 65, cellClass: (x) => ({ Pass: 'tbpass', Fail: 'tbfail' }[x.result] || '') },
    { field: 'valid_until', title: 'Usable until', type: 'readonly', width: 160, format: (v, x) => (v ? dt(v) + (x.expired ? ' (expired)' : '') : '') },
    { field: 'status', title: 'Status', type: 'readonly', width: 160, compute: (x) => (x.status === 'Approved' ? `Approved by ${x.approved_by_name || ''}` : x.status) },
  ] });
}

// The stability study page: excursions of the chambers holding its material
export async function excursionsCard(host, studyId) {
  let d; try { d = await api('/logbooks/excursions?study=' + studyId); } catch (_) { return; }
  if (!d.rows.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<div class="card">${section('Chamber excursions', 'Temperature or humidity readings outside the chamber\'s condition while this study\'s material was stored in it (from the Temperature log). Assess each for the study.')}<div class="g"></div></div>`;
  new Grid(host.querySelector('.g'), { readOnly: true, rows: d.rows.map((x, i) => ({ ...x, key: i })), keyField: 'key', rowClass: () => 'lb-fail', columns: [
    { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.logbook_entry_id },
    { field: 'equipment_code', title: 'Chamber', type: 'link', width: 250, href: (x) => '#/equipment/' + x.equipment_id, compute: (x) => `${x.equipment_code} ${x.equipment_name}` },
    { field: 'storage_code', title: 'Material', type: 'readonly', width: 120 },
    { field: 'entry_at', title: 'When', type: 'readonly', width: 160, format: (v) => dt(v) },
    { field: 'problems', title: 'Reading', type: 'readonly', width: 260, compute: (x) => (x.problems || []).join('; ') },
    { field: 'failure_reason', title: 'Reason', type: 'readonly', width: 320 },
    { field: 'window_end', title: 'Back in range', type: 'readonly', width: 160, format: (v) => (v ? dt(v) : 'not yet') },
  ] });
}
