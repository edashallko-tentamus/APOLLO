// One OOS investigation (#/oos/:id). Full Phase I (GMP samples): analyst section, supervisor section, QA conclusion.
// Check and Acknowledge: one reviewer answers the checklist and concludes. The conclusion makes the investigation
// report (PDF). Retests, the client's answers (from the link in the OOS email) and QA's retest determination follow.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelOos, concludeOos, getOos, oosReportUrl, orderRetest, recordDetermination, rerunChecks, responseHandled, signSection,
} from '../../api/oos.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { d8, dt, Failed, Loading, PHASE1 } from './shared.jsx';
import { Button, Card, Form } from 'react-bootstrap';

const CHECK_COLS = [
  { field: 'item_text', title: 'Item', type: 'readonly', width: 560 },
  { field: 'answer', title: 'Answer', type: 'select', options: ['Yes', 'No', 'N/A'], width: 80, cellClass: (r) => (r.answer === 'No' ? 'tbwait' : '') },
  { field: 'comment', title: 'Comment (required for No)', width: 260 },
];
const RETEST_COLS = [
  { field: 'source', title: 'Retest', type: 'readonly', width: 180 },
  { field: 'retest_replicates', title: 'Replicates', type: 'readonly', width: 85 },
  { field: 'status', title: 'Status', type: 'readonly', width: 110 },
  { field: 'due_date', title: 'Due', type: 'readonly', width: 100, format: d8 },
  { field: 'billing_status', title: 'Billing', type: 'readonly', width: 170 },
  { field: 'result', title: 'Result', type: 'readonly', width: 220 },
];
const CONCLUSIONS = [{ value: '', label: '' }, { value: 'OOS confirmed', label: 'OOS confirmed' }, { value: 'Assignable cause found', label: 'Assignable cause found' }];
const collect = (rows) => Object.fromEntries(rows.map((r) => [r.id, { answer: r.answer || '', comment: r.comment || '' }]));
function missing(rows) {
  const r = rows.find((x) => !['Yes', 'No', 'N/A'].includes(x.answer)); if (r) return `Answer every item (Yes, No or N/A): "${r.item_text}"`;
  const n = rows.find((x) => x.answer === 'No' && !String(x.comment || '').trim()); return n ? `Explain the "No" for: "${n.item_text}"` : '';
}

// A checklist: read only once signed, otherwise answered in the grid (Yes / No / N/A, Comment; fill down and paste work)
function Checklist({ items, answers, editable, gridRef }) {
  const rows = useMemo(() => items.map((i) => ({ id: i.id, item_text: i.item_text, answer: answers?.[i.id]?.answer || '', comment: answers?.[i.id]?.comment || '' })), [items, answers]);
  const grid = useGrid({ rows, columns: CHECK_COLS, readOnly: !editable });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  gridRef.current = grid;
  return <DataGrid grid={grid} emptyText={'No checklist items (QA sets them on "Checklists and target times").'} />;
}

