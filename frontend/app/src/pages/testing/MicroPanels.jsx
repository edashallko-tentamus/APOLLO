// Preparation (one form for the batch), Incubation (entries and incubator loads, WD-4) and Split off Test (the requests)
import { useCallback, useMemo, useRef, useState } from 'react';
import * as api from '../../api/testing.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import {
  alertText, benchEntries, eqLink, fieldKey, forWhat, incubationWindowOf, isoOf, isPast, kindOf, loc, nfmt, reprepCol, sampleHref, SelGrid,
} from './shared.jsx';
import { Button } from 'react-bootstrap';

// ---------------------------------------------------------------- Preparation
export function PreparationForm({ ctx, s, canWork }) {
  const fields = (s.config || {}).fields || [];
  const vals = s.fields || {};
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((f) => [fieldKey(f.label), String(vals[fieldKey(f.label)] ?? '')])));
  const [busy, setBusy] = useState(false);
  if (!fields.length) return <div className="tbnote">This step has no fields to fill in; complete it when the preparation is done.</div>;
  async function save() {
    const out = {}; let correction = false;
    for (const [k, raw] of Object.entries(form)) { const v = raw.trim(); if (v !== '') out[k] = v; if ((vals[k] ?? '') !== '' && String(vals[k]) !== v) correction = true; }
    let reason = '';
    if (correction) { reason = await ctx.dialogs.reason(`${s.step_name}: changed fields (a correction)`); if (reason === null) return; }
    setBusy(true);
    try { await api.saveFields(s.id, out, reason); ctx.toast('Saved.'); ctx.reload(); } catch (e) { ctx.toast(e.message, 'err'); } finally { setBusy(false); }
  }
  return <>
    <div className="tbform">{fields.map((f) => {
      const k = fieldKey(f.label); const t = f.type === 'Number' ? 'number' : f.type === 'Date' ? 'date' : f.type === 'Time' ? 'time' : 'text';
      return <div className="field" key={k}><label htmlFor={'pf_' + k}>{f.label}</label>
        <input id={'pf_' + k} data-k={k} type={t} step={t === 'number' ? 'any' : undefined} value={form[k] ?? ''} disabled={!canWork} onChange={(e) => setForm((x) => ({ ...x, [k]: e.target.value }))} /></div>;
    })}</div>
    {canWork && <Button type="button" variant="primary" id="pf_save" disabled={busy} onClick={save}>Save</Button>}
    <div className="help" style={{ marginTop: 6 }}>Filled once for the whole batch. Number fields feed the calculation.</div>
  </>;
}

