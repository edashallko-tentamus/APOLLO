// A logbook's Entries tab: what is due, filters (dates, equipment, status) and the entries with their values.
import { useMemo, useState } from 'react';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { dt, fmtN, loc, needsReason, resultClass, sensorWhen } from './calc.js';

const STATUSES = ['', 'Recorded', 'Approved', 'Returned', 'Voided', 'All'].map((s) => ({ value: s, label: s || 'All but voided' }));
const entryRowClass = (x) => (x.result === 'Fail' ? 'lb-fail' : x.status === 'Voided' ? 'mutedrow' : '');

export default function EntriesTab({ d, l, filt }) {
  const [f, setF] = useState(filt);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const due = d.due.filter((x) => x.due);

  const columns = useMemo(() => {
    const allFields = [...d.fields.filter((x) => x.version_id === d.effective_id), ...d.old_fields];
    const keys = []; for (const x of allFields) if (!keys.find((k) => k.field_key === x.field_key)) keys.push(x);
    const subjectCol = l.subject === 'Equipment' ? [{ field: 'equipment_code', title: 'Equipment', type: 'link', width: 230, href: (x) => '#/equipment/' + x.equipment_id, compute: (x) => `${x.equipment_code} ${x.equipment_name}` }]
      : l.subject === 'Lot' ? [{ field: 'lot_code', title: 'Lot', type: 'link', width: 220, href: (x) => (x.lot_id ? '#/inventory/lots/' + x.lot_id : null), compute: (x) => `${x.lot_code || ''} ${x.lot_name || ''}`.trim() }]
        : l.subject === 'Sample' ? [{ field: 'sample_code', title: 'Sample', type: 'link', width: 130, href: (x) => '#/samples/' + x.sample_id }] : [];
    return [
      { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.id },
      { field: 'entry_local', title: 'When', type: 'readonly', width: 130, format: (v, x) => (x.sensor ? sensorWhen(x) : loc(v)) },
      ...subjectCol,
      ...keys.map((k) => ({ field: 'v_' + k.field_key, title: k.label + (k.unit ? ` (${k.unit})` : ''), type: 'readonly', width: Math.max(90, Math.min(200, k.label.length * 8 + 30)),
        align: ['Number', 'Calculated'].includes(k.field_type) ? 'right' : undefined,
        compute: (x) => { const v = (x.display || {})[k.field_key]; return v === undefined ? '' : ['Number', 'Calculated'].includes(k.field_type) ? fmtN(v) : String(v); } })),
      { field: 'result', title: 'Result', type: 'readonly', width: 70, cellClass: resultClass },
      { field: 'problems', title: 'Outside its limit / reason', type: 'readonly', width: 320, cellClass: (x) => (needsReason(x) ? 'tbfail' : ''), compute: (x) => [...(x.problems || []), x.failure_reason ? 'Reason: ' + x.failure_reason : needsReason(x) ? 'REASON NEEDED' : ''].filter(Boolean).join('; ') },
      ...(l.creates_lot ? [{ field: 'created_lot_code', title: 'Lot made', type: 'link', width: 110, href: (x) => (x.created_lot_id ? '#/inventory/lots/' + x.created_lot_id : null) }] : []),
      ...(l.validity_hours ? [{ field: 'valid_until', title: 'Usable until', type: 'readonly', width: 160, format: (v, x) => (v ? dt(v) + (x.expired ? ' (expired)' : '') : '') }] : []),
      { field: 'recorded_by_name', title: 'Recorded by', type: 'readonly', width: 150 },
      { field: 'status', title: 'Status', type: 'readonly', width: 230, cellClass: (x) => (x.overdue ? 'tbfail' : x.status === 'Returned' ? 'tbwait' : ''),
        compute: (x) => (x.status === 'Approved' ? (x.approved_in_batch_code ? `Reviewed in ${x.approved_in_batch_code}` : `Approved by ${x.approved_by_name || ''}`) : x.status === 'Recorded' && x.review_due ? `Recorded; QA by ${x.review_due}${x.overdue ? ' (overdue)' : ''}` : x.status) },
    ];
  }, [d, l]);

  function show() {
    const p = new URLSearchParams({ tab: 'entries' });
    for (const k of ['from', 'to', 'equipment', 'status']) if (f[k]) p.set(k, f[k]);
    location.hash = `#/logbooks/${l.id}?${p}`;
  }
  const eqOpts = [{ value: '', label: 'All' }, ...d.equipment.map((e) => ({ value: e.equipment_id, label: `${e.equipment_code} ${e.equipment_name}` }))];
  const per = l.entry_frequency === 'Daily' ? 'today' : l.entry_frequency === 'Weekly' ? 'this week' : 'this month';

  return (
    <div className="card">
      {d.due.length > 0 && <div className="lb-due">{d.due.map((x, i) => (
        <span key={i} className={x.due ? '' : 'ok'}>{x.equipment_code ? x.equipment_code + ' ' + x.equipment_name : l.logbook_code}: {x.due ? 'due ' + per : 'done'}</span>
      ))}</div>}
      <div className="lb-bar">
        <label>From <input type="date" value={f.from} onChange={(e) => set('from')(e.target.value)} /></label>
        <label>To <input type="date" value={f.to} onChange={(e) => set('to')(e.target.value)} /></label>
        {l.subject === 'Equipment' && <label>Equipment <SmartSelect value={f.equipment} options={eqOpts} onChange={set('equipment')} /></label>}
        <label>Status <SmartSelect value={f.status} options={STATUSES} onChange={set('status')} /></label>
        <button type="button" className="btn" onClick={show}>Show</button>
        {due.length > 0 && d.can_record && <a className="btn primary" href={`#/logbooks/${l.id}?tab=record`}>Record entries ({due.length} due)</a>}
      </div>
      <ReadGrid rows={d.entries} columns={columns} search emptyText="No entries." rowClass={entryRowClass} />
    </div>
  );
}
