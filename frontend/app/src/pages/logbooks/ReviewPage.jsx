// QA > Logbook review (#/logbooks/review): tick the entries checked, approve them with one signature; late ones first.
import { useEffect, useMemo, useState } from 'react';
import { approveEntries, getReview, returnEntry } from '../../api/logbooks.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { entries, loc, needsReason, resultClass } from './calc.js';
import './logbooks.css';

const AUDIT = { kind: 'logbooks' };
const SUB = 'QA approves each logbook\'s entries daily or weekly (as the logbook says); late ones first. Tick the entries checked, then approve them with one signature. Entries you recorded or corrected are approved by someone else. A sample weights logbook is reviewed in the batch that uses it, not here.';
const NONE = [];
const lbName = (x) => x.logbook_code + ' ' + x.logbook_name;
const mayPick = (x) => !x.mine && x.status === 'Recorded' && !needsReason(x);
const reviewRowClass = (x) => (x.result === 'Fail' ? 'lb-fail' : x.mine ? 'mutedrow' : '');

export default function ReviewPage() {
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error, reload } = useApi((o) => getReview(o), []);
  const [lb, setLb] = useState('');
  const rows = useMemo(() => (d ? d.rows.map((x) => ({ ...x, pick: false, mine: x.created_by === d.me })) : NONE), [d]);
  const canReview = !!d?.can_review;

  const columns = useMemo(() => [
    { field: 'pick', title: 'Approve', type: 'bool', width: 70, editable: (x) => canReview && mayPick(x) },
    { field: 'logbook_code', title: 'Logbook', type: 'link', width: 85, href: (x) => '#/logbooks/' + x.logbook_id },
    { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.id },
    { field: 'entry_local', title: 'When', type: 'readonly', width: 125, format: (v) => loc(v) },
    { field: 'about', title: 'About', type: 'readonly', width: 210, compute: (x) => (x.equipment_code ? `${x.equipment_code} ${x.equipment_name}` : x.lot_code ? `${x.lot_code} ${x.lot_name || ''}` : x.sample_code || '') },
    { field: 'summary', title: 'Values', type: 'readonly', width: 420 },
    { field: 'result', title: 'Result', type: 'readonly', width: 65, cellClass: resultClass },
    { field: 'why', title: 'Outside its limit / reason', type: 'readonly', width: 300, compute: (x) => [...(x.problems || []), x.failure_reason ? 'Reason: ' + x.failure_reason : ''].filter(Boolean).join('; ') },
    { field: 'recorded_by_name', title: 'Recorded by', type: 'readonly', width: 140 },
    { field: 'review_due', title: 'Approve by', type: 'readonly', width: 115, format: (v, x) => (v ? String(v).slice(0, 10) + (x.overdue ? ' (late)' : '') : ''), cellClass: (x) => (x.overdue ? 'tbfail' : '') },
    { field: 'status', title: 'Status', type: 'readonly', width: 210, cellClass: (x) => (needsReason(x) ? 'tbfail' : ''), compute: (x) => (x.status === 'Returned' ? `Returned: ${x.returned_note || ''}` : needsReason(x) ? 'Reason needed first' : x.mine ? 'Recorded by you' : 'Recorded') },
    { field: 'ret', title: '', type: 'button', width: 90, label: (x) => (canReview && !x.mine ? 'Return…' : ''), onClick: async (x) => {
      if (!canReview || x.mine) return;
      const m = await dialogs.form({ title: `Return ${x.entry_code}`, okText: 'Return it', fields: [{ name: 'note', label: 'What needs correcting', type: 'textarea', required: true }],
        submit: (v) => returnEntry(x.id, v.note) });
      if (m) { toast('Returned for correction.'); reload(); }
    } },
  ], [canReview, dialogs, toast, reload]);

  const grid = useGrid({ rows, columns, readOnly: false });
  const { reset, act } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);

  if (error && !d) return <><PageHeader title="Logbook review" audit={AUDIT} /><div className="card err">{error.message}</div></>;
  if (!d) return <><PageHeader title="Logbook review" audit={AUDIT} /><div className="loading">Loading…</div></>;
  const logbooks = [...new Set(d.rows.map(lbName))];
  const late = d.rows.filter((x) => x.overdue).length;

  function filterBy(v) { setLb(v); act.setFilter(v); } // as before: the logbook narrows the grid's search
  function tickAll() { reset(grid.state.rows.map((x) => (mayPick(x) && (!lb || lbName(x) === lb) ? { ...x, pick: true } : x))); }
  async function approve() {
    const ids = grid.state.rows.filter((x) => x.pick).map((x) => x.id);
    if (!ids.length) { toast('Tick the entries to approve first.', 'err'); return; }
    const m = await dialogs.form({ title: `Approve ${ids.length} ${entries(ids.length)}`, okText: 'Continue', fields: [{ name: 'comment', label: 'Comment (optional)', type: 'textarea' }] });
    if (!m) return;
    const r = await dialogs.sign({ what: `QA approval of ${ids.length} logbook ${entries(ids.length)}`, meaning: 'Approved by', needReason: false,
      submit: ({ signature }) => approveEntries(ids, signature, m.comment) });
    if (r) { toast(`Approved ${r.approved} ${entries(r.approved)}.`); reload(); }
  }

  return <>
    <PageHeader title="Logbook review" subtitle={SUB} audit={AUDIT} />
    <div className="card">
      <div className="lb-bar">
        {d.can_review ? <><button type="button" className="btn primary" onClick={approve}>Approve ticked (signed)</button><button type="button" className="btn" onClick={tickAll}>Tick all I may approve</button></>
          : <span className="lb-note">QA (logbook.review) approves these.</span>}
        <label>Logbook <SmartSelect value={lb} options={[{ value: '', label: 'All' }, ...logbooks.map((x) => ({ value: x, label: x }))]} onChange={filterBy} /></label>
        <span className="lb-note">{d.rows.length} waiting{late > 0 && <>, <b className="short">{late} overdue</b></>}</span>
      </div>
      <DataGrid grid={grid} search emptyText="Nothing waiting for QA." rowClass={reviewRowClass} />
    </div>
  </>;
}
