// One saved chart (#/trending/charts/:id): its panels for a period, frozen limits, QA approval, the limits into the
// test's Draft version, signal reviews, retiring and the PDF.
import { useState } from 'react';
import { applyLimits, approveChart, downloadTrend, freezeLimits, getChart, retireChart, unfreezeLimits } from '../../api/trending.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { CONTROL, Panels, TrendTabs, d10, n3, safe } from './TrendPanel.jsx';
import { Button, Card, Form } from 'react-bootstrap';

// The chart's QA state, and the actions on it: QA's approval, the limits into the test
function QaBanner({ ch, d, onApprove, onApply }) {
  const retired = ch.status === 'Inactive';
  const l = d.limits_for_test;
  const applied = ch.applied_version_id ? <> Last carried into <a href={`#/methods/versions/${ch.applied_version_id}`}>version {ch.applied_version_no}</a> ({ch.applied_version_status || ''}) by {ch.applied_by_name || ''} on {d10(ch.applied_at)}.</> : null;
  return <>
    {ch.qa_review && (ch.qa_status === 'Approved'
      ? <div className="trfrozen trqa ok"><b>Approved by QA</b>: {ch.qa_approved_by_name || ''} on {d10(ch.qa_approved_at)} (electronic signature). A change to what it charts, its rules or its limits sends it back to QA.</div>
      : <div className="trfrozen trqa wait"><b>Awaiting QA approval.</b> This chart is QA reviewable: it counts{ch.show_in_review ? ' (and appears in QC Review)' : ''} once QA has approved it and its limits. Someone with trending.approve who did not make or change it approves it.
        {d.can_approve && !retired && <> <Button type="button" variant="primary" id="qaok" onClick={onApprove}>Approve chart and limits…</Button></>}</div>)}
    {l && (l.problem
      ? <div className="trfrozen trqa"><b>QC limits for the test</b>: {l.problem}.{applied}</div>
      : <div className="trfrozen trqa"><b>QC limits for the test</b>: {l.qc_type} {l.limit_type} {n3(l.lcl)} to {n3(l.ucl)} (centre line ± 3 sigma, frozen, approved by QA).{applied}
        {d.can_design && !retired && <> <Button type="button" variant="outline-secondary" id="apply" onClick={onApply}>Use these limits for the test…</Button></>}
        <div className="help" style={{ fontSize: 11.5, color: 'var(--muted)' }}>They go into the test&apos;s Draft version (a new one from the effective version if there is none), signed with a reason; the version is then approved in the designer as usual.</div></div>)}
  </>;
}

