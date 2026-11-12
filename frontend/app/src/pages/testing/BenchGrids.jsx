// The bench grids: Batching (the batch's entries and spiked samples), Weighing (one weight, or replicate weighings),
// Dilution (per product category, and further dilutions of later runs), Data Entry (readings of the run shown) and
// Plating. Bench values save as they are typed (0.27.0); changing a recorded value is a correction and asks its reason.
// Re-prepped entries (0.28.1) are shown read only, greyed, with where they went in a last column.
import { useCallback, useMemo, useRef } from 'react';
import * as api from '../../api/testing.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import {
  active, benchEntries, day, dilFactor, dilutionExpected, dilutionSteps, eqLink, isPast, isWeighed, kindOf, lotLink, nfmt,
  pickText, readingDilution, reprepCol, reprepNote, rlabel, runOfReading, runsOf, sampleHref, usedFor, valueOf, weightRange,
} from './shared.jsx';
import { Button } from 'react-bootstrap';

const blank = (v) => v === null || v === undefined || v === '';
const benchRowClass = (r) => (r.sup ? 'tbsup' : r.run_no > 1 ? 'tbrerun' : '');
// a value that is now recorded: a later change to it is a correction (needs a reason). had: true/false, or one flag
// per analyte (a_<id>) or per weighing (w<k>)
const markHad = (had, ch) => {
  if (had && typeof had === 'object') { const h = { ...had }; for (const f of Object.keys(ch)) { const m = /^(?:a_|w)(.+)$/.exec(f); if (m && !blank(ch[f])) h[m[1]] = true; } return h; }
  return true;
};
const withSup = (rows) => rows.map((r) => ({ ...r, sup: isPast(r) }));

function BenchGrid({ ctx, s, rows, columns, canWork, toValues, toolbar, apiRef, onMenu }) {
  const cols = useMemo(() => (rows.some((r) => r.sup)
    ? [...columns.map((c) => (c.type === 'readonly' || c.type === 'link' ? c : { ...c, editable: (r) => !r.sup && (c.editable ? c.editable(r) : true) })), reprepCol]
    : columns), [rows, columns]);
  const orig = useRef(null); const seen = useRef(null);
  if (seen.current !== rows) { seen.current = rows; orig.current = new Map(rows.map((r) => [r.key, r])); }
  const tv = useRef(toValues); tv.current = toValues;
  const { dialogs, reload } = ctx;
  const autosaved = useCallback((changes) => { for (const ch of changes) { const o = orig.current.get(ch.key); if (o) orig.current.set(ch.key, { ...o, ...ch, had: markHad(o.had, ch) }); } }, []);
  const save = useCallback(async (changes) => {
    const vals = []; let correction = false;
    for (const ch of changes) {
      const o = orig.current.get(ch.key);
      for (const v of tv.current({ ...o, ...ch }, o, ch)) { vals.push(v); if (v.correction) correction = true; }
    }
    let reason = '';
    if (correction) { reason = await dialogs.reason('recorded bench values (a correction)'); if (reason === null) throw new Error('Not saved: changing a recorded value needs a reason.'); }
    await api.saveValues(s.id, vals.map(({ correction: _c, ...v }) => v), reason);
  }, [s.id, dialogs]);
  return <EditableGrid rows={rows} columns={cols} keyField="key" readOnly={!canWork} needReason={false} toolbar={toolbar} emptyText="Nothing to record here."
    rowClass={benchRowClass} autosave autosaved={autosaved} save={save} afterSave={reload} apiRef={apiRef} onContextMenu={onMenu} />;
}

