// Parts the testing screens share: formats, the bench's rules of thumb (product category settings, analytical runs,
// dilutions, re-preps) and a selectable read-only grid.
import { useEffect, useImperativeHandle } from 'react';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { useSession } from '../../session/SessionProvider.jsx';
import './testing.css';
import { Card, Nav } from 'react-bootstrap';

export const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const day = (v) => (v ? String(v).slice(0, 10) : '');
export const nfmt = (v) => (v === null || v === undefined || v === '' ? '' : String(+Number(v).toPrecision(6)));
export const COUNT_WORDS = [{ value: '1', label: 'Single (1)' }, { value: '2', label: 'Duplicate (2)' }, { value: '3', label: 'Triplicate (3)' }];
export const BENCH_TYPES = ['Batching', 'Weighing', 'Preparation', 'Dilution', 'Plating/Inoculation', 'Incubation', 'Data Entry', 'Calculation', 'Hold Point', 'Split off Test'];
const pad2 = (n) => String(n).padStart(2, '0');
export const loc = (v) => { if (!v) return ''; const x = new Date(v); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())} ${pad2(x.getHours())}:${pad2(x.getMinutes())}`; };
export const isoOf = (v) => { if (v === null || v === undefined || v === '') return null; const x = new Date(String(v).trim().replace(' ', 'T')); if (Number.isNaN(x.getTime())) throw new Error('Not a date and time: ' + v + ' (use YYYY-MM-DD HH:MM)'); return x.toISOString(); };
export const fieldKey = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const sampleHref = (e) => (e.sample_id ? '#/samples/' + e.sample_id : null);
export const plural2 = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;

// ---------------------------------------------------------------- top tabs and the lab check
const TOP_TABS = [['#/testing', 'Backlog'], ['#/testing/batches', 'Batches'], ['#/testing/batches?show=mine', 'My worklist'], ['#/testing/batches?show=review', 'QC Review']];
export function TopTabs({ cur }) {
  return <Nav variant="pills" className="tbtabs">{TOP_TABS.map(([h, l]) => <Nav.Link active={h === cur} key={h} href={h}>{l}</Nav.Link>)}</Nav>;
}
export function useNeedLab() {
  const { site } = useSession();
  return site ? null : <Card body className="err">Choose your lab (top right) first.</Card>;
}

// ---------------------------------------------------------------- a read-only grid whose selection the page can read
// apiRef gets { selectedRows(), flush() } like EditableGrid's
export function SelGrid({ rows, columns, keyField = 'id', apiRef, ...props }) {
  const grid = useGrid({ rows, columns, keyField, readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  useImperativeHandle(apiRef, () => ({ selectedRows: grid.selectedRows, flush: async () => true, grid }), [grid]);
  return <DataGrid grid={grid} {...props} />;
}

// ---------------------------------------------------------------- analytical runs (WD-5)
// a re-reading is labelled RA1-, RA2-... and belongs to an analytical run (run 1 unless a run added it)
export const rlabel = (label, rn) => (Number(rn) > 1 ? `RA${Number(rn) - 1}-${label}` : label);
export const runOfReading = (d, stepRun, entry, rn) => Number(d.reading_runs.find((x) => x.step_run_id === stepRun && x.entry_id === entry && Number(x.run_no) === Number(rn))?.run || 1);
export const runsAt = (d, stepRun) => Math.max(1, ...d.runs.filter((x) => x.step_run_id === stepRun).map((x) => Number(x.run_no)));
export const lastReadingStep = (d) => [...d.steps].filter((x) => x.step_type === 'Data Entry').sort((a, b) => b.sort_order - a.sort_order)[0];
export const valueOf = (d, run, entry, analyte, rn) => d.values.find((v) => v.step_run_id === run && v.entry_id === entry && (v.analyte_id || null) === (analyte || null) && Number(v.run_no) === Number(rn));
export const runsOf = (d, run, entry) => Number(d.run_counts.find((x) => x.step_run_id === run && x.entry_id === entry)?.runs || 1);

// ---------------------------------------------------------------- entries
// a linked daily control's data is in its own batch. past: also the re-prepped entries (0.28.1, Alex: kept in the batch
// with their data, read only, nothing needed from them; the server leaves out entries removed before the batch started)
export const active = (d, past = false) => d.entries.filter((e) => (e.status === 'Active' || (past && e.status === 'Superseded')) && !e.daily_of_entry_id);
export const benchEntries = (d, past = false) => active(d, past).filter((e) => e.entry_type === 'Sample' || e.qc_class === 'Prep');
export const isPast = (e) => e.status === 'Superseded';
export function reprepNote(e) {
  if (isPast(e)) {
    const why = e.reprep_to_reason || String(e.superseded_reason || '').replace(/^Re-prep: /, '');
    const where = e.reprep_to_batch_code ? `now in ${e.reprep_to_batch_code}` : e.reprep_to_status === 'Cancelled' ? 're-prep cancelled' : 'waiting in the backlog';
    return { text: `Re-prepped${why ? ' (' + why + ')' : ''}: ${where}`, href: e.reprep_to_batch_id ? '#/testing/batches/' + e.reprep_to_batch_id : null };
  }
  if (e.reprep_of_batch_code) return { text: `Re-prep of ${e.reprep_of_label || 'a sample'} in ${e.reprep_of_batch_code}`, href: '#/testing/batches/' + e.reprep_of_batch_id };
  return null;
}
export const reprepCol = { field: 'reprep_note', title: 'Re-prep', type: 'readonly', width: 300, help: 'A re-prepped sample stays here with what was recorded, read only; nothing more is needed from it',
  compute: (r) => reprepNote(r)?.text || '', href: (r) => reprepNote(r)?.href || null, cellClass: (r) => (isPast(r) ? 'tbmuted' : '') };
export const kindOf = (e) => (e.entry_type === 'Sample' ? (e.media_lot_id ? 'Lot QA testing' : e.replicate_no > 1 || e.reprep_request_id ? 'Sample (re-prep)' : 'Sample') : e.qc_type);
export const usedFor = (list, run, entry) => list.filter((x) => x.step_run_id === run && (x.entry_id === entry || !x.entry_id));
export const eqLink = (x, after) => ({ text: x.equipment_code, href: x.equipment_id ? '#/equipment/' + x.equipment_id : null, after });
export const lotLink = (x, after) => ({ text: x.lot_code, href: x.lot_id ? '#/inventory/lots/' + x.lot_id : null, after });
export const forWhat = (d, ids) => (ids.length ? `${ids.length} selected entr${ids.length === 1 ? 'y' : 'ies'} (${ids.slice(0, 4).map((i) => d.entries.find((e) => e.id === i)?.label).join(', ')}${ids.length > 4 ? ', …' : ''})` : 'the whole batch (no rows selected)');

// ---------------------------------------------------------------- the matrix drives the bench (migration 039)
export const catSetting = (c, e) => ((e && e.product_category_id && Array.isArray(c.by_category)) ? c.by_category.find((x) => x.category_id === e.product_category_id) || null : null);
export const isWeighed = (c, e) => (e.entry_type === 'Sample' ? !(c.target_mode === 'By product category' && catSetting(c, e)?.not_weighed) : !c.qc_not_weighed);
export const singleTarget = (c) => (c.target_mode === 'Single' || (!c.target_mode && c.target !== undefined && c.target !== null)) && c.target !== null && c.target !== undefined;
export function weightRange(c, e) {
  if (singleTarget(c)) {
    const pct = c.tolerance_unit === '%'; const t = Number(c.target); const tol = Number(c.tolerance || 0);
    return { lo: t - (pct ? t * tol / 100 : tol), hi: t + (pct ? t * tol / 100 : tol) };
  }
  if (c.target_mode === 'By product category') { const x = catSetting(c, e); if (x && !x.not_weighed && x.min !== null && x.min !== undefined && x.max !== null && x.max !== undefined) return { lo: Number(x.min), hi: Number(x.max) }; }
  return null;
}
export function dilutionExpected(c, e) {
  const x = c.mode === 'Serial' ? null : catSetting(c, e);
  if (x && x.aliquot) return { aliquot: Number(x.aliquot), diluent: Number(x.diluent || 0), from: e.product_category };
  if (c.mode !== 'Serial' && c.aliquot) return { aliquot: Number(c.aliquot), diluent: Number(c.diluent || 0), from: null };
  return null;
}
export function incubationWindowOf(c, e) {
  const x = catSetting(c, e);
  if (x && x.window_min !== null && x.window_min !== undefined) return { min: x.window_min, max: x.window_max, from: e.product_category };
  return { min: c.window_min, max: c.window_max, from: null };
}

// ---------------------------------------------------------------- dilutions per analytical run (0.27.0, migration 048)
export const dilutionSteps = (d) => d.steps.filter((x) => x.step_type === 'Dilution');
export const dilFactor = (data) => { let f = null; for (const p of (data && data.fields) || []) { const a = Number(p.aliquot); if (a > 0) f = (f || 1) * (a + (Number(p.diluent) || 0)) / a; } return f; };
export function entryDilution(d, entry, run) {
  for (const ds of dilutionSteps(d)) {
    const v = d.values.filter((x) => x.step_run_id === ds.id && x.entry_id === entry && !x.analyte_id && Number(x.run_no) <= run).sort((a, b) => Number(b.run_no) - Number(a.run_no))[0];
    if (v) return dilFactor(v.data);
  }
  return null;
}
export const readingDilution = (d, s, r) => entryDilution(d, r.entry_id, runOfReading(d, s.id, r.entry_id, r.run_no));
export function pickText(d, r) {
  const e = d.entries.find((x) => x.id === r.entry_id);
  const ps = (d.picks || []).filter((p) => e && p.requested_test_id === e.requested_test_id && p.entry_id === r.entry_id && Number(p.run_no) === Number(r.run_no));
  return ps.map((p) => `✓ ${p.analyte_name || 'All analytes'}: ${p.note}`).join('; ');
}

// "Waiting for {weigh.weight}" in words: the step's name and the value it gives
export function humanWaiting(d, w) {
  return String(w).replace(/\{(\w+)\.(\w+)\}/g, (m, k, f) => {
    const st = d.steps.find((x) => x.step_key === k); if (!st) return m;
    const what = { weight: 'weight', factor: 'dilution factor', final_volume: 'final volume', reading: 'reading', result: 'result' }[f]
      || ((st.config?.fields || []).find((x) => fieldKey(x.label) === f)?.label) || f.replace(/_/g, ' ');
    return `${st.step_name}: ${what}`;
  });
}

// The presumptive result email (step setting "Alert the client"): who, and when it was queued
export function alertText(a) {
  const xs = Array.isArray(a) ? a : [];
  return xs.length ? `${xs.map((x) => x.to_name || x.to_address).join(', ')}, ${loc(xs[0].queued_at)} (${xs[0].by})` : '';
}

// What is reported for a sample and analyte: the reading chosen, or the average of the readings ticked (WD-5)
export function choiceText(x) {
  if (!x.chosen_entry_id) return x.n ? 'Not chosen yet' : 'No result';
  if (x.mode === 'Average') return `Average of ${(x.readings || []).length} readings: ${x.reported ?? nfmt(x.value)}`;
  const c = x.candidates.find((y) => y.entry_id === x.chosen_entry_id && Number(y.run_no) === Number(x.chosen_run_no)) || {};
  return `${c.label || ''}${x.n > 1 ? ` (run ${c.run || 1})` : ''}: ${x.reported ?? x.value_text ?? nfmt(x.value)}${x.auto_chosen ? ' (only reading)' : ''}`
    + (/^Picked by the analyst/.test(x.justification || '') ? ` · ${x.justification}` : '');   // 0.27.0: the analyst's pick and note
}
export const storedBasis = (x) => (x.basis === 'Average' ? `Average of ${(x.averaged || []).length} readings` : x.basis === 'Picked' ? 'One reading chosen' : 'The only reading')
  + (x.justification ? `: ${x.justification}` : '');
export const verdictClass = (v) => ({ Pass: 'tbpass', Fail: 'tbfail' }[v] || 'tbwait');
