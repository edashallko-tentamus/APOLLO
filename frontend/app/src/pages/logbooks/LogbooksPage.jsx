// Testing > Logbooks (#/logbooks): the lab's logbooks and what is due now; + New logbook.
import { useMemo } from 'react';
import { createLogbook, listLogbooks } from '../../api/logbooks.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { dt, KINDS } from './calc.js';
import './logbooks.css';

const AUDIT = { kind: 'logbooks' };
const SUB = 'Equipment checks, temperatures, cultures, inocula, daily controls and sample weights, recorded in a grid and signed once. QA approves each logbook\'s entries daily or weekly; a failed entry on a piece of equipment flags the batches that used it in QC Review.';

const DUE_COLS = [
  { field: 'logbook_code', title: 'Logbook', type: 'link', width: 90, href: (x) => `#/logbooks/${x.logbook_id}?tab=record` },
  { field: 'logbook_name', title: 'Name', type: 'readonly', width: 260 },
  { field: 'entry_frequency', title: 'Due', type: 'readonly', width: 90 },
  { field: 'equipment_code', title: 'Equipment', type: 'link', width: 260, href: (x) => (x.equipment_id ? '#/equipment/' + x.equipment_id : null), compute: (x) => (x.equipment_id ? `${x.equipment_code} ${x.equipment_name}` : '(the logbook)') },
  { field: 'last_entry_at', title: 'Last entry', type: 'readonly', width: 170, format: (v) => (v ? dt(v) : 'none yet') },
];
const COLS = [
  { field: 'logbook_code', title: 'Logbook', type: 'link', width: 90, href: (x) => '#/logbooks/' + x.id },
  { field: 'logbook_name', title: 'Name', type: 'readonly', width: 280 },
  { field: 'kind', title: 'Kind', type: 'readonly', width: 130 },
  { field: 'subject', title: 'About', type: 'readonly', width: 100, format: (v, x) => (v === 'Equipment' ? `${x.equipment_count} unit${x.equipment_count === 1 ? '' : 's'}` : v === 'None' ? '-' : v) },
  { field: 'entry_frequency', title: 'Entries', type: 'readonly', width: 90 },
  { field: 'review_frequency', title: 'QA review', type: 'readonly', width: 90 },
  { field: 'effective_version', title: 'Design', type: 'readonly', width: 120, compute: (x) => (x.effective_version ? `v${x.effective_version}` : 'not approved') + (x.draft_version ? ` (v${x.draft_version} draft)` : '') },
  { field: 'to_review', title: 'To approve', type: 'readonly', width: 90, align: 'right', cellClass: (x) => (x.overdue ? 'tbfail' : ''), format: (v, x) => (v ? `${v}${x.overdue ? ` (${x.overdue} late)` : ''}` : '') },
  { field: 'due_now', title: 'Due now', type: 'readonly', width: 75, align: 'right', format: (v) => v || '', cellClass: (x) => (x.due_now ? 'tbwait' : '') },
  { field: 'last_entry_at', title: 'Last entry', type: 'readonly', width: 160, format: (v) => dt(v) },
  { field: 'status', title: 'Status', type: 'readonly', width: 80 },
];
const mutedInactive = (x) => (x.status !== 'Active' ? 'mutedrow' : '');

export default function LogbooksPage() {
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error } = useApi((o) => listLogbooks(o), []);
  const due = useMemo(() => (d?.due || []).map((x, i) => ({ ...x, key: i })), [d]);
  if (error && !d) return <><PageHeader title="Logbooks" audit={AUDIT} /><div className="card err">{error.message}</div></>;
  if (!d) return <><PageHeader title="Logbooks" audit={AUDIT} /><div className="loading">Loading…</div></>;

  async function newLogbook() {
    const r = await dialogs.form({ title: 'New logbook', okText: 'Create', wide: true,
      intro: 'The design (its fields and limits) is added next and approved by QA before entries can be recorded. These settings can be changed later, with a reason.',
      fields: [
        { name: 'logbook_name', label: 'Name', required: true },
        { name: 'kind', label: 'Kind', type: 'select', blank: false, value: 'Equipment check', options: KINDS },
        { name: 'subject', label: 'Each entry is about', type: 'select', blank: false, value: 'Equipment', options: [{ value: 'Equipment', label: 'A piece of equipment' }, { value: 'Lot', label: 'An inventory lot' }, { value: 'Sample', label: 'A sample (weighed aliquots)' }, { value: 'None', label: 'Nothing in particular' }] },
        { name: 'entry_frequency', label: 'Entries due', type: 'select', blank: false, value: 'Daily', options: ['Daily', 'Weekly', 'Monthly', 'As needed'] },
        { name: 'review_frequency', label: 'QA approves the entries', type: 'select', blank: false, value: 'Weekly', options: ['Daily', 'Weekly'] },
        { name: 'signing', label: 'Entries are', type: 'select', blank: false, value: 'Signature', options: [{ value: 'Signature', label: 'Signed (user ID and password)' }, { value: 'Recorded', label: 'Recorded (no signature)' }] },
        { name: 'description', label: 'What it is for', type: 'textarea' },
      ],
      submit: (v) => {
        const body = v.kind === 'Sample weights' ? { ...v, subject: 'Sample', review_route: 'Batch' } : v;
        return createLogbook(body);
      } });
    if (!r) return;
    toast(`${r.logbook_code} created: add its fields, then QA approves the design.`);
    location.hash = `#/logbooks/${r.id}?tab=design`;
  }

  return <>
    <PageHeader title="Logbooks" subtitle={SUB} audit={AUDIT} actions={<>
      {d.can_review && <a className="btn" href="#/logbooks/review">Logbook review ({d.to_review}{d.overdue ? `, ${d.overdue} overdue` : ''})</a>}
      {d.can_design && <button type="button" className="btn primary" onClick={newLogbook}>+ New logbook</button>}
    </>} />
    {due.length > 0 && <div className="card">
      <h3 style={{ margin: '0 0 6px' }}>Due now</h3>
      <div className="lb-note">Entries the lab owes today, this week or this month (a Daily, Weekly or Monthly logbook, per piece of equipment it covers).</div>
      <ReadGrid rows={due} columns={DUE_COLS} keyField="key" />
    </div>}
    <div className="card"><ReadGrid rows={d.rows} columns={COLS} search emptyText="No logbooks yet." rowClass={mutedInactive} /></div>
  </>;
}