// ---------------------------------------------------------------- Batching
const supRow = (r) => (r.status === 'Superseded' ? 'tbsup' : '');
export function BatchingGrid({ ctx, canWork, apiRef, onMenu }) {
  const { d, reload } = ctx;
  const rows = useMemo(() => d.entries.map((e) => ({ key: e.id, entry_id: e.id, ...e, kind: kindOf(e) })), [d]);
  const columns = useMemo(() => {
    const samples = active(d).filter((e) => e.entry_type === 'Sample');
    return [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 170 },
      { field: 'qc_class', title: 'QC class', type: 'readonly', width: 85 },
      { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 130 },
      { field: 'matrix', title: 'Matrix', type: 'readonly', width: 100 },
      { field: 'due_date', title: 'Due', type: 'readonly', width: 95, format: day },
      { field: 'rush_status', title: 'Rush', type: 'readonly', width: 95, format: (v) => (v && v !== 'None' ? v : '') },
      { field: 'parent_entry_id', title: 'Spiked sample', type: 'select', width: 160, help: 'The sample a matrix spike (and its duplicate) is made from',
        options: samples.map((x) => ({ value: x.id, label: x.label })), editable: (r) => ['Matrix Spike', 'Matrix Spike Duplicate'].includes(r.qc_type) },
      { field: 'status', title: 'Status', type: 'readonly', width: 300, compute: (r) => (reprepNote(r)?.text || (r.status === 'Superseded' ? r.superseded_reason || 'Superseded' : r.daily_batch_code ? `The day's control, recorded in ${r.daily_batch_code}` : '')),
        href: (r) => (reprepNote(r)?.href || (r.daily_batch_id && r.status !== 'Superseded' ? '#/testing/batches/' + r.daily_batch_id : null)) },
    ];
  }, [d]);
  const save = useCallback(async (changes) => { for (const ch of changes) await api.setParent(ch.key, ch.parent_entry_id); }, []);
  return <EditableGrid rows={rows} columns={columns} keyField="key" readOnly={!canWork} needReason={false} emptyText="No entries."
    rowClass={supRow} save={save} afterSave={reload} apiRef={apiRef} onContextMenu={onMenu} />;
}

