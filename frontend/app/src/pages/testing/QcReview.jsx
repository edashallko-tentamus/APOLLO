// QC Review (WD-3; nested layout and step approvals, Alex 2026-10-13). Results are nested under each sample and show only
// hits above the LOQ plus anything to act on; QC is nested under each QC entry and shows only the checks that failed or
// are waiting. "All analytes" shows everything. A timepoint review (WD-5) has its own panel and releases preliminary results.
import { useMemo, useState } from 'react';
import * as api from '../../api/testing.js';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { useApi } from '../../hooks/useApi.js';
import { AliquotsCard, EquipmentFlagsCard } from '../logbooks/LogbookCards.jsx';
import { openOos } from '../oos/shared.jsx';
import { ReviewTrends } from '../trending/TrendPanel.jsx';
import { chooseReading, markStep } from './actions.jsx';
import { choiceText, dt, isPast, nfmt, reprepNote, storedBasis, verdictClass } from './shared.jsx';
import { Button, Card } from 'react-bootstrap';

const reviewView = { results: 'hits', qc: 'exceptions' };   // kept while the page is reloaded
const reviewOpen = new Map();                               // batch id -> Map of group keys the reviewer opened or closed
const stop = (e) => e.stopPropagation();
const pending = (m) => (m.mark_id ? '' : 'tbrerun');

export default function ReviewPanel({ ctx, s }) {
  const { b, d } = ctx;
  // reloaded with the batch (d changes on every reload)
  const { data, error } = useApi((o) => Promise.all([api.getReview(b.id, o), api.oosForBatch(b.id, o).catch(() => ({ rows: [], can_open: false }))]), [b.id, d]);
  if (error && !data) return <Card body className="err">{error.message}</Card>;
  if (!data) return <div className="loading">Loading…</div>;
  const [r, oosFor] = data;
  const tp = s && (r.timepoints || []).find((x) => x.step_run_id === s.id);
  if (tp) return <TimepointPanel ctx={ctx} r={r} tp={tp} />;
  return <FinalReview ctx={ctx} r={r} oosFor={oosFor} />;
}

// the steps list: each approved by the reviewer with a click (a recorded mark); one signature approves the batch
function StepMarks({ ctx, marks, can, withType, onlyCompleted }) {
  const { b, d } = ctx;
  const rows = useMemo(() => marks.map((m, i) => ({ ...m, key: i, n: i + 1, step_key: d.steps.find((x) => x.id === m.step_run_id)?.step_key })), [marks, d]);
  const columns = useMemo(() => [
    ...(withType ? [{ field: 'n', title: '#', type: 'readonly', width: 40 }] : []),
    { field: 'step_name', title: 'Step', type: 'link', width: 220, href: (m) => `#/testing/batches/${b.id}?step=${m.step_key}`, help: 'Opens the step as the analyst recorded it (read only)' },
    withType ? { field: 'step_type', title: 'Type', type: 'readonly', width: 150 } : { field: 'status', title: 'Status', type: 'readonly', width: 110 },
    { field: 'mk', title: 'Review', type: 'readonly', width: 280, compute: (m) => (m.mark_id ? `Approved by ${m.marked_by_name} ${dt(m.marked_at)}` : 'Not approved yet'), cellClass: (m) => (m.mark_id ? 'tbpass' : 'tbwait') },
    { field: 'act', title: '', type: 'button', width: 120, label: (m) => (!can || (onlyCompleted && m.status !== 'Completed') ? '' : m.mark_id ? 'Undo' : 'Approve step'),
      onClick: (m) => can && !(onlyCompleted && m.status !== 'Completed') && markStep(ctx, m.step_run_id, !!m.mark_id) },
  ], [b, can, ctx, withType, onlyCompleted]);
  return <ReadGrid rows={rows} columns={columns} keyField="key" rowClass={pending} emptyText="No steps." />;
}