// ---------------------------------------------------------------- Incubation
const pastRow = (r) => (isPast(r) ? 'tbsup' : '');
export function IncubationPanel({ ctx, s, canWork, apiRef, onMenu }) {
  const { d, opts, toast, dialogs, reload } = ctx;
  const cfg = s.config || {}; const unitW = cfg.duration_unit === 'days' ? 'd' : 'h';
  const loads = useMemo(() => d.loads.filter((l) => l.step_run_id === s.id), [d, s]);
  const ents = useMemo(() => benchEntries(d, true).map((e) => ({ ...e, key: e.id, entry_id: e.id, kind: kindOf(e), win: incubationWindowOf(cfg, e) })), [d, s]); // eslint-disable-line react-hooks/exhaustive-deps
  const entCols = useMemo(() => {
    const loadsOf = (id) => loads.filter((l) => !l.entry_ids || l.entry_ids.includes(id));
    return [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 160 },
      { field: 'window', title: 'Window', type: 'readonly', width: 170, help: 'The acceptable time: the sample\'s product category (its matrix) when the step sets one, else the step\'s',
        compute: (r) => (r.win.min === null || r.win.min === undefined ? '' : `${nfmt(r.win.min)} to ${nfmt(r.win.max)} ${unitW}${r.win.from ? ' (' + r.win.from + ')' : ''}`) },
      { field: 'load', title: 'Load', type: 'readonly', width: 380, compute: (r) => loadsOf(r.entry_id).map((l) => `${l.equipment_code} in ${loc(l.time_in)}${l.time_out ? ', out ' + loc(l.time_out) : ''}`).join('; ') || (isPast(r) ? '' : 'Not in an incubator yet'),
        links: (r) => loadsOf(r.entry_id).map((l) => eqLink(l, `in ${loc(l.time_in)}${l.time_out ? ', out ' + loc(l.time_out) : ''}`)),
        cellClass: (r) => (loadsOf(r.entry_id).length || isPast(r) ? '' : 'flag') },
      ...(ents.some(isPast) ? [reprepCol] : []),
    ];
  }, [loads, ents, unitW]);

  async function newLoad() {
    const sel = apiRef.current?.selectedRows() || [];
    if (sel.length && sel.every(isPast)) { toast('Those samples were re-prepped: they go into an incubator with their new batch.', 'err'); return; }
    const ids = [...new Set(sel.filter((r) => !isPast(r)).map((r) => r.entry_id))];
    const types = (s.equipment_types || []).map((t) => t.equipment_type_id);
    const list = opts.equipment.filter((e) => !types.length || types.includes(e.equipment_type_id));
    if (!list.length) { toast('This lab has no incubator of the type this step uses.', 'err'); return; }
    const m = await dialogs.form({ title: `Incubator load: ${s.step_name}`, okText: 'Start', intro: `For ${forWhat(d, ids)}. The incubator must be available and in calibration.`,
      fields: [
        { name: 'equipment_id', label: 'Incubator', type: 'select', required: true, options: list.map((e) => ({ value: e.id, label: `${e.equipment_code} ${e.equipment_name}${e.availability !== 'Available' ? ' · ' + e.availability : ''}${e.calibration_status === 'Deficient' ? ' · out of calibration' : ''}` })) },
        { name: 'time_in', label: 'Time in', value: loc(new Date()), required: true, help: 'YYYY-MM-DD HH:MM (now by default)' },
        { name: 'temperature', label: 'Temperature read (°C)', type: 'number' },
      ] });
    if (!m) return;
    try { await api.startLoad(s.id, { ...m, time_in: isoOf(m.time_in), entry_ids: ids }); toast('Load started.'); reload(); } catch (e) { toast(e.message, 'err'); }
  }

  const loadRows = useMemo(() => {
    const label = (id) => d.entries.find((e) => e.id === id)?.label || '';
    return loads.map((l) => ({ ...l, key: l.id, entries: l.entry_ids ? l.entry_ids.map(label).join(', ') : 'Whole batch', tin: loc(l.time_in), tout: loc(l.time_out) }));
  }, [loads, d]);
  const orig = useRef(null); orig.current = new Map(loadRows.map((r) => [r.key, r]));
  const loadCols = useMemo(() => [
    { field: 'equipment_code', title: 'Incubator', type: 'link', width: 95, href: (r) => '#/equipment/' + r.equipment_id },
    { field: 'entries', title: 'Holds', type: 'readonly', width: 230 },
    { field: 'tin', title: 'Time in', type: 'text', width: 140 },
    { field: 'tout', title: 'Time out', type: 'text', width: 140 },
    { field: 'duration', title: 'Duration', type: 'readonly', width: 90, compute: (r) => (r.duration === null || r.duration === undefined ? '' : `${nfmt(Number(r.duration).toFixed(1))} ${r.duration_unit === 'days' ? 'd' : 'h'}`) },
    { field: 'temperature', title: '°C', type: 'number', width: 60 },
    { field: 'check_text', title: 'Check', type: 'readonly', width: 230, cellClass: (r) => (r.check_text ? 'tbfail' : '') },
    { field: 'note', title: 'Note (why acceptable)', type: 'text', width: 230 },
    // the incubator's sensor over the whole load, when one is linked (0.25.0; after the existing columns, which tests paste by number)
    { field: 'sensor', title: 'Sensor during the load', type: 'readonly', width: 190, compute: (r) => (!r.sensor ? '' : !r.sensor.n ? 'No readings' : `${nfmt(r.sensor.lo)} to ${nfmt(r.sensor.hi)} °C (${r.sensor.n} readings)`) },
    { field: 'out', title: '', type: 'button', width: 85, label: (r) => (canWork && !r.time_out ? 'Take out' : ''),
      onClick: async (r) => { if (!canWork || r.time_out) return; try { await api.updateLoad(r.id, { time_out: 'now' }); toast('Taken out.'); reload(); } catch (e) { toast(e.message, 'err'); } } },
  ], [canWork, toast, reload]);
  const saveLoads = useCallback(async (changes) => {
    let correction = false; const bodies = [];
    for (const ch of changes) {
      const o = orig.current.get(ch.key); const body = {};
      if ('tin' in ch) { body.time_in = isoOf(ch.tin); correction = true; }
      if ('tout' in ch) { body.time_out = isoOf(ch.tout); if (o.time_out) correction = true; }
      if ('temperature' in ch) { body.temperature = ch.temperature; if (o.temperature !== null && o.temperature !== undefined) correction = true; }
      if ('note' in ch) body.note = ch.note;
      bodies.push([ch.key, body]);
    }
    let reason = '';
    if (correction) { reason = await dialogs.reason('recorded incubator loads (a correction)'); if (reason === null) throw new Error('Not saved: a correction needs a reason.'); }
    for (const [id, body] of bodies) await api.updateLoad(id, { ...body, reason });
  }, [dialogs]);

  return <>
    <h3 style={{ margin: '4px 0 6px' }}>Entries</h3>
    <SelGrid rows={ents} columns={entCols} keyField="key" apiRef={apiRef} rowClass={pastRow} onContextMenu={onMenu}
      toolbar={canWork ? <Button type="button" variant="outline-secondary" size="sm" className="mini" data-inc="new" onClick={newLoad}>Put in an incubator (the selected rows, or all)</Button> : null} />
    <h3 style={{ margin: '16px 0 6px' }}>Incubator loads</h3>
    <EditableGrid rows={loadRows} columns={loadCols} keyField="key" readOnly={!canWork} needReason={false} emptyText="No loads yet." save={saveLoads} afterSave={reload} />
  </>;
}

// ---------------------------------------------------------------- Split off Test
const SPLIT_COLS = [
  { field: 'sample_code', title: 'Sample', type: 'link', width: 140, href: (r) => '#/samples/' + r.sample_id },
  { field: 'finding', title: 'Finding', type: 'readonly', width: 220 },
  { field: 'test_name', title: 'Test to order', type: 'readonly', width: 230 },
  { field: 'status', title: 'Status', type: 'readonly', width: 130, cellClass: (r) => (r.status === 'Awaiting consent' ? 'flag' : '') },
  { field: 'decided_by_name', title: 'Decision recorded by', type: 'readonly', width: 160 },
  { field: 'decision_note', title: 'Note', type: 'readonly', width: 240 },
  { field: 'alerts', title: 'Client alerted', type: 'readonly', width: 300, help: 'The presumptive result email (step setting "Alert the client"): who, and when it was queued in the Outbox',
    compute: (r) => alertText(r.alerts) },
];
export function SplitPanel({ ctx, s }) {
  const rows = useMemo(() => ctx.d.splits.filter((x) => x.step_run_id === s.id), [ctx.d, s]);
  return <ReadGrid rows={rows} columns={SPLIT_COLS} emptyText={s.status === 'Completed' ? 'No sample had a finding: nothing was split off.' : 'Requests appear when the step is completed.'} />;
}
