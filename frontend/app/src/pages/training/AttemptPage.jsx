// One competency attempt (#/training/attempts/:id): its evidence or training samples and results, the trainer's
// signed evaluation, QA's signed approval or rejection, withdrawing.
import { useState } from 'react';
import { addEvidence, decideAttempt, evaluateAttempt, evidenceUrl, getAttempt, withdrawAttempt } from '../../api/training.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import Modal from '../../components/Modal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { d8, documentsOf } from './shared.js';
import { Button, Card } from 'react-bootstrap';

const SAMPLE_COLS = [
  { field: 'sample_code', title: 'Training sample', type: 'link', width: 160, href: (r) => '#/samples/' + r.id }, { field: 'status', title: 'Test', type: 'readonly', width: 110 }];
const RESULT_COLS = [
  { field: 'sample_code', title: 'Sample', type: 'readonly', width: 150 }, { field: 'analyte', title: 'Analyte', type: 'readonly', width: 180 },
  { field: 'reported', title: 'Result', type: 'readonly', width: 100, format: (v, r) => (r.final ? `${v} ${r.unit || ''}` : 'Waiting') },
  { field: 'spec', title: 'Known value range', type: 'readonly', width: 150 },
  { field: 'conformance', title: 'Within it', type: 'readonly', width: 120, cellClass: (r) => (r.final && r.conformance && r.conformance !== 'Conforms' ? 'cbad' : '') }];

function FilesDialog({ onDone }) {
  const [files, setFiles] = useState([]);
  return (
    <Modal title="Attach evidence" okText="Attach" onOk={() => onDone(files)} onClose={() => onDone(null)}>
      <div className="field"><label htmlFor="f_files">Files</label><input id="f_files" type="file" multiple onChange={(e) => setFiles([...e.target.files])} /></div>
    </Modal>
  );
}

