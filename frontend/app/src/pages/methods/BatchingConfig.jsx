// Batching step settings. WD-1.2 (Alex, 2026-10-13): the QC types in one grid; under it, each QC type's acceptance
// criteria, each with a row per analyte of the test: whether this QC judges the analyte, and its own limit (prefilled from
// the criterion's default). The per-analyte table is folded away (the page got too long); a summary lists the exceptions.
import { useMemo, useRef, useState } from 'react';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { CfgGrid, filled, useCfgGrid } from './ConfigEditors.jsx';
import { Field, numOf, Pick, str } from './shared.jsx';

const FREQ = [{ value: 'Once', label: 'Once' }, { value: 'Every N', label: 'Every N' }, { value: 'Daily', label: 'Daily' }];
const MATERIAL = [{ value: '', label: '' }, { value: 'Strains', label: 'Strains of the test\'s organisms' }];
const LIMIT_REFS = ['LOQ', '½ LOQ', 'LOD'];
const nn = (v) => v ?? null;
const sameAsDefault = (r, c) => nn(r.min) === nn(c.min) && nn(r.max) === nn(c.max) && (r.limit_ref || null) === (c.limit_ref || null);
const limitText = (sh, c) => (sh === 'Qualitative' ? '' : sh === 'Max' ? (c.limit_ref ? `≤ ${c.limit_ref}` : c.max !== null && c.max !== undefined ? `≤ ${c.max}` : '')
  : (nn(c.min) !== null || nn(c.max) !== null ? `${c.min ?? '?'} to ${c.max ?? '?'}` : ''));

// rows for every analyte of the test: its own row if set, else an exception (earlier layout), else the default
const rowsFor = (d, c) => d.analytes.map((a) => {
  const own = (c.analytes || []).find((x) => x.analyte_id === a.analyte_id);
  const ov = own ? null : (c.overrides || []).find((x) => x.analyte_id === a.analyte_id);
  const from = own || ov || c;
  return { analyte_id: a.analyte_id, analyte_name: a.analyte_name, applies: own ? own.applies !== false : true,
    min: from.min ?? null, max: from.max ?? null, limit_ref: (own ? own.limit_ref : c.limit_ref) || null };
});