export default function OosPage({ params: [id] }) {
  const { data: d, error, reload } = useApi(() => getOos(id), [id]);
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;

  const o = d.oos; const can = d.can; const me = d.me;
  const open = !['Closed', 'Cancelled'].includes(o.status);
  const p1 = o.procedure === PHASE1;
  const sec = (name) => d.items.filter((i) => i.section === name);
  const late = open && o.overdue;
  const mayCancel = open && (can.approve || (o.opened_by === me && can.open));
  const ctx = { o, d, can, me, open, p1, dialogs, toast, reload };

  async function rerun() {
    setBusy(true);
    try { await rerunChecks(o.id); toast('Checks run again.'); reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  }
  async function cancel() {
    const v = await dialogs.form({ title: `Cancel ${o.oos_code}`, okText: 'Next: sign', intro: 'Cancel an investigation opened in error, for example when the sample details or the specification were wrong and are now corrected. It is kept, marked Cancelled.',
      fields: [{ name: 'reason', label: 'Why it is cancelled', type: 'textarea', required: true }] });
    if (!v) return;
    const done = await dialogs.sign({ what: `Cancel ${o.oos_code}`, meaning: 'Cancelled by', needReason: false, submit: ({ signature }) => cancelOos(o.id, { reason: v.reason, signature }) });
    if (done) { toast(`${o.oos_code} cancelled.`); reload(); }
  }

  return <>
    <PageHeader title={`${o.oos_code}: ${o.analyte_name} in ${o.sample_code}`} audit={{ kind: 'oos', id: o.id }}
      subtitle={<>{o.procedure} · <Badge status={o.status} />{o.conclusion && <> · <b>{o.conclusion}</b></>}</>}
      actions={<>
        {o.report_document_id && <Button variant="outline-secondary" target="_blank" rel="noopener noreferrer" id="rep" href={oosReportUrl(o.id, site?.id)}>Investigation report (PDF)</Button>}{' '}
        {mayCancel && <Button type="button" variant="light" onClick={cancel}>Cancel investigation…</Button>}{' '}
        <Button variant="light" href="#/oos">All investigations</Button></>} />
    <div className="oosg">
      <div>
        <Card body><h2 style={{ fontSize: 15, margin: '0 0 8px' }}>The result</h2><dl>
          <dt>Sample</dt><dd><a href={'#/samples/' + o.sample_id}>{o.sample_code}</a>{o.client_sample_id ? ` (${o.client_sample_id})` : ''}</dd>
          <dt>Client</dt><dd>{o.client_name}</dd>
          <dt>Test</dt><dd>{o.test_name}</dd>
          <dt>Analyte</dt><dd>{o.analyte_name}</dd>
          <dt>Result</dt><dd><b>{[o.reported, o.unit].filter(Boolean).join(' ')}</b></dd>
          <dt>Specification</dt><dd>{o.spec_text || ''}</dd>
          <dt>Batch</dt><dd>{o.batch_id && <a href={'#/testing/batches/' + o.batch_id + '?step=results'}>{o.batch_code}</a>}</dd>
          <dt>GMP</dt><dd>{o.is_gmp ? 'Yes (Full Phase I, QA concludes)' : 'No'}</dd>
          <dt>Opened</dt><dd>{o.opened_by_name}, {dt(o.opened_at)}</dd>
          {o.opened_reason && <><dt>Why</dt><dd>{o.opened_reason}</dd></>}
          <dt>Target date</dt><dd className={`oosdue ${late ? 'late' : ''}`}>{d8(o.due_date)}{late ? ' (overdue)' : ''}</dd>
          {o.client_notified_at && <><dt>Client told</dt><dd>{dt(o.client_notified_at)} (OOS email with the COA)</dd></>}
          {o.status === 'Cancelled' && <><dt>Cancelled</dt><dd>{o.cancelled_name || ''}, {dt(o.cancelled_at)}: {o.cancelled_reason || ''}</dd></>}
        </dl></Card>
        <Card body><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ fontSize: 15, margin: 0 }}>Automatic data checks</h2>
          {open && (can.open || can.review) && <Button type="button" variant="light" size="sm" className="mini" disabled={busy} onClick={rerun}>Run again</Button>}</div>
          <div className="help" style={{ margin: '4px 0 8px' }}>{o.auto_checked_at ? 'Run ' + dt(o.auto_checked_at) + '. ' : ''}Worked out from the records; a Fail needs explaining in the investigation.</div>
          <div id="checks">{(o.auto_checks || []).length ? o.auto_checks.map((c, k) => <div key={k} className={`oosck ${c.level}`}><span className="lv">{c.level}</span><b>{c.title}</b>{c.detail}</div>)
            : <div className="help">Not run yet.</div>}</div></Card>
      </div>
      <div id="secs">
        {p1 ? <>
          <SignedSection ctx={ctx} name="Analyst" title="1. Analyst investigation" by={o.analyst_by} byName={o.analyst_name} at={o.analyst_at} answers={o.analyst_answers}
            comment={o.analyst_comment} items={sec('Analyst')} editable={o.status === 'Open' && can.perform} meaning="Investigated by" path="analyst" hypothesis={o.hypothesis} />
          <SignedSection ctx={ctx} name="Supervisor" title="2. Supervisor review" by={o.supervisor_by} byName={o.supervisor_name} at={o.supervisor_at} answers={o.supervisor_answers}
            comment={o.supervisor_comment} items={sec('Supervisor')} editable={o.status === 'Analyst signed' && can.review && o.analyst_by !== me} meaning="Reviewed by" path="supervisor"
            waiting={o.status === 'Open' ? 'Follows the analyst\'s section.' : o.status === 'Analyst signed' && o.analyst_by === me ? 'You signed the analyst section: a supervisor signs this one.' : ''} />
          <Conclusion ctx={ctx} title="3. QA conclusion" editable={o.status === 'Supervisor signed' && can.approve && ![o.analyst_by, o.supervisor_by].includes(me)}
            waiting={o.status === 'Supervisor signed' && [o.analyst_by, o.supervisor_by].includes(me) ? 'You signed a section: QA concludes it independently.' : ['Open', 'Analyst signed'].includes(o.status) ? 'Follows the supervisor\'s section.' : ''} />
        </> : <Conclusion ctx={ctx} title="Check and Acknowledge" editable={o.status === 'Open' && (can.review || can.approve)} reviewerItems={sec('Reviewer')} waiting="" />}
        <Retests ctx={ctx} />
      </div>
    </div>
  </>;
}