// Incubator loads outside their window or temperature: the analyst's note, and the reviewer's acceptance (WD-5.1)
function LoadsGrid({ ctx, loads, can }) {
  const rows = useMemo(() => loads.map((l, i) => ({ ...l, key: i })), [loads]);
  const columns = useMemo(() => {
    const ok = (l) => l.accepted_justification && l.accepted_check === l.check_text;
    return [
      { field: 'equipment_code', title: 'Incubator', type: 'link', width: 95, href: (l) => '#/equipment/' + l.equipment_id },
      { field: 'step_name', title: 'Step', type: 'readonly', width: 170 },
      { field: 'check_text', title: 'Outside the target', type: 'readonly', width: 260, cellClass: () => 'tbfail' },
      { field: 'note', title: 'Analyst\'s note', type: 'readonly', width: 240 },
      { field: 'acc', title: 'Accepted', type: 'readonly', width: 280, compute: (l) => (ok(l) ? `${l.accepted_by}: ${l.accepted_justification}` : 'Not accepted yet'), cellClass: (l) => (ok(l) ? 'tbpass' : 'tbwait') },
      { field: 'act', title: '', type: 'button', width: 90, label: (l) => (can && !ok(l) ? 'Accept…' : ''),
        onClick: async (l) => {
          if (!can || ok(l)) return;
          const m = await ctx.dialogs.form({ title: `Accept the load in ${l.equipment_code}`, okText: 'Accept', intro: `${l.check_text}. Analyst's note: ${l.note || '(none)'}. Write why the results can still be reported (it is kept with your name).`,
            fields: [{ name: 'justification', label: 'Justification', type: 'textarea', required: true }],
            submit: (v) => api.acceptLoad(ctx.b.id, l.id, v.justification) });
          if (m) { ctx.toast('Load accepted with your justification.'); ctx.reload(); }
        } },
    ];
  }, [ctx, can]);
  return <ReadGrid rows={rows} columns={columns} keyField="key" rowClass={(l) => (l.accepted_justification && l.accepted_check === l.check_text ? '' : 'tbrerun')} />;
}

function Switch({ name, options, onChange }) {
  return <div className="rvswitch" data-sw={name}>{options.map(([v, l]) => <button key={v} type="button" data-v={v} className={reviewView[name] === v ? 'on' : ''} onClick={() => onChange(name, v)}>{l}</button>)}</div>;
}
function Todo({ title, items }) {
  return <div className="tbtodo"><b>{title}</b><ul>{items.slice(0, 10).map((p, i) => <li key={i}>{p}</li>)}{items.length > 10 && <li>and {items.length - 10} more</li>}</ul></div>;
}