export default function AttemptPage({ params: [id] }) {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error, reload } = useApi((o) => getAttempt(id, o), [id]);
  if (error && !d) return <><PageHeader title="Competency" /><Card body className="err">{error.message}</Card></>;
  if (!d) return <><PageHeader title="Competency" /><div className="loading">Loading…</div></>;
  const a = d.attempt;
  const open = a.status === 'In progress';
  const evidenceCols = [
    { field: 'title', title: 'Evidence', type: 'link', width: 260, href: () => '#', onClick: (r) => window.open(evidenceUrl(r.id, site?.id), '_blank') },
    { field: 'by_name', title: 'Attached by', type: 'readonly', width: 160 }, { field: 'created_at', title: 'When', type: 'readonly', width: 120, format: d8 }];

  async function attach() {
    const files = await dialogs.open((done) => <FilesDialog onDone={done} />);
    if (!files || !files.length) return;
    try { await addEvidence(id, await documentsOf(files)); reload(); } catch (e) { toast(e.message, 'err'); }
  }
  async function evaluate() {
    const v = await dialogs.form({ title: 'Evaluate the competency', okText: 'Next: sign', intro: `${a.full_name} on ${a.test_name}. A conditional pass says what it is conditional on; a fail says why.`,
      fields: [{ name: 'evaluation', label: 'Evaluation', type: 'select', blank: false, value: 'Pass', options: ['Pass', 'Conditional pass', 'Fail'] }, { name: 'note', label: 'Note', type: 'textarea' }] });
    if (!v) return;
    const r = await dialogs.sign({ title: 'Sign the evaluation', what: `${v.evaluation}: ${a.attempt_code}, ${a.full_name} on ${a.test_name}`, meaning: 'Evaluated by', needReason: false,
      submit: ({ signature }) => evaluateAttempt(id, { ...v, signature }) });
    if (r) { toast('Evaluated and signed: QA approves it next.'); reload(); }
  }
  async function decide(decision) {
    const v = await dialogs.form({ title: decision === 'Approved' ? 'Approve the competency' : 'Reject the evaluation', okText: 'Next: sign',
      intro: decision === 'Approved' ? `${a.evaluation} by ${a.evaluated_by_name}. ${a.kind === 'Initial' && a.evaluation !== 'Fail' ? 'Approving grants the qualification.' : a.evaluation !== 'Fail' ? 'Approving keeps the qualification up.' : 'Approving records the failure.'}` : 'Say why the evaluation is rejected.',
      fields: [{ name: 'note', label: 'Note', type: 'textarea', required: decision === 'Rejected' }] });
    if (!v) return;
    const r = await dialogs.sign({ title: 'Sign QA\'s decision', what: `${decision}: ${a.attempt_code}, ${a.full_name} on ${a.test_name}`, meaning: decision === 'Approved' ? 'Approved by' : 'Rejected by', needReason: false,
      submit: ({ signature }) => decideAttempt(id, { decision, note: v.note, signature }) });
    if (r) { toast(decision === 'Approved' ? 'Approved and signed.' : 'Rejected and signed.'); reload(); }
  }
  async function withdraw() {
    const v = await dialogs.form({ title: 'Withdraw the attempt', fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }], okText: 'Withdraw',
      submit: (x) => withdrawAttempt(id, x.reason) });
    if (v) reload();
  }

  const actions = <>
    {open && d.can.evaluate && <Button type="button" variant="primary" id="eval" onClick={evaluate}>Evaluate…</Button>}
    {a.status === 'Evaluated' && d.can.approve && d.me !== a.user_id && d.me !== a.evaluated_by && <> <Button type="button" variant="primary" id="ok" onClick={() => decide('Approved')}>Approve…</Button> <Button type="button" variant="outline-secondary" id="rej" onClick={() => decide('Rejected')}>Reject…</Button></>}
    {['In progress', 'Evaluated'].includes(a.status) && (d.can.evaluate || d.can.approve) && <> <Button type="button" variant="light" id="wd" onClick={withdraw}>Withdraw…</Button></>}
  </>;
  return <>
    <PageHeader title={`Competency ${a.attempt_code}`} subtitle={<><a href={'#/training/people/' + a.user_id}>{a.full_name}</a>: {a.kind} competency on {a.test_name} <Badge status={a.status} /></>}
      actions={actions} audit={{ kind: 'competency', id }} />
    <Card body className="meta3 wide">
      <div><span>How</span><b>{a.route}</b></div><div><span>Started by</span><b>{a.started_by_name}, {d8(a.created_at)}</b></div>
      <div><span>Evaluation</span><b>{a.evaluation || 'Not yet'}{a.evaluated_by_name ? ` (${a.evaluated_by_name})` : ''}</b></div>
      <div><span>QA</span><b>{a.decided_by_name ? `${a.status} by ${a.decided_by_name}` : 'Not yet'}</b></div>
      {a.evaluation_note && <div><span>Evaluator&apos;s note</span><b>{a.evaluation_note}</b></div>}
      {a.decision_note && <div><span>QA&apos;s note</span><b>{a.decision_note}</b></div>}
      {a.withdrawn_reason && <div><span>Withdrawn</span><b>{a.withdrawn_reason}</b></div>}
    </Card>
    {a.route === 'Record'
      ? <Section title="The training" help={`${a.description || ''} (${d8(a.trained_on)})`} actions={open && <Button type="button" variant="outline-secondary" id="addev" onClick={attach}>Attach evidence…</Button>}>
        <ReadGrid rows={d.evidence} columns={evidenceCols} emptyText="No evidence attached yet." /></Section>
      : <Section title="Training samples" help={`Run them like any sample (Testing > Backlog, ${a.sample_tests_done} of ${a.sample_tests} with final results). Each result is compared with the known value (its specification) in QC Review. The trainer evaluates once all have final results.`}>
        <ReadGrid rows={d.samples} columns={SAMPLE_COLS} />
        <div style={{ marginTop: 10 }}><ReadGrid rows={d.results} columns={RESULT_COLS} emptyText="No results yet." /></div>
      </Section>}
  </>;
}