// One acceptance criterion: its type, default limit, the exceptions, and the folded per-analyte table.
// Its latest state is kept in store.current[k] (read when the step is saved, kept if the QC type is removed and put back).
function Criterion({ k, store, d, ed, shapeOf, isOpen, toggle, onRemove }) {
  const init = store.current[k];
  const [lt, setLt] = useState(init.limit_type || '');
  const [def, setDef] = useState({ min: nn(init.min), max: nn(init.max), limit_ref: init.limit_ref || null }); // the default in force
  const [minT, setMinT] = useState(str(init.min)); const [maxT, setMaxT] = useState(str(init.max));
  const startRows = useMemo(() => d.analytes.map((a) => init.rows.find((r) => r.analyte_id === a.analyte_id)
    || { analyte_id: a.analyte_id, analyte_name: a.analyte_name, applies: true, min: init.min ?? null, max: init.max ?? null, limit_ref: init.limit_ref || null }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const sh = shapeOf(lt);
  const cols = useMemo(() => {
    const c = [{ field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 210 }, { field: 'applies', title: 'Applies', type: 'bool', width: 75, help: 'Untick where this QC does not judge the analyte' }];
    if (sh === 'Range') c.push({ field: 'min', title: 'Min', type: 'number', width: 90 }, { field: 'max', title: 'Max', type: 'number', width: 90 });
    if (sh === 'Max') c.push({ field: 'max', title: 'Max', type: 'number', width: 90 }, { field: 'limit_ref', title: 'Or limit', type: 'select', options: ['', ...LIMIT_REFS], width: 90, help: 'A limit of the analyte instead of a number' });
    c.push({ field: 'shown', title: 'Limit', type: 'readonly', width: 120, compute: (r) => (!r.applies ? 'Not judged' : sh === 'Qualitative' ? lt : limitText(sh, r)) });
    return c;
  }, [sh, lt]);
  const grid = useGrid({ rows: startRows, columns: cols, keyField: 'analyte_id', readOnly: !ed });
  const rows = grid.state.rows;
  store.current[k] = { limit_type: lt || null, ...def, rows };

  // changing the default moves every analyte still on the old default; analytes with their own limit keep it
  function applyDefault(next) {
    const n = { ...def, ...next };
    grid.reset(rows.map((r) => (sameAsDefault(r, def) ? { ...r, min: n.min, max: n.max, limit_ref: n.limit_ref } : r)));
    setDef(n);
  }
  const fillAll = () => grid.reset(rows.map((r) => ({ ...r, min: def.min, max: def.max, limit_ref: def.limit_ref })));
  const ex = rows.filter((r) => r.applies === false || (sh !== 'Qualitative' && !sameAsDefault(r, def)));

  return (
    <div className="wdcrit">
      <div className="wdcritbar">
        <Pick value={lt} options={d.lists.limitTypes.map((x) => x.limit_type)} disabled={!ed} onChange={setLt} aria-label="Criterion" />
        <span className="wddef">{sh === 'Qualitative' ? <span className="help">No numbers: tick the analytes it applies to.</span> : <>
          <span className="help">Default</span>{' '}
          {sh === 'Range' ? <><input type="number" step="any" placeholder="min" value={minT} disabled={!ed} onChange={(e) => setMinT(e.target.value)} onBlur={() => applyDefault({ min: numOf(minT) })} /> to </> : 'max '}
          <input type="number" step="any" placeholder="max" value={maxT} disabled={!ed} onChange={(e) => setMaxT(e.target.value)} onBlur={() => applyDefault({ max: numOf(maxT) })} />
          {sh === 'Max' && <> or <Pick value={def.limit_ref} options={LIMIT_REFS} disabled={!ed} onChange={(v) => applyDefault({ limit_ref: v || null })} aria-label="Or limit" /></>}
          {ed && <> <button type="button" className="btn mini" title="Set every analyte to the default" onClick={fillAll}>Fill all</button></>}</>}</span>
        {ed && <button type="button" className="btn mini ghost" onClick={onRemove}>Remove</button>}
      </div>
      <div className="wdexcrow">
        <div className="wdexc">{ex.length ? <><span className="help">Exceptions:</span> {ex.map((r) => (
          <span key={r.analyte_id} className="wdexc1">{r.analyte_name}: {r.applies === false ? 'not judged' : limitText(sh, r) || 'no limit'}</span>))}</>
          : <span className="help">{rows.length ? `All ${rows.length} analytes ${sh === 'Qualitative' ? 'are judged' : 'use the default'}.` : 'Add the analytes on tab 2 first.'}</span>}</div>
        <a href="#" className="wdtoggle" onClick={(e) => { e.preventDefault(); toggle(); }}>{isOpen ? 'Hide the analytes ▴' : `Show all ${d.analytes.length} analytes ▾`}</a>
      </div>
      {isOpen && <div className="wdcritg"><DataGrid grid={grid} emptyText="Add the analytes on tab 2 first." /></div>}
    </div>
  );
}

let seq = 0;
export default function BatchingConfig({ cfg, d, ed, readRef }) {
  const shapeOf = (name) => d.lists.limitTypes.find((x) => x.limit_type === name)?.shape || 'Range';
  const classOf = (qt) => d.lists.qcTypes.find((x) => x.qc_type === qt)?.default_class || null;
  const store = useRef({});
  const [crits, setCrits] = useState(() => { // qc_type → [criterion key]
    const out = {};
    (cfg.qc || []).forEach((q) => { out[q.qc_type] = (q.criteria || []).map((c) => {
      const k = 'c' + (++seq); store.current[k] = { limit_type: c.limit_type, min: c.min ?? null, max: c.max ?? null, limit_ref: c.limit_ref || null, rows: rowsFor(d, c) }; return k; }); });
    return out;
  });
  const [open, setOpen] = useState(() => new Set());
  const [max, setMax] = useState(str(cfg.max_samples));
  const qcCols = useMemo(() => [
    { field: 'qc_type', title: 'QC type', type: 'select', options: d.lists.qcTypes.map((x) => x.qc_type), width: 210, required: true },
    { field: 'qc_class', title: 'Class', type: 'select', options: ['Prep', 'Analytical'], width: 95,
      compute: (r) => r.qc_class || (r.qc_type ? classOf(r.qc_type) : null), assign: (r, v) => { r.qc_class = v; } },
    { field: 'frequency', title: 'How often', type: 'select', options: FREQ, width: 95,
      help: 'Once (per batch), Every N samples (bracketing), or Daily: one set per method per day, shared by that day\'s batches (micro controls)' },
    { field: 'material', title: 'Made from', type: 'select', options: MATERIAL, width: 200,
      help: 'Strains: the control must be made from Microbiological Strain lots of this test\'s organisms; the bench refuses anything else' },
    { field: 'count', title: 'Per batch', type: 'int', min: 1, width: 80 }, { field: 'every_n', title: 'Every N', type: 'int', min: 1, width: 75 },
  ], [d.lists]); // eslint-disable-line react-hooks/exhaustive-deps
  const qcG = useCfgGrid((cfg.qc || []).map((q) => ({ qc_type: q.qc_type, qc_class: q.qc_class, frequency: q.frequency, material: q.material || null, count: q.count ?? null, every_n: q.every_n ?? null })),
    qcCols, ed, () => ({ frequency: 'Once', count: 1 }));
  const qcRows = filled(qcG);
  const types = [...new Set(qcRows.map((r) => r.qc_type).filter(Boolean))];

  const addCrit = (qt) => { const k = 'c' + (++seq); store.current[k] = { limit_type: null, min: null, max: null, limit_ref: null, rows: [] }; setCrits((m) => ({ ...m, [qt]: [...(m[qt] || []), k] })); };
  const removeCrit = (qt, k) => setCrits((m) => ({ ...m, [qt]: m[qt].filter((x) => x !== k) }));
  const toggle = (k) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  readRef.current = () => {
    const qc = [];
    qcRows.forEach((r) => {
      if (!r.qc_type || qc.some((x) => x.qc_type === r.qc_type)) return;
      const q = { qc_type: r.qc_type, qc_class: r.qc_class || classOf(r.qc_type), frequency: r.frequency || 'Once', criteria: [] };
      if (q.frequency === 'Every N') q.every_n = r.every_n; else if (q.frequency === 'Once') q.count = r.count ?? 1;
      if (r.material) q.material = r.material;
      (crits[r.qc_type] || []).forEach((k) => {
        const c = store.current[k];
        if (!c.limit_type) throw new Error(`${r.qc_type}: choose the criterion (or remove it).`);
        const sh = shapeOf(c.limit_type); const o = { limit_type: c.limit_type };
        if (sh !== 'Qualitative') { if (c.min !== null && sh === 'Range') o.min = c.min; if (c.max !== null) o.max = c.max; if (c.limit_ref && sh === 'Max') o.limit_ref = c.limit_ref; }
        o.analytes = c.rows.map((x) => {
          const a = { analyte_id: x.analyte_id, applies: x.applies !== false };
          if (sh === 'Range') { a.min = x.min ?? null; a.max = x.max ?? null; }
          if (sh === 'Max') { a.max = x.max ?? null; if (x.limit_ref) a.limit_ref = x.limit_ref; }
          return a;
        });
        q.criteria.push(o);
      });
      qc.push(q);
    });
    return { max_samples: numOf(max), qc };
  };

  return <>
    <div className="grid4"><Field label="Maximum client samples per batch" help="QC samples ride on top of this number">
      <input id="c_max" type="number" min="1" value={max} disabled={!ed} onChange={(e) => setMax(e.target.value)} /></Field></div>
    <Field label="QC each batch carries" help="One row per QC type. Prep QC travels through preparation like a sample; Analytical QC is instrument-only. Every N samples gives opening and closing (bracketing) entries; Daily is one set per method per day, shared by the day's batches.">
      <CfgGrid id="c_qc" grid={qcG} /></Field>
    <div className="field"><label>Acceptance criteria</label>
      <div className="help">Each criterion&apos;s default applies to every analyte. Analytes with their own limit, or that this QC does not judge, are listed as exceptions under it. &quot;Show all analytes&quot; opens the full list to change them (untick Applies to leave one out; fill down and paste from Excel work there).</div>
      <div id="c_crit">{types.length ? types.map((qt) => (
        <div key={qt} className="wdqc">
          <div className="wdqchead"><b>{qt}</b> <span className="help">{qcRows.find((r) => r.qc_type === qt)?.qc_class || classOf(qt) || ''} QC</span>
            {ed && <button type="button" className="btn mini" onClick={() => addCrit(qt)}>+ Criterion</button>}</div>
          {(crits[qt] || []).length ? crits[qt].map((k) => (
            <Criterion key={k} k={k} store={store} d={d} ed={ed} shapeOf={shapeOf} isOpen={open.has(k)} toggle={() => toggle(k)} onRemove={() => removeCrit(qt, k)} />))
            : <div className="help">No acceptance criterion yet.</div>}
        </div>)) : <div className="help">Add a QC type above to set its acceptance criteria.</div>}</div>
    </div>
  </>;
}