// ---------------------------------------------------------------- Weighing
const outside = (r) => r.range && !blank(r.weight) && (Number(r.weight) < r.range.lo - 1e-12 || Number(r.weight) > r.range.hi + 1e-12);
const weightValues = (r, o) => [{ entry_id: r.entry_id, value_num: r.weight, correction: o.had }];
const positive = (v) => (v !== null && v <= 0 ? 'A weight must be above zero' : null);
export function WeighingGrid(p) {
  const { ctx, s } = p;
  const { d } = ctx; const c = s.config || {}; const unit = c.unit || 'g';
  // replicate weighings (migration 033): one column per weighing, and their average (the step's weight)
  const reps = Math.max(1, Math.min(10, Number(c.replicates) || 1));
  const rows = useMemo(() => (reps > 1 ? [] : withSup(benchEntries(d, true).map((e) => {
    const v = valueOf(d, s.id, e.id, null, 1);
    return { key: e.id, entry_id: e.id, ...e, kind: kindOf(e), weight: v ? (v.value_num === null ? null : Number(v.value_num)) : null, had: !!(v && v.value_num !== null), entered_by: v?.entered_by || '',
      aliquot: v && v.logbook_entry_id ? (v.data || {}).aliquot || 'aliquot' : '', aliquot_id: v ? v.logbook_entry_id : null,
      weighed: isWeighed(c, e), range: weightRange(c, e) };
  }))), [d, s, reps]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useMemo(() => [
    { field: 'position', title: '#', type: 'readonly', width: 40 },
    { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
    { field: 'kind', title: 'Type', type: 'readonly', width: 170 },
    { field: 'matrix', title: 'Matrix', type: 'readonly', width: 100 },
    { field: 'weight', title: `Weight (${unit})`, type: 'number', width: 110, validate: positive, editable: (r) => !r.aliquot_id && r.weighed },
    { field: 'aliquot', title: 'Aliquot', type: 'link', width: 115, href: (r) => (r.aliquot_id ? '#/logbooks/entries/' + r.aliquot_id : null), help: 'Weighed in the sample weights logbook and scanned here (Scan aliquot)' },
    { field: 'check', title: 'Check', type: 'readonly', width: 120, compute: (r) => (!r.range || blank(r.weight) ? '' : outside(r) ? 'Outside the range' : 'In range'),
      cellClass: (r) => (outside(r) ? 'tbfail' : '') },
    { field: 'product_category', title: 'Category', type: 'readonly', width: 130 },
    { field: 'range', title: 'Accepted', type: 'readonly', width: 130, compute: (r) => (!r.weighed ? 'Not weighed' : r.range ? `${nfmt(+r.range.lo.toPrecision(6))} to ${nfmt(+r.range.hi.toPrecision(6))}` : '') },
    { field: 'balance', title: 'Balance', type: 'readonly', width: 150, compute: (r) => usedFor(d.equipment_used, s.id, r.entry_id).map((x) => x.equipment_code).join(', '),
      links: (r) => usedFor(d.equipment_used, s.id, r.entry_id).map((x) => eqLink(x)) },
    { field: 'spike', title: 'Spike', type: 'readonly', width: 200, compute: (r) => usedFor(d.materials, s.id, r.entry_id).filter((x) => x.purpose === 'Spike').map((x) => `${x.lot_code} ${nfmt(x.volume)} ${x.volume_unit || ''}`).join(', '),
      links: (r) => usedFor(d.materials, s.id, r.entry_id).filter((x) => x.purpose === 'Spike').map((x) => lotLink(x, `${nfmt(x.volume)} ${x.volume_unit || ''}`.trim())) },
    { field: 'entered_by', title: 'Recorded by', type: 'readonly', width: 140 },
  ], [d, s, unit]);
  if (reps > 1) return <ReplicateWeighingGrid {...p} reps={reps} unit={unit} />;
  return <BenchGrid {...p} rows={rows} columns={columns} toValues={weightValues} />;
}

// N weights per entry (paste a row of 10 weights from the balance printout); the average is worked out by the database
// once all N are in (entry_weight), and shown here
function ReplicateWeighingGrid(p) {
  const { ctx, s, reps, unit } = p;
  const { d } = ctx;
  const ks = useMemo(() => Array.from({ length: reps }, (_, i) => i + 1), [reps]);
  const rows = useMemo(() => withSup(benchEntries(d, true).map((e) => {
    const r = { key: e.id, entry_id: e.id, ...e, kind: kindOf(e), had: {} };
    for (const k of ks) { const v = valueOf(d, s.id, e.id, null, k); r['w' + k] = v && v.value_num !== null ? Number(v.value_num) : null; r.had[k] = !!(v && v.value_num !== null); }
    return r;
  })), [d, s, ks]);
  const columns = useMemo(() => {
    const avg = (r) => { const w = ks.map((k) => r['w' + k]); return w.every((x) => !blank(x)) ? w.reduce((a, b) => a + Number(b), 0) / reps : null; };
    return [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 150 },
      ...ks.map((k) => ({ field: 'w' + k, title: `${k}`, type: 'number', width: 72, help: `Weighing ${k} of ${reps} (${unit})`, validate: positive })),
      { field: 'avg', title: `Average (${unit})`, type: 'readonly', width: 120, compute: (r) => { const a = avg(r); return a === null ? `${ks.filter((k) => r['w' + k] !== null && r['w' + k] !== undefined).length} of ${reps}` : String(Number(a.toPrecision(6))); } },
      { field: 'balance', title: 'Balance', type: 'readonly', width: 150, compute: (r) => usedFor(d.equipment_used, s.id, r.entry_id).map((x) => x.equipment_code).join(', '),
        links: (r) => usedFor(d.equipment_used, s.id, r.entry_id).map((x) => eqLink(x)) },
    ];
  }, [d, s, ks, reps, unit]);
  const toValues = (r, o, ch) => ks.filter((k) => ('w' + k) in ch).map((k) => ({ entry_id: r.entry_id, run_no: k, value_num: r['w' + k], correction: o.had[k] }));
  return <BenchGrid {...p} rows={rows} columns={columns} toValues={toValues} />;
}

// ---------------------------------------------------------------- toolbar helper: fill the empty rows' cells
function fillEmpty(apiRef, isEmpty, values) {
  const g = apiRef.current?.grid; if (!g) return;
  const idx = Object.fromEntries(Object.keys(values({})).map((f) => [f, g.columns.findIndex((x) => x.field === f)]));
  g.view.forEach((ri, vr) => {
    const r = g.state.rows[ri];
    if (r.sup || !isEmpty(r)) return;
    const vals = values(r); if (!vals) return;
    for (const [f, v] of Object.entries(vals)) if (idx[f] >= 0 && v !== undefined) g.act.setCell(vr, idx[f], String(v));
  });
}

// ---------------------------------------------------------------- Dilution
export function DilutionGrid(p) {
  const { ctx, s, canWork, apiRef } = p;
  const { d } = ctx; const c = s.config || {}; const n = Math.min(Math.max(Number(c.fields_per_entry) || 1, 1), 4);
  const rows = useMemo(() => withSup(benchEntries(d, true).map((e) => {
    const v = valueOf(d, s.id, e.id, null, 1); const f = v?.data?.fields || [];
    const r = { key: e.id, entry_id: e.id, ...e, kind: kindOf(e), had: !!(v && f.length), entered_by: v?.entered_by || '', expected: dilutionExpected(c, e) };
    for (let i = 1; i <= n; i++) { r['a' + i] = f[i - 1]?.aliquot ?? null; r['d' + i] = f[i - 1]?.diluent ?? null; }
    return r;
  })), [d, s, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns = useMemo(() => {
    const factor = (r) => { let f = null; for (let i = 1; i <= n; i++) { const a = Number(r['a' + i]); if (!blank(r['a' + i]) && a > 0) f = (f || 1) * (a + (Number(r['d' + i]) || 0)) / a; } return f; };
    const finalVol = (r) => { let v = null; for (let i = 1; i <= n; i++) { const a = Number(r['a' + i]); if (!blank(r['a' + i]) && a > 0) v = a + (Number(r['d' + i]) || 0); } return v; };
    const differs = (r) => r.expected && !blank(r.a1) && (Math.abs(Number(r.a1) - r.expected.aliquot) > 1e-9 || Math.abs((Number(r.d1) || 0) - r.expected.diluent) > 1e-9);
    const cols = [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 150 },
    ];
    for (let i = 1; i <= n; i++) cols.push({ field: 'a' + i, title: n > 1 ? `Aliquot ${i}` : 'Aliquot', type: 'number', width: 80, min: 0 }, { field: 'd' + i, title: n > 1 ? `Diluent ${i}` : 'Diluent', type: 'number', width: 80, min: 0 });
    cols.forEach((x) => { if (x.field === 'a1' || x.field === 'd1') x.cellClass = (r) => (differs(r) ? 'flag' : ''); });
    cols.push({ field: 'factor', title: 'Factor', type: 'readonly', width: 75, compute: (r) => nfmt(factor(r)) }, { field: 'final', title: 'Final volume', type: 'readonly', width: 95, compute: (r) => nfmt(finalVol(r)) },
      { field: 'exp', title: 'Expected', type: 'readonly', width: 150, help: 'The amounts for the sample\'s product category (its matrix), or the step\'s default',
        compute: (r) => (r.expected ? `${nfmt(r.expected.aliquot)} + ${nfmt(r.expected.diluent)}${r.expected.from ? ' (' + r.expected.from + ')' : ''}` : '') },
      { field: 'entered_by', title: 'Recorded by', type: 'readonly', width: 140 },
      // 0.27.0: further dilutions recorded with later analytical runs (each run's readings use their own)
      { field: 'further', title: 'Later runs', type: 'readonly', width: 180, help: 'Further dilutions recorded with an analytical run (Add analytical run); that run\'s readings use them',
        compute: (r) => d.values.filter((v) => v.step_run_id === s.id && v.entry_id === r.entry_id && !v.analyte_id && Number(v.run_no) > 1)
          .sort((a, b) => Number(a.run_no) - Number(b.run_no)).map((v) => `Run ${v.run_no}: ×${nfmt(+dilFactor(v.data).toPrecision(6))}`).join(', ') });
    return cols;
  }, [d, s, n]);
  const toValues = (r, o) => {
    const fields = []; for (let i = 1; i <= n; i++) if (!blank(r['a' + i])) fields.push({ aliquot: Number(r['a' + i]), diluent: Number(r['d' + i]) || 0 });
    return [{ entry_id: r.entry_id, data: fields.length ? { fields } : {}, correction: o.had }];
  };
  const toolbar = canWork && rows.some((r) => r.expected)
    ? <Button type="button" variant="outline-secondary" size="sm" className="mini" id="dl_std" onClick={() => fillEmpty(apiRef, (r) => blank(r.a1) && r.expected, (r) => ({ a1: r.expected?.aliquot, d1: r.expected?.diluent }))}>
      {(c.by_category || []).length ? 'Each sample\'s amounts (by its matrix) for empty rows' : `Standard dilution (${nfmt(c.aliquot)} + ${nfmt(c.diluent || 0)}) for empty rows`}</Button> : null;
  return <BenchGrid {...p} rows={rows} columns={columns} toValues={toValues} toolbar={toolbar} />;
}

// ---------------------------------------------------------------- Data Entry: the readings of the analytical run shown
export function ReadingGrid(p) {
  const { ctx, s, curRun } = p;
  const { d } = ctx; const c = s.config || {};
  const ans = useMemo(() => { const ids = c.analyte_ids && c.analyte_ids.length ? c.analyte_ids : null; return d.analytes.filter((a) => !ids || ids.includes(a.analyte_id)); }, [d, s]); // eslint-disable-line react-hooks/exhaustive-deps -- c is s.config
  const rows = useMemo(() => {
    const out = [];
    for (const e of active(d, true)) {
      const runs = runsOf(d, s.id, e.id);
      for (let rn = 1; rn <= runs; rn++) {
        if (runOfReading(d, s.id, e.id, rn) !== curRun) continue;
        const r = { key: `${e.id}:${rn}`, entry_id: e.id, run_no: rn, ...e, label: rlabel(e.label, rn), kind: kindOf(e), had: {} };
        for (const a of ans) {
          const v = valueOf(d, s.id, e.id, a.analyte_id, rn);
          r['a_' + a.analyte_id] = v ? (a.result_type === 'Numeric' ? (v.value_num === null ? null : Number(v.value_num)) : v.value_text) : null;
          r.had[a.analyte_id] = !!(v && (v.value_num !== null || v.value_text));
        }
        out.push(r);
      }
    }
    return withSup(out);
  }, [d, s, curRun, ans]);
  const columns = useMemo(() => {
    // readings that are not results (039): flagged until the entry has a valid reading in a later run
    const inv = (d.invalid_readings || []).filter((x) => x.step_run_id === s.id);
    const invOf = (r) => inv.find((x) => x.entry_id === r.entry_id && x.run_no === r.run_no);
    const notResult = (a, v) => (a.invalid_values || []).includes(v);
    const stdOf = (r) => usedFor(d.materials, s.id, r.entry_id).filter((x) => x.purpose === 'Standard' && x.entry_id === r.entry_id);
    const isCheck = (r) => ['ICV', 'CCV'].includes(r.qc_type);
    return [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 150 },
      { field: 'run_no', title: 'Reading', type: 'readonly', width: 65, help: 'Reading 2 and up (RA1-, RA2-...) come from added analytical runs; every reading is kept and the reviewer decides what is reported' },
      ...ans.map((a) => (a.result_type === 'Numeric'
        ? { field: 'a_' + a.analyte_id, title: `${a.analyte_name}${c.value_unit ? ` (${c.value_unit})` : ''}`, type: 'number', width: 115 }
        : { field: 'a_' + a.analyte_id, title: a.analyte_name, type: (a.result_values || []).length ? 'select' : 'text', options: a.result_values || [], width: 120,
          cellClass: (r) => (notResult(a, r['a_' + a.analyte_id]) ? 'tbfail' : '') })),
      { field: 'standard', title: 'Check standard', type: 'readonly', width: 150, compute: (r) => (isCheck(r) ? stdOf(r).map((x) => x.lot_code).join(', ') || 'record it' : ''),
        links: (r) => (isCheck(r) ? stdOf(r).map((x) => lotLink(x)) : []),
        cellClass: (r) => (isCheck(r) && !d.materials.some((x) => x.step_run_id === s.id && x.entry_id === r.entry_id && x.purpose === 'Standard') ? 'flag' : '') },
      { field: 'rerun', title: 'Re-run', type: 'readonly', width: 150, help: 'A reading that is not a result (e.g. Indeterminate, Signal error): read it again in a new analytical run (right-click the row)',
        compute: (r) => { const x = invOf(r); return !x ? '' : x.replaced ? 'Read again' : 'Re-run required'; }, cellClass: (r) => { const x = invOf(r); return x && !x.replaced ? 'tbfail' : ''; } },
      // 0.27.0 (after the existing columns, which tests paste by number): the dilution of this reading's run, and the analyst's pick
      ...(dilutionSteps(d).length ? [{ field: 'dil', title: 'Dilution', type: 'readonly', width: 80, align: 'right', help: 'The dilution factor this reading was made on (its analytical run\'s)',
        compute: (r) => { const f = readingDilution(d, s, r); return f === null ? '' : '×' + nfmt(+f.toPrecision(6)); } }] : []),
      { field: 'picked', title: 'Reported', type: 'readonly', width: 220, help: 'The reading the analyst picked to report (QC Review uses it unless the reviewer chooses otherwise)',
        compute: (r) => pickText(d, r), cellClass: (r) => (pickText(d, r) ? 'tbpass' : '') },
    ];
  }, [d, s, ans]); // eslint-disable-line react-hooks/exhaustive-deps -- c is s.config
  const toValues = (r, o, ch) => ans.filter((a) => ('a_' + a.analyte_id) in ch).map((a) => (a.result_type === 'Numeric'
    ? { entry_id: r.entry_id, analyte_id: a.analyte_id, run_no: r.run_no, value_num: r['a_' + a.analyte_id], correction: o.had[a.analyte_id] }
    : { entry_id: r.entry_id, analyte_id: a.analyte_id, run_no: r.run_no, value_text: r['a_' + a.analyte_id] ?? '', correction: o.had[a.analyte_id] }));
  return <BenchGrid {...p} rows={rows} columns={columns} toValues={toValues} />;
}

// ---------------------------------------------------------------- Plating / Inoculation (WD-4)
export function PlatingGrid(p) {
  const { ctx, s, canWork, apiRef } = p;
  const { d } = ctx; const c = s.config || {};
  const rows = useMemo(() => withSup(benchEntries(d, true).map((e) => {
    const v = valueOf(d, s.id, e.id, null, 1);
    return { key: e.id, entry_id: e.id, ...e, kind: kindOf(e), plates: v && v.value_num !== null ? Number(v.value_num) : null, levels: v?.data?.levels || null, had: !!(v && v.value_num !== null), entered_by: v?.entered_by || '' };
  })), [d, s]);
  const columns = useMemo(() => {
    const media = (r) => usedFor(d.materials, s.id, r.entry_id).filter((x) => x.purpose === 'Media');
    const strains = (r) => d.materials.filter((x) => x.entry_id === r.entry_id && x.purpose === 'Strain');
    return [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 150 },
      { field: 'plates', title: 'Plates', type: 'int', width: 70, min: 0, help: '0 = not plated' },
      { field: 'levels', title: 'Levels plated', type: 'text', width: 140, help: 'e.g. 1:10, 1:100' },
      { field: 'media', title: 'Media lot', type: 'readonly', width: 160, compute: (r) => media(r).map((x) => x.lot_code).join(', '), links: (r) => media(r).map((x) => lotLink(x)),
        cellClass: (r) => (r.plates > 0 && !media(r).length ? 'flag' : '') },
      { field: 'strain', title: 'Strain', type: 'readonly', width: 150, compute: (r) => strains(r).map((x) => x.lot_code).join(', '), links: (r) => strains(r).map((x) => lotLink(x)) },
      { field: 'entered_by', title: 'Recorded by', type: 'readonly', width: 140 },
    ];
  }, [d, s]);
  const toValues = (r, o) => [{ entry_id: r.entry_id, value_num: r.plates, data: r.levels ? { levels: r.levels } : {}, correction: o.had }];
  const per = c.plates_per_entry || 1;
  const toolbar = canWork ? <Button type="button" variant="outline-secondary" size="sm" className="mini" id="pl_std" onClick={() => fillEmpty(apiRef, (r) => blank(r.plates), () => ({ plates: per }))}>
    {nfmt(per)} plate{Number(per) === 1 ? '' : 's'} for empty rows</Button> : null;
  return <BenchGrid {...p} rows={rows} columns={columns} toValues={toValues} toolbar={toolbar} />;
}