function SignedSection({ ctx, name, title, by, byName, at, answers, comment, items, editable, meaning, path, hypothesis, waiting }) {
  const { o, dialogs, toast, reload } = ctx;
  const gridRef = useRef(null);
  const [hyp, setHyp] = useState('');
  const [cm, setCm] = useState('');
  async function signIt() {
    const rows = gridRef.current.state.rows;
    const m = missing(rows); if (m) { toast(m, 'err'); return; }
    const body = { answers: collect(rows), comment: cm, hypothesis: name === 'Analyst' ? hyp : null };
    const done = await dialogs.sign({ what: `${o.oos_code}: ${title}`, meaning, needReason: false, submit: ({ signature }) => signSection(o.id, path, { ...body, signature }) });
    if (done) { toast('Section signed.'); reload(); }
  }
  return <Card body className="oossec"><h2>{title}</h2>
    {by && <div className="signed">Signed ({meaning}) by {byName || ''}, {dt(at)}</div>}
    {!by && !editable && waiting && <div className="help">{waiting}</div>}
    {(by || editable) && <>
      <Checklist items={items} answers={answers} editable={editable} gridRef={gridRef} />
      {name === 'Analyst' && <><div className="fl">Hypothesis (what might explain the result; optional)</div>
        {editable ? <Form.Control as="textarea" rows={2} value={hyp} onChange={(e) => setHyp(e.target.value)} /> : <div>{hypothesis || ''}</div>}</>}
      <div className="fl">Comment</div>{editable ? <Form.Control as="textarea" rows={3} value={cm} onChange={(e) => setCm(e.target.value)} /> : <div>{comment || ''}</div>}
      {editable && <div className="oosacts"><Button type="button" variant="primary" onClick={signIt}>Sign the {name.toLowerCase()} section</Button></div>}
    </>}
  </Card>;
}