function FinalReview({ ctx, r, oosFor }) {
  const { b, d, dialogs, toast, reload } = ctx;
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [view, setView] = useState({ ...reviewView });
  const switchTo = (k, v) => { reviewView[k] = v; setView({ ...reviewView }); };
  const can = r.can_review && !r.performer && b.status === 'Awaiting Review';
  const marks = d.review_marks || [];
  const unmarked = marks.filter((m) => !m.mark_id).length;
  const approved = b.status === 'Approved';
  if (!reviewOpen.has(b.id)) reviewOpen.set(b.id, new Map());
  const opened = reviewOpen.get(b.id);
  const isOpen = (key, dflt) => (opened.has(key) ? opened.get(key) : dflt);
  const toggleCol = (key) => ({ field: '_t', title: '', type: 'button', width: 44, label: (x) => (isOpen(key(x), x._dflt) ? '▾' : '▸'),
    onClick: (x) => { opened.set(key(x), !isOpen(key(x), x._dflt)); rerender(); } });

  // ---- results: one row per sample, its analytes nested under it
  const samples = useMemo(() => {
    const items = approved
      ? r.stored.map((x) => ({ ...x, group: x.requested_test_id, sample_label: x.sample_code || x.client_sample_id, chosen: true }))
      : r.items.map((x) => ({ ...x, group: x.requested_test_id, key: `${x.requested_test_id}|${x.analyte_id}`, n: x.candidates.length,
        chosen: !!x.chosen_entry_id, sample_id: d.entries.find((e) => e.requested_test_id === x.requested_test_id)?.sample_id }));
    const shown = (x) => view.results === 'all' || x.hit || !x.chosen || x.conformance === 'Does not conform';
    const out = [];
    items.forEach((x, i) => {
      let sm = out.find((y) => y.group === x.group);
      if (!sm) { sm = { group: x.group, key: x.group, sample_label: x.sample_label, sample_id: x.sample_id, matrix: d.entries.find((e) => e.requested_test_id === x.group)?.matrix || '', rows: [] }; out.push(sm); }
      sm.rows.push({ ...x, key: x.key || i });
    });
    out.forEach((sm) => {
      sm.hits = sm.rows.filter((x) => x.hit).length; sm.todo = sm.rows.filter((x) => !x.chosen).length; sm.out = sm.rows.filter((x) => x.conformance === 'Does not conform').length;
      sm.vis = sm.rows.filter(shown); sm._dflt = sm.vis.length > 0;
      sm.summary = `${sm.rows.length} analyte${sm.rows.length === 1 ? '' : 's'} · ${sm.hits ? `${sm.hits} above the LOQ` : 'nothing above the LOQ'}${sm.todo ? ` · ${sm.todo} to choose` : ''}${sm.out ? ` · ${sm.out} out of specification` : ''}`;
    });
    return out;
  }, [r, d, approved, view.results]);

  const specText = (x) => (x.spec_text || [x.spec_min !== null && x.spec_min !== undefined ? '≥ ' + nfmt(x.spec_min) : '', x.spec_max !== null && x.spec_max !== undefined ? '≤ ' + nfmt(x.spec_max) : ''].filter(Boolean).join(' and ')) + (x.spec_unit && !x.spec_text ? ' ' + x.spec_unit : '');
  const oosOf = (x) => oosFor.rows.find((o) => o.requested_test_id === x.requested_test_id && o.analyte_id === x.analyte_id);
  const canOpenOos = (x) => x.conformance === 'Does not conform' && x.chosen && !x.result_key && oosFor.can_open && b.status !== 'Cancelled';
  const nestedCols = [
    { field: 'sample_label', title: 'Sample', type: 'link', width: 140, href: (x) => (x.sample_id ? '#/samples/' + x.sample_id : null), help: 'Repeated on every row so a long analyte list keeps its place' },
    { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 150 },
    // the result and its unit right beside the analyte, so the reviewer reads across without moving their eyes (Alex)
    { field: 'reported', title: 'Result', type: 'readonly', width: 90, align: 'right', compute: (x) => (x.chosen ? x.reported ?? x.value_text ?? '' : '') },
    { field: 'unit', title: 'Unit', type: 'readonly', width: 65 },
    ...(approved ? [{ field: 'basis', title: 'Reported as', type: 'readonly', width: 230, compute: storedBasis }]
      : [{ field: 'n', title: 'Readings', type: 'readonly', width: 75 },
        { field: 'choice', title: 'Reportable reading', type: 'readonly', width: 290, compute: choiceText, help: 'Chosen automatically when there is only one; otherwise tick one (with a justification) or several to report their average' },
        { field: 'pick', title: '', type: 'button', width: 90, label: (x) => (can && x.n > 1 ? 'Choose…' : ''), onClick: (x) => can && x.n > 1 && chooseReading(ctx, x) }]),
    { field: 'spec', title: 'Specification', type: 'readonly', width: 140, compute: specText },
    { field: 'conformance', title: 'Conformance', type: 'readonly', width: 135, cellClass: (x) => (x.conformance === 'Does not conform' ? 'tbfail' : x.conformance === 'Conforms' ? 'tbpass' : '') },
    { field: 'oos', title: 'OOS', type: 'button', width: 130, label: (x) => { const o = oosOf(x); return o ? o.oos_code + (o.status === 'Closed' ? ' (closed)' : '') : canOpenOos(x) ? 'Open OOS…' : ''; },
      help: 'An out-of-specification result is flagged, not investigated by itself: correct the sample details or specification if they were wrong, otherwise open the investigation',
      onClick: async (x) => {
        const o = oosOf(x); if (o) { window.location.hash = '#/oos/' + o.id; return; }
        if (!canOpenOos(x)) return;
        try { await openOos(dialogs, toast, { requested_test_id: x.requested_test_id, analyte_id: x.analyte_id, batch_id: b.id, label: `${x.analyte_name} ${x.reported ?? x.value_text ?? ''}${x.unit ? ' ' + x.unit : ''} in ${x.sample_label} (${b.batch_code})` }); } catch (e) { toast(e.message, 'err'); }
      } },
    ...(approved ? [{ field: 'approved_by_name', title: 'Approved by', type: 'readonly', width: 150 }] : []),
  ];
  const sampleCols = [
    toggleCol((sm) => 's:' + sm.group),
    { field: 'sample_label', title: 'Sample', type: 'link', width: 150, href: (sm) => (sm.sample_id ? '#/samples/' + sm.sample_id : null) },
    { field: 'matrix', title: 'Matrix', type: 'readonly', width: 120 },
    { field: 'summary', title: 'Analytes', type: 'readonly', width: 420 },
    { field: 'conf', title: 'Conformance', type: 'readonly', width: 150, compute: (sm) => (sm.out ? 'Does not conform' : sm.rows.some((x) => x.conformance === 'Conforms') ? 'Conforms' : ''), cellClass: (sm) => (sm.out ? 'tbfail' : '') },
  ];
  const sampleDetail = { open: (sm) => isOpen('s:' + sm.group, sm._dflt), key: (sm) => 's:' + sm.group + ':' + view.results,
    render: (sm) => (!sm.vis.length
      ? <div className="rvnone">Nothing above the LOQ and nothing to check ({sm.rows.length} analyte{sm.rows.length === 1 ? '' : 's'}). "All analytes" shows them.</div>
      : <div onMouseDown={stop} onKeyDown={stop} onContextMenu={stop} onDoubleClick={stop}><ReadGrid rows={sm.vis} columns={nestedCols} keyField="key" rowClass={(x) => (!x.chosen ? 'tbrerun' : '')} /></div>) };

  // ---- QC: one row per QC entry and run, its checks per analyte nested under it
  const groups = useMemo(() => {
    const acc = (v) => r.accepted.find((q) => q.entry_id === v.entry_id && (q.analyte_id || null) === (v.analyte_id || null) && q.limit_type === v.limit_type && Number(q.analytical_run || 1) === Number(v.analytical_run || 1));
    // a run's analytical QC counts only when the run holds a reported reading; a prep QC's first run always counts (WD-5)
    const used = (r.used_runs || [1]).map(Number);
    const counts = (v) => used.includes(Number(v.analytical_run || 1)) || (Number(v.analytical_run || 1) === 1 && d.entries.find((e) => e.id === v.entry_id)?.qc_class !== 'Analytical');
    const out = [];
    r.verdicts.forEach((v, i) => {
      const gk = `${v.entry_id}:${v.analytical_run || 1}`;
      let gq = out.find((x) => x.key === gk);
      if (!gq) { gq = { entry_id: v.entry_id, key: gk, run: Number(v.analytical_run || 1), label: v.label, qc_type: d.entries.find((e) => e.id === v.entry_id)?.qc_type || '', counts: counts(v), rows: [] }; out.push(gq); }
      gq.rows.push({ ...v, key: i, acc: acc(v), counts: counts(v) });
    });
    out.forEach((gq) => {
      const n = (k) => gq.rows.filter((x) => x.verdict === k).length;
      gq.fail = n('Fail'); gq.wait = n('Waiting'); gq.pass = n('Pass');
      gq.open_items = gq.counts ? gq.rows.filter((x) => ['Fail', 'Waiting'].includes(x.verdict) && !x.acc).length : 0;
      gq.vis = gq.rows.filter((x) => view.qc === 'all' || (['Fail', 'Waiting'].includes(x.verdict) && x.counts)); gq._dflt = gq.vis.length > 0;
      gq.verdict = gq.fail ? 'Fail' : gq.wait ? 'Waiting' : 'Pass';
      gq.summary = `${gq.rows.length} check${gq.rows.length === 1 ? '' : 's'}: ${gq.pass} pass${gq.fail ? `, ${gq.fail} fail` : ''}${gq.wait ? `, ${gq.wait} waiting` : ''}${!gq.counts ? ' · not used: no reported reading comes from this run' : gq.open_items ? ` · ${gq.open_items} to accept or return` : (gq.fail || gq.wait) ? ' · accepted' : ''}`;
    });
    return out;
  }, [r, d, view.qc]);
  const qcNestedCols = [
    { field: 'label', title: 'QC entry', type: 'readonly', width: 160, help: 'Repeated on every row so a long analyte list keeps its place' },
    { field: 'limit_type', title: 'Check', type: 'readonly', width: 120 },
    { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 120 },
    { field: 'measured', title: 'Measured', type: 'readonly', width: 85, align: 'right', format: (v, x) => (v === null || v === undefined ? '' : nfmt(v) + (['Recovery %', 'RPD'].includes(x.limit_type) ? ' %' : '')) },
    { field: 'limit_text', title: 'Limit', type: 'readonly', width: 110 },
    { field: 'verdict', title: 'Verdict', type: 'readonly', width: 85, cellClass: (x) => verdictClass(x.verdict) },
    { field: 'accepted', title: 'Accepted', type: 'readonly', width: 300, compute: (x) => (x.acc ? `${x.acc.accepted_by}: ${x.acc.justification}` : '') },
    { field: 'act', title: '', type: 'button', width: 90, label: (x) => (can && x.counts && ['Fail', 'Waiting'].includes(x.verdict) && !x.acc ? 'Accept…' : ''),
      onClick: async (x) => {
        if (!can || !x.counts || !['Fail', 'Waiting'].includes(x.verdict) || x.acc) return;
        const m = await dialogs.form({ title: `Accept ${x.label} ${x.analyte_name || ''} ${x.limit_type}`, okText: 'Accept',
          intro: <>Verdict: <b>{x.verdict}</b>{x.measured !== null && x.measured !== undefined ? ` (${nfmt(x.measured)})` : ''}, limit {x.limit_text || ''}. Write why the batch can still be reported (it is kept with your name).</>,
          fields: [{ name: 'justification', label: 'Justification', type: 'textarea', required: true }],
          submit: (v) => api.acceptQc(b.id, { entry_id: x.entry_id, analyte_id: x.analyte_id, limit_type: x.limit_type, justification: v.justification, analytical_run: x.analytical_run || 1 }) });
        if (m) { toast('QC accepted with your justification.'); reload(); }
      } },
    { field: 'note', title: 'How', type: 'readonly', width: 280 },
  ];
  const qcCols = [
    toggleCol((gq) => 'q:' + gq.key),
    { field: 'label', title: 'QC entry', type: 'readonly', width: 190 },
    { field: 'run', title: 'Run', type: 'readonly', width: 50 },
    { field: 'qc_type', title: 'QC type', type: 'readonly', width: 170 },
    { field: 'summary', title: 'Checks', type: 'readonly', width: 380 },
    { field: 'verdict', title: 'Verdict', type: 'readonly', width: 95, cellClass: (gq) => verdictClass(gq.verdict) },
  ];
  const qcDetail = { open: (gq) => isOpen('q:' + gq.key, gq._dflt), key: (gq) => 'q:' + gq.key + ':' + view.qc,
    render: (gq) => (!gq.vis.length
      ? <div className="rvnone">{gq.counts ? `All ${gq.rows.length} check${gq.rows.length === 1 ? '' : 's'} pass.` : 'Not used for reporting (no reported reading comes from this run).'} "All analytes" shows them.</div>
      : <div onMouseDown={stop} onKeyDown={stop} onContextMenu={stop} onDoubleClick={stop}><ReadGrid rows={gq.vis} columns={qcNestedCols} keyField="key" /></div>) };

  async function approve() {
    if (r.problems.length) { toast('Resolve the items listed first.', 'err'); return; }
    const done = await dialogs.sign({ what: `QC Review and approval of ${b.batch_code}`, meaning: 'Reviewed by', needReason: false,
      submit: ({ signature }) => api.approveBatch(b.id, signature) });
    if (done) { toast('Batch approved: results stored.'); reload(); }
  }
  async function giveBack() {
    const steps = d.steps.filter((x) => x.status === 'Completed' && x.step_type !== 'QC Review' && x.step_type !== 'Batching');
    const m = await dialogs.form({ title: `Return ${b.batch_code} to the analyst`, okText: 'Next: sign', intro: 'The step you choose and every step after it reopen, and lose their review approval. Say what needs fixing in the next dialog.',
      fields: [{ name: 'step_run_id', label: 'Reopen from', type: 'select', required: true, blank: false, value: steps[steps.length - 1]?.id, options: steps.map((x) => ({ value: x.id, label: x.step_name })) }] });
    if (!m) return;
    const done = await dialogs.sign({ what: `Return ${b.batch_code} to the analyst (from ${steps.find((x) => x.id === m.step_run_id)?.step_name})`, meaning: 'Returned by', needReason: true,
      submit: ({ reason, signature }) => api.returnBatch(b.id, { step_run_id: m.step_run_id, reason, signature }) });
    if (done) { toast('Returned to the analyst.'); reload(); }
  }

  const note = approved ? null : b.status === 'Cancelled' ? 'This batch was cancelled.'
    : b.status !== 'Awaiting Review' ? 'The batch comes to review when every bench step is completed.'
      : !r.can_review ? 'Waiting for a reviewer: someone with testing.review in this lab (Lab Supervisor or QA by default).'
        : r.performer ? 'You performed or witnessed a step of this batch, so someone else reviews it.' : null;
  const repreps = d.entries.filter(isPast);
  return <>
    {note && <div className="tbnote">{note}</div>}
    {can && (r.problems.length ? <Todo title="To resolve before approval" items={r.problems} />
      : <div className="tbnote"><b>Ready to approve.</b> Every step is approved; approving the batch stores the chosen results and compares them with each sample's specification.</div>)}
    {can && <div className="tbacts" style={{ margin: '6px 0 12px' }}>
      <Button type="button" variant="primary" id="rv_ok" disabled={r.problems.length > 0} title={r.problems.length ? 'Resolve the items listed first' : undefined} onClick={approve}>Approve batch</Button>
      <Button type="button" variant="outline-secondary" id="rv_ret" onClick={giveBack}>Return to the analyst</Button></div>}
    {(d.invalid_readings || []).length > 0 && <div className="tbnote"><b>Readings that are not results</b> (never reported; each needs a valid reading in a later analytical run):{' '}
      {d.invalid_readings.map((x, i) => <span key={i}>{i > 0 && ' · '}{x.label} {x.analyte_name}: {x.value_text} (run {x.analytical_run}){x.replaced ? ', read again' : <>, <b>not read again yet</b></>}</span>)}</div>}
    {repreps.length > 0 && <div className="tbnote" id="rv_repreps"><b>Re-prepped samples</b> (kept in this batch with what was recorded; their results are not reported from it):{' '}
      {repreps.map((e, i) => { const n = reprepNote(e); return <span key={e.id}>{i > 0 && ' · '}{e.label}: {n.href ? <a href={n.href}>{n.text}</a> : n.text}{e.reprep_by_name ? ` (asked by ${e.reprep_by_name} ${dt(e.reprep_at)})` : ''}</span>; })}</div>}
    {(r.timepoints || []).length > 0 && <div className="tbnote"><b>Timepoint reviews</b> (released on their own as preliminary results; carried into the final results unchanged):{' '}
      {r.timepoints.map((x, i) => <span key={x.step_run_id}>{i > 0 && ' · '}<a href={`#/testing/batches/${b.id}?step=${x.step_key}`}>{x.step_name}</a>: {x.released ? `released by ${x.released_by_name || ''} ${dt(x.released_at)}` : x.ready ? 'ready for review' : 'waiting for its steps'}</span>)}</div>}
    {marks.length > 0 && b.status !== 'Cancelled' && <>
      <h3 style={{ margin: '14px 0 6px' }}>Steps {b.status === 'Awaiting Review' && <small className="tbmuted">{unmarked ? `${unmarked} of ${marks.length} still to approve: open each step, check it, then approve it` : 'all approved'}</small>}</h3>
      <div id="rv_steps"><StepMarks ctx={ctx} marks={marks} can={can} withType /></div>
    </>}
    <div className="rvhead"><h3>{approved ? 'Stored results' : 'Results to report'}</h3>
      <Switch name="results" options={[['hits', 'Hits above the LOQ and items to check'], ['all', 'All analytes']]} onChange={switchTo} /></div>
    <div id="rv_res"><ReadGrid rows={samples} columns={sampleCols} keyField="key" emptyText="No samples in this batch." rowClass={(sm) => (sm.out ? 'rvout' : '')} detail={sampleDetail} /></div>
    {(r.loads || []).length > 0 && <><h3 style={{ margin: '14px 0 6px' }}>Incubator loads outside their target</h3><div id="rv_loads"><LoadsGrid ctx={ctx} loads={r.loads} can={can} /></div></>}
    <div id="rv_flags"><EquipmentFlagsCard batchId={b.id} can={can} onAccepted={reload} /></div>
    <div id="rv_aliq"><AliquotsCard batchId={b.id} /></div>
    <div className="rvhead"><h3>QC</h3>
      <Switch name="qc" options={[['exceptions', 'Failing or waiting only'], ['all', 'All analytes']]} onChange={switchTo} /></div>
    <div id="rv_qc"><ReadGrid rows={groups} columns={qcCols} keyField="key" emptyText="This test has no QC criteria." rowClass={(gq) => (gq.counts ? '' : 'rvoff')} detail={qcDetail} /></div>
    <div id="rv_trend"><ReviewTrends batchId={b.id} /></div>
  </>;
}

// A timepoint review (e.g. day 7 of a stability or preservative efficacy study): approve the steps before it, choose the
// results, then release them as preliminary (signed "Reviewed by"). The final review carries them over unchanged.
const TP_STORED_COLS = [
  { field: 'sample_code', title: 'Sample', type: 'link', width: 140, href: (x) => '#/samples/' + x.sample_id },
  { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 150 },
  { field: 'result_name', title: 'Result of', type: 'readonly', width: 150 },
  { field: 'reported', title: 'Result', type: 'readonly', width: 90, align: 'right' },
  { field: 'unit', title: 'Unit', type: 'readonly', width: 65 },
  { field: 'stage', title: 'Stage', type: 'readonly', width: 190, compute: (x) => (x.stage === 'Preliminary' ? 'Preliminary: not a final result' : 'Final (carried over)') },
  { field: 'basis', title: 'Reported as', type: 'readonly', width: 200, compute: storedBasis },
];
function TimepointPanel({ ctx, r, tp }) {
  const { b, d, dialogs, toast, reload } = ctx;
  const can = r.can_review && !r.performer && tp.ready && !tp.released && ['In Progress', 'Awaiting Review'].includes(b.status);
  const marks = useMemo(() => (d.review_marks || []).filter((m) => (tp.feeds || []).includes(m.step_run_id)), [d, tp]);
  const tpLoads = (r.loads || []).filter((l) => (tp.feeds || []).includes(l.step_run_id));
  const stored = useMemo(() => (tp.stored || []).map((x, i) => ({ ...x, key: i })), [tp]);
  const items = useMemo(() => (tp.items || []).map((x, i) => ({ ...x, key: i, n: x.candidates.length, sample_id: d.entries.find((e) => e.requested_test_id === x.requested_test_id)?.sample_id })), [tp, d]);
  const itemCols = useMemo(() => {
    const resultName = (k) => d.steps.find((x) => x.step_key === k)?.step_name || k;
    return [
      { field: 'sample_label', title: 'Sample', type: 'link', width: 140, href: (x) => (x.sample_id ? '#/samples/' + x.sample_id : null) },
      { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 150 },
      { field: 'rk', title: 'Result of', type: 'readonly', width: 150, compute: (x) => resultName(x.result_key) },
      { field: 'reported', title: 'Result', type: 'readonly', width: 90, align: 'right', compute: (x) => (x.chosen_entry_id ? x.reported ?? x.value_text ?? '' : '') },
      { field: 'unit', title: 'Unit', type: 'readonly', width: 65 },
      { field: 'n', title: 'Readings', type: 'readonly', width: 75 },
      { field: 'choice', title: 'Reportable reading', type: 'readonly', width: 290, compute: choiceText },
      { field: 'pick', title: '', type: 'button', width: 90, label: (x) => (can && x.n > 1 ? 'Choose…' : ''), onClick: (x) => can && x.n > 1 && chooseReading(ctx, x, x.result_key) },
    ];
  }, [d, can, ctx]);
  async function release() {
    if (tp.problems.length) { toast('Resolve the items listed first.', 'err'); return; }
    const done = await dialogs.sign({ what: `${tp.step_name} of ${b.batch_code}: release preliminary results`, meaning: 'Reviewed by', needReason: false,
      submit: ({ signature }) => api.releaseTimepoint(b.id, tp.step_run_id, signature) });
    if (done) { toast('Preliminary results released.'); reload(); }
  }
  return <>
    {tp.released ? <div className="tbnote"><b>Released</b> as preliminary results by {tp.released_by_name || ''} {dt(tp.released_at)}. The steps before it are locked; the final review carries these results over unchanged.</div>
      : !tp.ready ? <div className="tbnote">This timepoint comes to review when every step before it is completed.</div>
        : !r.can_review ? <div className="tbnote">Waiting for a reviewer: someone with testing.review in this lab.</div>
          : r.performer ? <div className="tbnote">You performed or witnessed a step of this batch, so someone else reviews it.</div>
            : tp.problems.length ? <Todo title="To resolve before release" items={tp.problems} />
              : <div className="tbnote"><b>Ready to release.</b> The results are stored as <b>Preliminary: not a final result</b> and can be reported as such.</div>}
    {can && <div className="tbacts" style={{ margin: '6px 0 12px' }}><Button type="button" variant="primary" id="tp_rel" disabled={tp.problems.length > 0} title={tp.problems.length ? 'Resolve the items listed first' : undefined} onClick={release}>Release preliminary results</Button></div>}
    <h3 style={{ margin: '14px 0 6px' }}>Steps before this timepoint</h3>
    <div id="tp_steps"><StepMarks ctx={ctx} marks={marks} can={can} onlyCompleted /></div>
    {tpLoads.length > 0 && <><h3 style={{ margin: '14px 0 6px' }}>Incubator loads outside their target</h3><div id="tp_loads"><LoadsGrid ctx={ctx} loads={tpLoads} can={can} /></div></>}
    <div id="tp_flags"><EquipmentFlagsCard batchId={b.id} can={can} stepRunIds={tp.feeds || []} onAccepted={reload} /></div>
    <h3 style={{ margin: '14px 0 6px' }}>{tp.released ? 'Released results' : 'Results to release'}</h3>
    <div id="tp_res">{tp.released
      ? <ReadGrid rows={stored} columns={TP_STORED_COLS} keyField="key" emptyText="Nothing stored." />
      : <ReadGrid rows={items} columns={itemCols} keyField="key" rowClass={(x) => (x.chosen_entry_id ? '' : 'tbrerun')}
        emptyText={tp.ready ? 'No results.' : 'The results appear when the steps before it are completed.'} />}</div>
  </>;
}
