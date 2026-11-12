// One batch: one tab per workflow step (?step=<key>) plus Results and QC (?step=results). useApi drops an answer that
// arrives after a newer load started, so an older load never draws over a newer one (the old page's _batchLoad, 0.36.1).
import { useMemo } from 'react';
import * as api from '../../api/testing.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import { usePrintLabels } from '../../components/labels/usePrintLabels.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { ResultsPanel } from './ResultPanels.jsx';
import { day, dt } from './shared.jsx';
import StepPanel from './StepPanel.jsx';
import { Button, Card, Nav } from 'react-bootstrap';

const icon = (s) => (s.status === 'Completed' ? '✓' : s.status === 'In progress' ? '●' : '○');

export default function BatchPage({ params, query }) {
  const id = params[0];
  const { data, error, reload } = useApi((o) => Promise.all([api.getBatch(id, o), api.batchOptions(id, o)]), [id]);
  if (error && !data) return <Card body className="err">{error.message}</Card>;
  if (!data) return <div className="loading">Loading…</div>;
  return <BatchView d={data[0]} opts={data[1]} query={query} reload={reload} />;
}

function BatchView({ d, opts, query, reload }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const printLabels = usePrintLabels();
  const q = new URLSearchParams(query);
  const b = d.batch;
  const nextStep = d.steps.find((s) => s.step_name === b.next_step);
  const reviewStep = d.steps.find((s) => s.step_type === 'QC Review');
  const tabKey = q.get('step') || (nextStep ? nextStep.step_key : reviewStep && b.status !== 'Cancelled' ? reviewStep.step_key : 'results');
  const cur = tabKey === 'results' ? null : d.steps.find((s) => s.step_key === tabKey);
  const editable = d.can_perform && !b.is_verification && !['Approved', 'Cancelled'].includes(b.status);
  const ctx = useMemo(() => ({ d, opts, b, editable, reload, dialogs, toast }), [d, opts, b, editable, reload, dialogs, toast]);

  async function cancel() {
    const done = await dialogs.sign({ what: `Cancel ${b.batch_code}`, meaning: 'Cancelled by', needReason: true,
      submit: ({ reason, signature }) => api.cancelBatch(b.id, reason, signature) });
    if (done) { toast('Batch cancelled: its samples are back in the backlog.'); reload(); }
  }
  async function assign() {
    const r = await dialogs.form({ title: `Assign ${b.batch_code}`, okText: 'Assign', fields: [{ name: 'user_id', label: 'Who does the batch', type: 'select', required: true, value: b.assigned_to,
      options: opts.people.map((p) => ({ value: p.id, label: p.full_name })) }] });
    if (!r) return;
    try { await api.assignBatch(b.id, r.user_id); toast('Batch assigned.'); reload(); } catch (e) { toast(e.message, 'err'); }
  }

  const open = !['Approved', 'Cancelled'].includes(b.status);
  return <>
    <PageHeader title={`${b.batch_code}: ${b.test_name}`} audit={{ kind: 'batch', id: b.id }}
      subtitle={<><a href={'#/methods/versions/' + b.test_version_id}>{`${b.test_code} version ${b.version_no}`}</a> <Badge status={b.status} /> · {b.site_code}{b.department_code ? ' · ' + b.department_code : ''}
        {' '}· {b.sample_count} sample{Number(b.sample_count) === 1 ? '' : 's'}, {b.qc_count} QC · assigned to <b>{b.assigned_name}</b>{b.earliest_due ? ` · earliest due ${day(b.earliest_due)}` : ''}</>}
      actions={<><Button variant="light" href="#/testing/batches">All batches</Button>{' '}
        <Button type="button" variant="outline-secondary" id="labelsb" title="Barcode labels: one per entry (Dymo, 1 x 2 1/8 in.)" onClick={() => printLabels('batch', [b.id])}>Print labels</Button>
        {d.can_assign && editable && <> <Button type="button" variant="outline-secondary" id="assign" onClick={assign}>Assign</Button></>}
        {(d.can_assign || d.can_review) && !b.is_verification && open && <> <Button type="button" variant="outline-secondary" id="cancelb" onClick={cancel}>Cancel batch</Button></>}</>} />
    <Nav variant="pills" className="tbtabs">
      {d.steps.map((s) => <Nav.Link active={s.step_key === tabKey} key={s.id} href={`#/testing/batches/${b.id}?step=${s.step_key}`} className={s.status === 'Completed' ? 'done' : undefined} title={`${s.step_type}: ${s.status}`}>
        <span className="st">{icon(s)}</span>{s.step_name}</Nav.Link>)}
      <Nav.Link active={tabKey === 'results'} href={`#/testing/batches/${b.id}?step=results`}>Results and QC</Nav.Link>
    </Nav>
    {b.is_verification && <div className="tbnote"><b>Workflow verification batch</b> of <a href={'#/verification/' + b.verification_id}>{b.verification_code || 'a verification'}</a>: worked by the automated verification accounts during its run. It is not lab work, is kept out of the lab's lists and takes no changes.</div>}
    {b.status === 'Cancelled' && <div className="tbtodo"><b>Cancelled</b> by {b.cancelled_by_name || ''} {dt(b.cancelled_at)}: {b.cancelled_reason || ''}. Its samples went back to the backlog.</div>}
    {b.status === 'In Progress' && b.returned_reason && <div className="tbtodo"><b>Returned by the reviewer</b> ({b.returned_by_name || ''}, {dt(b.returned_at)}): {b.returned_reason}</div>}
    {b.status === 'Approved' && <div className="tbnote"><b>Approved</b> by {b.reviewed_by_name || ''} {dt(b.reviewed_at)}. The results are stored and locked.</div>}
    <div id="panel">
      {cur ? <StepPanel key={cur.id} ctx={ctx} s={cur} run={q.get('run')} /> : <ResultsPanel ctx={ctx} />}
    </div>
  </>;
}
