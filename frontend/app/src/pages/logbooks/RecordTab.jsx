// Record entries: a grid (type or paste, fill down), one save, one signature. Failing rows are asked their reason first.
import { useEffect, useMemo, useState } from 'react';
import { recordEntries } from '../../api/logbooks.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { useToast } from '../../components/Toasts.jsx';
import { useUnsavedChanges } from '../../router/useHashRoute.js';
import { entries, fmtN, judge } from './calc.js';
import { Button, Card } from 'react-bootstrap';

const newRow = () => ({ k: 'n' + Math.random().toString(36).slice(2) });

export default function RecordTab({ d, l, fields, reload }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [doneTo, setDoneTo] = useState(null);

  const eqById = useMemo(() => Object.fromEntries(d.equipment.map((e) => [e.equipment_id, e])), [d]);
  const hasInput = useMemo(() => (row) => fields.some((f) => f.field_type !== 'Calculated' && row['f_' + f.field_key] !== undefined && row['f_' + f.field_key] !== null && row['f_' + f.field_key] !== ''), [fields]);

  const columns = useMemo(() => {
    const opt = (x) => ({ value: x.id, label: `${x.lot_code} ${x.item_name}`, match: [x.lot_code] });
    const subjectCols = l.subject === 'Equipment'
      ? [{ field: 'equipment_id', title: 'Equipment', type: 'select', width: 260, required: true, options: d.equipment.map((e) => ({ value: e.equipment_id, label: `${e.equipment_code} ${e.equipment_name}`, match: [e.equipment_code, e.equipment_name] })) }]
      : l.subject === 'Lot' && !l.creates_lot ? [{ field: 'lot_id', title: 'Lot', type: 'select', width: 260, required: true, options: d.opts.lots.map(opt) }]
        : l.subject === 'Sample' ? [{ field: 'sample', title: 'Sample', type: 'text', width: 130, required: true }] : [];
    const lotOpts = d.opts.lots.map(opt);
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
          compute: (row) => { const v = judge(fields, row, eqById[row.equipment_id]).vals[f.field_key]; return v === undefined ? (/\{[a-z_0-9]+\.[a-z_0-9]+\}/.test(f.formula || '') ? 'on save' : '') : fmtN(v); } };
      }
      if (f.field_type === 'Date/time') return { ...base, type: 'text', width: 150, validate: (v) => (v && !/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(v) ? 'YYYY-MM-DD HH:MM' : null) };
      return { ...base, type: 'text' };
    };
    const judged = (row) => (hasInput(row) ? judge(fields, row, eqById[row.equipment_id]) : null);
    const hasLimits = fields.some((f) => f.field_type === 'Pass/Fail' || f.limit_min !== null || f.limit_max !== null || f.equipment_limits);
    return [
      { field: 'entry_at', title: 'When (blank = now)', type: 'text', width: 145, validate: (v) => (v && !/^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}$/.test(String(v).trim()) ? 'YYYY-MM-DD HH:MM, or blank for now' : null) },
      ...subjectCols, ...fields.map(fieldCol),
      { field: 'judged', title: 'Result', type: 'readonly', width: 75,
        compute: (row) => { const j = judged(row); return !j ? '' : j.probs.length ? 'Fail' : hasLimits ? 'Pass' : ''; },
        cellClass: (row) => { const j = judged(row); return !j ? '' : j.probs.length ? 'tbfail' : 'tbpass'; } },
      { field: 'failure_reason', title: 'Reason (when it fails)', type: 'text', width: 260 },
    ];
  }, [d, l, fields, eqById, hasInput]);

  const initial = useMemo(() => {
    const dueSet = new Set(d.due.filter((x) => x.due).map((x) => x.equipment_id));
    return l.subject === 'Equipment' ? d.equipment.filter((e) => e.admin_status === 'In Service' || dueSet.has(e.equipment_id)).map((e, i) => ({ k: 'r' + i, equipment_id: e.equipment_id }))
      : Array.from({ length: 5 }, (_, i) => ({ k: 'r' + i }));
  }, [d, l]);
  const grid = useGrid({ rows: initial, columns, keyField: 'k', allowAdd: true, newRow });
  const rows = grid.state.rows;
  const n = rows.filter(hasInput).length;
  useUnsavedChanges(!doneTo && n > 0);
  useEffect(() => { if (doneTo) location.hash = doneTo; }, [doneTo]); // after the unsaved check has seen nothing pending

  async function save() {
    if (busy) return;
    if (grid.errorCount) { toast('Fix the cells marked in red first (hover a red cell to see why).', 'err'); return; }
    const todo = rows.filter(hasInput);
    if (!todo.length) { toast('Nothing to record: type the values first.', 'err'); return; }
    setBusy(true);
    try {
      // a failing row needs its reason: asked for here, before signing (Alex: "a reason is prompted at failure")
      const reasons = new Map();
      const failing = todo.map((row) => ({ row, j: judge(fields, row, eqById[row.equipment_id]) })).filter((x) => x.j.probs.length && !String(x.row.failure_reason || '').trim());
      if (failing.length) {
        const label = (row) => (l.subject === 'Equipment' ? (eqById[row.equipment_id] ? `${eqById[row.equipment_id].equipment_code} ${eqById[row.equipment_id].equipment_name}` : 'Row') : l.subject === 'Sample' ? row.sample || 'Row' : 'Row');
        const m = await dialogs.form({ title: `${failing.length} entr${failing.length === 1 ? 'y fails' : 'ies fail'}: give the reason`, okText: 'Continue', wide: true,
          intro: 'Say what happened and what was done about it (for example: re-checked, adjusted, taken out of use, supervisor informed). The reason is kept with the entry; any batch step that used the equipment while it was failing is flagged in QC Review.',
          fields: failing.map((x, i) => ({ name: 'r' + i, label: `${label(x.row)}: ${x.j.probs.join('; ')}`, type: 'textarea', required: true })) });
        if (!m) return;
        const ci = columns.findIndex((c) => c.field === 'failure_reason');
        failing.forEach((x, i) => {
          reasons.set(x.row.k, m['r' + i]);
          const vr = grid.view.findIndex((ri) => rows[ri].k === x.row.k);
          if (vr >= 0) grid.act.setCell(vr, ci, m['r' + i]); // shown in the grid too
        });
      }
      const payload = todo.map((row) => {
        const values = {};
        for (const f of fields) if (f.field_type !== 'Calculated') { const v = row['f_' + f.field_key]; if (v !== undefined && v !== null && v !== '') values[f.field_key] = v; }
        return { entry_at: row.entry_at || '', equipment_id: row.equipment_id, lot_id: row.lot_id, sample: row.sample, values, failure_reason: reasons.get(row.k) || row.failure_reason || '' };
      });
      const send = (signature) => recordEntries(l.id, payload, signature);
      let x;
      if (l.signing === 'Signature') {
        x = await dialogs.sign({ what: `${payload.length} ${entries(payload.length)} in ${l.logbook_code} ${l.logbook_name}`, meaning: 'Recorded by', needReason: false, submit: ({ signature }) => send(signature) });
        if (!x) return;
      } else {
        try { x = await send(null); } catch (e) { toast(e.message, 'err'); return; }
      }
      toast(`Recorded ${x.made.length} ${entries(x.made.length)}${x.failed.length ? ` (${x.failed.length} failed, with their reasons)` : ''}${x.lots && x.lots.length ? `; lot${x.lots.length > 1 ? 's' : ''} made: ${x.lots.map((y) => y.lot_code).join(', ')}` : ''}.`);
      reload();
      setDoneTo(`#/logbooks/${l.id}?tab=entries`);
    } finally { setBusy(false); }
  }

  return (
    <Card body>
      <div className="lb-note" style={{ marginBottom: 8 }}>{l.subject === 'Equipment' ? 'One row per piece of equipment the logbook covers; leave a row empty to skip it. ' : ''}Type or paste from Excel, fill down with Ctrl+D. Calculated values and Pass / Fail are a preview: the system calculates and judges each entry when it is saved. A row that fails needs its reason. {l.signing === 'Signature' ? 'One signature records every row.' : 'Entries are recorded under your name (no signature).'}</div>
      <div className="lb-bar"><Button type="button" variant="primary" onClick={save} disabled={busy}>Record entries</Button><span className="lb-note">{n ? `${n} row${n === 1 ? '' : 's'} to record` : ''}</span></div>
      <DataGrid grid={grid} />
    </Card>
  );
}