export default function ChartPage({ params: [id], query }) {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const q = new URLSearchParams(query);
  const from = q.get('from') || ''; const to = q.get('to') || '';
  const [f, setF] = useState(from); const [t, setT] = useState(to);
  const { data: d, error, reload } = useApi((o) => getChart(id, from, to, o), [id, from, to]);
  if (error && !d) return <><PageHeader title="Chart" /><Card body className="err">{error.message}</Card></>;
  if (!d) return <><PageHeader title="Chart" /><div className="loading">Loading…</div></>;

  const ch = d.chart; const multi = d.panels.length > 1; const ctl = CONTROL.includes(ch.source);
  const retired = ch.status === 'Inactive';
  const frozen = ch.frozen_cl !== null;
  const run = async (fn, ok) => { try { const r = await fn(); toast(typeof ok === 'function' ? ok(r) : ok); reload(); } catch (e) { toast(e.message, 'err'); } };

  async function freeze() {
    const r = await dialogs.form({ title: 'Freeze the control limits', okText: 'Next',
      intro: 'The centre line and sigma are worked out from a baseline period when the process was stable, then kept: new points are judged against them instead of moving the limits with every point. Pick the baseline (at least 20 points for individuals, 6 periods for counts).',
      fields: [{ name: 'from', label: 'Baseline from', type: 'date', value: from }, { name: 'to', label: 'Baseline to', type: 'date', value: to }] });
    if (!r) return;
    const reason = await dialogs.reason(`the control limits of ${ch.chart_code}`); if (!reason) return;
    run(() => freezeLimits(ch.id, { from: r.from || null, to: r.to || null, reason }), (out) => `Limits frozen: centre line ${n3(out.cl)} from ${out.n} points.`);
  }
  async function unfreeze() {
    const reason = await dialogs.reason(`the control limits of ${ch.chart_code} (back to limits from the data)`); if (!reason) return;
    run(() => unfreezeLimits(ch.id, reason), 'The limits are worked out from the data again.');
  }
  async function approve() {
    const ok = await dialogs.sign({ what: `${ch.chart_code} ${ch.chart_name}: the chart, its rules and its ${frozen ? 'frozen ' : ''}limits`, meaning: 'Approved by', needReason: false,
      submit: ({ signature }) => approveChart(ch.id, signature) });
    if (ok) { toast(`${ch.chart_code} approved.`); reload(); }
  }
  async function apply() {
    const l = d.limits_for_test;
    const r = await dialogs.sign({ title: 'Use these limits for the test', what: `${ch.chart_code}: ${l.qc_type} ${l.limit_type} limits ${n3(l.lcl)} to ${n3(l.ucl)} into the test's Draft version`, meaning: 'Changed by', needReason: true,
      defaultReason: `Control limits from trend chart ${ch.chart_code}`,
      submit: ({ signature, reason }) => applyLimits(ch.id, { signature, reason }) });
    if (r && r.version_id) { toast(`Limits written into version ${r.version_no}${r.created ? ' (a new Draft)' : ''}: approve it in the designer.`); window.location.hash = `#/methods/versions/${r.version_id}?tab=workflow`; }
  }
  async function retire() {
    const reason = await dialogs.reason(`${ch.chart_code} (retired: off Trend watch and QC Review; its reviews are kept)`); if (!reason) return;
    try { await retireChart(ch.id, reason); toast(`${ch.chart_code} retired.`); window.location.hash = '#/trending/charts'; } catch (e) { toast(e.message, 'err'); }
  }
  const pdf = () => downloadTrend('/pdf', { chart_id: ch.id, from, to }, safe(`${ch.chart_code} ${ch.chart_name}`) + '.pdf', site?.id).then(() => toast('PDF downloaded.')).catch((e) => toast(e.message, 'err'));
  const show = () => { window.location.hash = `#/trending/charts/${id}${f || t ? `?from=${f}&to=${t}` : ''}`; };

  const actions = <>
    {d.can_manage && !retired && <>
      <Button variant="outline-secondary" href={`#/trending/build?chart=${ch.id}`}>Change</Button>
      {ctl && !multi && (frozen ? <Button type="button" variant="outline-secondary" id="unfz" onClick={unfreeze}>Recalculate limits…</Button> : <Button type="button" variant="outline-secondary" id="fz" onClick={freeze}>Freeze limits…</Button>)}
      <Button type="button" variant="light" id="ret" onClick={retire}>Retire…</Button>
    </>}
    <Button type="button" variant="light" id="pdf" onClick={pdf}>PDF of the chart</Button>
  </>;
  const subtitle = <>{ch.description || ''}{ch.description && <br />}Made by {ch.created_by_name}. {retired && <><b>Retired.</b> </>}{ch.watch ? 'On Trend watch. ' : ''}{ch.show_in_review ? 'Shown in QC Review of this test\'s batches.' : ''}</>;
  const ctx = { chartId: ch.id, canManage: d.can_manage && !retired, reload, multi, from, to, rules: ch.rules, frozen: frozen ? { cl: ch.frozen_cl, sigma: ch.frozen_sigma } : null };
  return <>
    <PageHeader title={`${ch.chart_code} ${ch.chart_name}`} subtitle={subtitle} actions={actions} audit={{ kind: 'trend_chart', id: ch.id }} />
    <TrendTabs on="charts" />
    <QaBanner ch={ch} d={d} onApprove={approve} onApply={apply} />
    {frozen && <div className="trfrozen"><b>Limits frozen</b> by {ch.frozen_by_name || ''} on {d10(ch.frozen_at)}: centre line {n3(ch.frozen_cl)}{Number(ch.frozen_sigma) ? `, sigma ${n3(ch.frozen_sigma)}` : ''}, from {ch.frozen_n} points{ch.frozen_from || ch.frozen_to ? ` between ${d10(ch.frozen_from) || 'the start'} and ${d10(ch.frozen_to) || 'then'}` : ''}. New points are judged against this baseline.</div>}
    <div className="trbar"><label>From <Form.Control type="date" id="from" value={f} onChange={(e) => setF(e.target.value)} /></label><label>To <Form.Control type="date" id="to" value={t} onChange={(e) => setT(e.target.value)} /></label>
      <Button type="button" variant="outline-secondary" id="go" onClick={show}>Show</Button>
      <span className="sp" /><span className="help" style={{ fontSize: 12, color: 'var(--muted)' }}>Default: the last 12 months.</span></div>
    <div id="ps"><Panels panels={d.panels} ctx={ctx} withTitles={multi} margin="6px 0 6px" /></div>
  </>;
}