function Conclusion({ ctx, title, editable, reviewerItems, waiting }) {
  const { o, open, p1, dialogs, toast, reload } = ctx;
  const done = o.status === 'Closed';
  const gridRef = useRef(null);
  const [conclusion, setConclusion] = useState('');
  const [cause, setCause] = useState('');
  const [comment, setComment] = useState('');
  async function conclude() {
    const rows = reviewerItems ? gridRef.current.state.rows : null;
    const body = { conclusion, cause, comment, answers: rows ? collect(rows) : {} };
    if (rows) { const m = missing(rows); if (m) { toast(m, 'err'); return; } }
    if (!body.conclusion) { toast('Choose the conclusion.', 'err'); return; }
    if (body.conclusion === 'Assignable cause found' && !body.cause.trim()) { toast('Describe the assignable cause.', 'err'); return; }
    if (!body.comment.trim()) { toast('Write the justification.', 'err'); return; }
    const ok = await dialogs.sign({ what: `${o.oos_code}: conclusion "${body.conclusion}"`, meaning: 'Approved by', needReason: false, okText: 'Sign and conclude',
      submit: ({ signature }) => concludeOos(o.id, { ...body, signature }) });
    if (ok) { toast(`${o.oos_code} concluded: report made.`); reload(); }
  }
  return <Card body className="oossec"><h2>{title}</h2>
    {done && <div className="signed">Concluded (Approved by) by {o.concluded_name || ''}, {dt(o.concluded_at)}</div>}
    {!done && !editable && <div className="help">{waiting || (open ? (p1 ? 'QA (oos.approve) concludes.' : 'Someone with QC Review rights (testing.review) or QA concludes.') : '')}</div>}
    {reviewerItems && (done || editable) && <Checklist items={reviewerItems} answers={o.reviewer_answers} editable={editable} gridRef={gridRef} />}
    {done && <dl style={{ marginTop: 8 }}><dt>Conclusion</dt><dd><b>{o.conclusion}</b></dd>{o.assignable_cause && <><dt>Assignable cause</dt><dd>{o.assignable_cause}</dd></>}<dt>Justification</dt><dd>{o.conclusion_comment || ''}</dd></dl>}
    {editable && <>
      <div className="help" style={{ margin: '6px 0' }}>The batch must be approved in QC Review first: the conclusion is about the approved result. Concluding makes the investigation report (PDF), stored with its fingerprint.</div>
      <div className="fl">Conclusion</div><SmartSelect id="cc_c" value={conclusion} options={CONCLUSIONS} onChange={setConclusion} />
      <div className="fl">Assignable cause (the documented laboratory error; required for &quot;Assignable cause found&quot;)</div><Form.Control as="textarea" rows={2} value={cause} onChange={(e) => setCause(e.target.value)} />
      <div className="fl">Justification</div><Form.Control as="textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="oosacts"><Button type="button" variant="primary" onClick={conclude}>Conclude and sign…</Button></div>
    </>}
  </Card>;
}

// retests, the client's answers and the retest determination
function Retests({ ctx }) {
  const { o, d, can, dialogs, toast, reload } = ctx;
  const closed = o.status === 'Closed';
  const hasRetest = d.retests.some((r) => r.status !== 'Cancelled');
  const clientRetest = d.retests.find((r) => r.source === 'Client OOS Retest' && r.status !== 'Cancelled');
  const canLab = closed && o.conclusion === 'Assignable cause found' && !hasRetest && can.order;
  const canClient = closed && o.conclusion === 'OOS confirmed' && o.client_notified_at && !hasRetest && can.order;
  const canDet = clientRetest && clientRetest.result && !o.retest_determination && can.approve;

  async function order(kind, response) {
    const dflt = response ? (response.choice === 'Retest in duplicate' ? '2' : '1') : '1';
    const v = await dialogs.form({ title: `${kind === 'Client' ? 'Client' : 'Lab investigation'} retest of ${o.sample_code}`, okText: 'Next: sign',
      intro: kind === 'Client' ? 'A re-prep from the retained sample, billed by QA\'s determination once its result is approved (Confirmed OOS or Inconclusive: billable; Lab error: not billable). The original result stays on the issued COA; the retest makes a new COA version.'
        : 'A re-prep from the retained sample, not billed. The invalidated results are kept (Superseded) and never released; the retest\'s results take their place on the COA.',
      fields: [{ name: 'replicates', label: 'Replicates', type: 'select', blank: false, value: dflt, options: [{ value: '1', label: 'Single' }, { value: '2', label: 'Duplicate' }, { value: '3', label: 'Triplicate' }] }] });
    if (!v) return;
    const done = await dialogs.sign({ what: `${o.oos_code}: order the ${kind === 'Client' ? 'client' : 'lab investigation'} retest`, meaning: 'Ordered by', needReason: false,
      submit: ({ signature }) => orderRetest(o.id, { kind, replicates: v.replicates, response_id: response?.id || null, signature }) });
    if (done) { toast('Retest ordered: it is in the backlog.'); reload(); }
  }
  async function determination() {
    const v = await dialogs.form({ title: `${o.oos_code}: retest determination`, okText: 'Next: sign', intro: 'QA\'s determination of the cause once the client retest is approved. It sets the retest\'s billing: Confirmed OOS or Inconclusive are billable, Lab error is not (rush fees included).',
      fields: [{ name: 'determination', label: 'Determination', type: 'select', required: true, options: ['Confirmed OOS', 'Lab error', 'Inconclusive'] },
        { name: 'reason', label: 'Evidence', type: 'textarea', required: true }] });
    if (!v) return;
    const done = await dialogs.sign({ what: `${o.oos_code}: retest determination "${v.determination}"`, meaning: 'Approved by', needReason: false,
      submit: ({ signature }) => recordDetermination(o.id, { ...v, signature }) });
    if (done) { toast('Determination recorded.'); reload(); }
  }
  const respCols = useMemo(() => {
    const wantsRetest = (r) => canClient && /^Retest|new sample/i.test(r.choice);
    async function handle(r) {
      const v = await dialogs.form({ title: 'Client answer handled', okText: 'Save', intro: `${r.choice}${r.note ? ': ' + r.note : ''}`, fields: [{ name: 'note', label: 'What was done', type: 'textarea' }] });
      if (!v) return;
      try { await responseHandled(r.id, v.note); toast('Marked handled.'); reload(); } catch (e) { toast(e.message, 'err'); }
    }
    return [
      { field: 'received_at', title: 'Received', type: 'readonly', width: 145, format: dt },
      { field: 'choice', title: 'Answer', type: 'readonly', width: 170 },
      { field: 'contact_name', title: 'From', type: 'readonly', width: 130 },
      { field: 'note', title: 'Note', type: 'readonly', width: 220 },
      { field: 'handled', title: 'Handled', type: 'readonly', width: 220, compute: (r) => (r.handled_at ? `${r.handled_by_name || ''} ${dt(r.handled_at)}${r.handled_note ? ': ' + r.handled_note : ''}` : 'Not yet'), cellClass: (r) => (r.handled_at ? '' : 'tbwait') },
      { field: 'act', title: '', type: 'button', width: 170, label: (r) => (r.handled_at ? '' : wantsRetest(r) ? 'Order the client retest…' : (can.order || can.open) ? 'Mark handled…' : ''),
        onClick: (r) => { if (r.handled_at) return; if (wantsRetest(r)) order('Client', r); else if (can.order || can.open) handle(r); } },
    ];
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps -- everything here follows the investigation's data

  if (!closed && !d.responses.length && !d.retests.length) return null;
  return <Card body className="oossec"><h2>Retests and the client</h2>
    {closed && o.conclusion === 'Assignable cause found' && <div className="help">An assignable cause invalidates the result: order the lab investigation retest (a re-prep from the retained sample, not billed). The invalid result is never released.</div>}
    {closed && o.conclusion === 'OOS confirmed' && <div className="help">The confirmed result is released on the COA; the client is emailed then, with links to answer (retest, retest in duplicate, a new sample, hold or return the retained sample, a call with QA). {!o.client_notified_at && <b>Not released yet.</b>}</div>}
    {d.retests.length > 0 && <><div className="fl">Retests</div><ReadGrid rows={d.retests} columns={RETEST_COLS} /></>}
    {d.responses.length > 0 && <><div className="fl">The client&apos;s answers</div><ReadGrid rows={d.responses} columns={respCols} /></>}
    {o.retest_determination && <div className="signed" style={{ marginTop: 8 }}>Retest determination: <b>{o.retest_determination}</b> by {o.determined_name || ''}, {dt(o.determined_at)}: {o.determination_reason || ''}</div>}
    <div className="oosacts">
      {canLab && <Button type="button" variant="primary" onClick={() => order('Lab investigation')}>Order the lab investigation retest…</Button>}
      {canClient && <Button type="button" variant="primary" onClick={() => order('Client')}>Order the client retest…</Button>}
      {canDet && <Button type="button" variant="primary" onClick={determination}>Record the retest determination…</Button>}
      {clientRetest && !clientRetest.result && !o.retest_determination && <span className="help">QA records the determination (billing) once the retest is approved in QC Review.</span>}
    </div>
  </Card>;
}
