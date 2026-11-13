// A stability study (#/stability/studies/:id): placement in the chambers' racks, the stored material (Dispose…), the
// pulls (Record pull…), the chamber excursions (QA's Assess…), the issued reports (Preview, Issue report…), the
// amendments, the T0 tests and the summary of results so far; Amend the study…, Cancel the study….
import { useMemo, useRef, useState } from 'react';
import { assessExcursion, cancelStudy, disposeStorage, getStudy, issueReport, newStabilityVersion, placeStudy, previewPdfUrl, reportPdfUrl, studySummary, summaryPdfUrl } from '../../api/stability.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import PullsGrid from './PullsGrid.jsx';
import { d8, dt, ext, Failed, iso, Loading } from './shared.jsx';
import { Button, Form } from 'react-bootstrap';

const FATES = [{ value: 'Destroyed', label: 'Destroyed' }, { value: 'Returned', label: 'Returned to the client' }, { value: 'Retained', label: 'Kept as retain' }];
const fateText = (v) => ({ Destroyed: 'Destroyed', Returned: 'Returned to the client', Retained: 'Kept as retain' }[v] || v);
const storRow = (r) => (r.status !== 'Stored' && r.status !== 'Used up' ? 'mutedrow' : '');

export default function StudyPage({ params: [id] }) {
  const { data: d, error, reload } = useApi(() => getStudy(id), [id]);
  const stamp = useRef({ d: null, n: 0 });
  if (d && stamp.current.d !== d) stamp.current = { d, n: stamp.current.n + 1 };
  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;
  return <Study key={stamp.current.n} d={d} reload={reload} />;
}

function Study({ d, reload }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const s = d.study;
  const running = ['Awaiting material', 'Active'].includes(s.status);

  const amend = async () => {
    const ok = await dialogs.form({ title: `Amend study ${s.study_code}`, okText: 'Start the amendment', fields: [],
      intro: 'An amendment is a new version of the stability quote: change the design (add timepoints, tests or conditions, or untick what stops), issue it and send it to the client. Nothing changes in the study until the client accepts it. Pulls already ordered or taken stay as they are; T0 cannot change.' });
    if (!ok) return;
    try { await newStabilityVersion(s.project_id, { reason: `Amendment of ${s.study_code}` }); toast('Amendment started: change the design, then issue and send it.'); window.location.hash = '#/stability/quotes/' + s.project_id; } catch (e) { toast(e.message, 'err'); }
  };

  // Cancel: the fate of each condition's stored material, the reason, the signature
  const cancel = async () => {
    const stored = d.storage.filter((r) => r.status === 'Stored');
    const toCancel = d.pulls.filter((p) => ['Scheduled', 'Ordered'].includes(p.status)).length;
    const v = await dialogs.form({ title: `Cancel study ${s.study_code}`, okText: 'Next: sign',
      intro: `${toCancel} pull(s) still to come are cancelled (open pull orders with their samples and tests too${s.status === 'Awaiting material' ? ', and the T0 order' : ''}). Pulls already taken stay in testing and are reported and billed. ${stored.length ? 'Say what happens to the material in each chamber:' : ''}`,
      fields: stored.map((r) => ({ name: 'f_' + r.id, label: `${r.storage_code}: ${r.condition_name}, ${r.units_left} left (${r.equipment_name}, rack ${r.rack_code})`, type: 'select', required: true, options: FATES }))
        .concat(stored.map((r) => ({ name: 'n_' + r.id, label: `${r.storage_code}: note (optional, e.g. the courier or where the retain is kept)` }))) });
    if (!v) return;
    const dispositions = stored.map((r) => ({ storage_id: r.id, disposition: v['f_' + r.id], note: v['n_' + r.id] || '' }));
    const done = await dialogs.sign({ what: `Cancel stability study ${s.study_code}`, meaning: 'Cancelled by', okText: 'Cancel the study',
      submit: ({ reason, signature }) => cancelStudy(s.id, { reason, dispositions, signature }) });
    if (done) { toast(`${s.study_code} cancelled: ${done.pulls} pull(s) cancelled.`); reload(); }
  };

  const storCols = useMemo(() => {
    const canDispose = (r) => d.can_manage && r.status === 'Stored' && Number(r.units_still_needed) === 0 && s.status !== 'Awaiting material';
    const dispose = async (r) => {
      const v = await dialogs.form({ title: `Dispose of ${r.storage_code}`, okText: 'Next: sign',
        intro: `${r.units_left} ${r.units_left === 1 ? 'unit' : 'units'} of ${r.condition_name} material in ${r.equipment_name}, rack ${r.rack_code}${r.position ? ', ' + r.position : ''}. No pull needs it any more. Recording its fate frees the rack.`,
        fields: [{ name: 'disposition', label: 'What happens to it', type: 'select', required: true, options: FATES }, { name: 'note', label: 'Note (optional)' }] });
      if (!v) return;
      const done = await dialogs.sign({ what: `${r.storage_code}: ${fateText(v.disposition)}`, meaning: 'Disposed by',
        submit: ({ reason, signature }) => disposeStorage(r.id, { reason, disposition: v.disposition, note: v.note, signature }) });
      if (done) { toast(`${r.storage_code}: ${fateText(v.disposition).toLowerCase()}.`); reload(); }
    };
    return [
      { field: 'storage_code', title: 'Label', type: 'readonly', width: 115 }, { field: 'condition_name', title: 'Condition', type: 'readonly', width: 130 },
      { field: 'equipment_name', title: 'Chamber', type: 'link', width: 200, href: (r) => '#/equipment/' + r.equipment_id },
      { field: 'rack_code', title: 'Rack', type: 'readonly', width: 60 }, { field: 'position', title: 'Position', type: 'readonly', width: 100 },
      { field: 'placed_on', title: 'Placed', type: 'readonly', width: 100, format: d8 },
      { field: 'units_received', title: 'Units placed', type: 'readonly', width: 90 }, { field: 'units_required', title: 'Required', type: 'readonly', width: 75 },
      { field: 'units_left', title: 'Left', type: 'readonly', width: 55 }, { field: 'units_still_needed', title: 'Still needed', type: 'readonly', width: 90 },
      { field: 'shortfall', title: 'Short at placement', type: 'readonly', width: 120, cellClass: (r) => (Number(r.shortfall) ? 'tbfail' : '') },
      { field: 'status', title: 'Status', type: 'readonly', width: 150, compute: (r) => fateText(r.status) },
      { field: 'disp', title: '', type: 'button', width: 110, label: (r) => (canDispose(r) ? 'Dispose…' : ''), onClick: (r) => canDispose(r) && dispose(r) },
      { field: 'disposed', title: 'Disposed', type: 'readonly', width: 230, compute: (r) => (r.disposed_at ? `${d8(r.disposed_at)}, ${r.disposed_by_name || ''}${r.disposition_note ? ': ' + r.disposition_note : ''}` : '') },
    ];
  }, [d, s.status, dialogs, toast, reload]);

  const amdCols = useMemo(() => [
    { field: 'amendment_no', title: 'Amendment', type: 'readonly', width: 95 },
    { field: 'versions', title: 'Quote version', type: 'link', width: 140, compute: (r) => `v${r.from_version} to v${r.to_version}`, href: () => '#/stability/quotes/' + s.project_id },
    { field: 'applied_at', title: 'Accepted', type: 'readonly', width: 160, format: dt },
    { field: 'pulls_added', title: 'Pulls added', type: 'readonly', width: 95 }, { field: 'pulls_cancelled', title: 'Cancelled', type: 'readonly', width: 85 },
    { field: 'pulls_changed', title: 'Moved', type: 'readonly', width: 70 }, { field: 'applied_by_name', title: 'Recorded as', type: 'readonly', width: 170 },
  ], [s.project_id]);

  const actions = <>
    <Button variant="light" href={summaryPdfUrl(s.id)} {...ext}>Summary so far (PDF)</Button>
    {d.can_amend && s.status !== 'Cancelled' && !s.amendment_pending_version && <> <Button type="button" variant="light" id="amend" onClick={amend}>Amend the study…</Button></>}
    {d.can_cancel && running && <> <Button type="button" variant="light" id="cancel" onClick={cancel}>Cancel the study…</Button></>}
  </>;
  const subtitle = <>
    <a href={'#/clients/' + s.client_id}>{s.client_name}</a> · lot {s.lot || '-'} · {s.site_code} · <Badge status={s.status} /> · from quote <a href={'#/stability/quotes/' + s.project_id}>{s.project_code + (s.version_no > 1 ? ' v' + s.version_no : '')}</a>{s.amendment_no ? ` (amendment ${s.amendment_no})` : ''}
    {' '}· T0 order <a href={'#/orders/' + s.t0_order_id}>{s.t0_order_code}</a>{s.t0_sample_code ? <>, sample <a href={'#/samples/' + s.t0_sample_id}>{s.t0_sample_code}</a></> : ' (sample expected)'}
  </>;

  return <>
    <PageHeader title={`${s.study_code}: ${s.product || 'stability study'}`} subtitle={subtitle} actions={actions} audit={{ kind: 'stability_study', id: s.id }} />
    {s.status === 'Cancelled' && <div className="alert alert-warning stb-done"><b>Cancelled</b> {dt(s.cancelled_at)} by {s.cancelled_by_name || ''}: {s.cancel_reason || ''}. Pulls already taken stay in testing and are reported and billed.</div>}
    {s.amendment_pending_version && <div className="alert alert-warning stb-amd">Amendment in progress: quote version {s.amendment_pending_version} (<a href={'#/stability/quotes/' + s.project_id}>open it</a>). The study runs to version {s.version_no} until the client accepts it.</div>}
    {d.need.length > 0 && ['Awaiting material', 'Active', 'Completed'].includes(s.status) && <PlaceCard d={d} reload={reload} />}
    <Section title="Stored material" help="One labelled lot of material per condition, in its chamber, rack and position. Required = every pull of the design plus the reserve. Material no longer needed (the study completed, or an amendment dropped its condition) is destroyed, returned or kept as a retain, which frees the rack.">
      <div id="stor"><ReadGrid rows={d.storage} columns={storCols} emptyText="Nothing placed yet." rowClass={storRow} /></div>
    </Section>
    <Section title="Pulls" help="Each pull gets its lab order on its scheduled date (weekends and holidays moved inside the window).">
      <div id="pulls"><PullsGrid rows={d.pulls} canManage={d.can_manage && running} reload={reload} withStudy={false} /></div>
    </Section>
    <ExcursionCard d={d} reload={reload} />
    <ReportsCard d={d} reload={reload} />
    {d.amendments.length > 0 && <Section title="Amendments" help="Each accepted amendment: the quote version the study switched to and what it did to the pulls. Pulls already ordered or taken never change.">
      <ReadGrid rows={d.amendments} columns={amdCols} />
    </Section>}
    <Section title="T0 baseline tests">
      <div id="t0">{d.t0tests.length ? d.t0tests.map((t, i) => <span key={i}>{i > 0 && ' · '}{t.test_name} <span className="help">({t.status}{t.due_date ? ', due ' + d8(t.due_date) : ''})</span></span>) : <span className="help">None</span>}</div>
    </Section>
    <Section className="stb-rep" title="Summary of results so far" help="One table per test: analytes down, timepoints across, against the specification. Preliminary results are marked P; E marks results of material exposed to an excursion assessed as having an impact. The issued reports above show finalized results only.">
      <Summary id={s.id} />
    </Section>
  </>;
}

function Summary({ id }) {
  const { data: r, error } = useApi(() => studySummary(id), [id]);
  if (error && !r) return <div id="rep">{error.message}</div>;
  if (!r) return <div id="rep" className="help">Loading…</div>;
  if (!r.sections.length) return <div id="rep"><span className="help">No results yet.</span></div>;
  return <div id="rep">{r.sections.map((sec, si) => <div key={si}>
    <h3>{sec.condition.condition_name}{sec.condition.dropped && <> <span className="help">(no longer in the study)</span></>}</h3>
    {sec.tests.map((t, ti) => <div key={ti}>
      <div><b>{t.test_name}</b></div>
      <table><tbody>
        <tr><th className="l">Analyte</th><th className="l">Specification</th>{sec.timepoints.map((tp, i) => <th key={i}>{tp.label}</th>)}</tr>
        {t.analytes.length ? t.analytes.map((a, ai) => <tr key={ai}>
          <td className="l">{a.analyte_name}{a.unit && <> <span className="help">{a.unit}</span></>}</td><td className="l">{a.spec}</td>
          {a.values.map((x, xi) => (x === null ? <td key={xi} className="help">–</td> : x.pending ? <td key={xi} className="pend">pending</td>
            : <td key={xi} className={x.conformance === 'Does not conform' ? 'oos' : ''}>{x.text}{x.stage === 'Preliminary' && <sup>P</sup>}{x.flagged && <sup className="ex">E</sup>}</td>))}
        </tr>) : <tr><td className="l pend" colSpan={2 + sec.timepoints.length}>No results yet</td></tr>}
      </tbody></table>
    </div>)}
  </div>)}</div>;
}

// Chamber excursions while this study's material was in the chamber (Temperature log), and QA's assessment of each
function ExcursionCard({ d, reload }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const st = d.study;
  const rows = useMemo(() => d.excursions.map((x, i) => ({ ...x, key: i })), [d]);
  const open = d.excursions.filter((x) => !x.assessment_id).length;
  const columns = useMemo(() => {
    const assess = async (x) => {
      const v = await dialogs.form({ title: `Assess ${x.entry_code} for ${st.study_code}`, okText: 'Next: sign',
        intro: `${x.equipment_code} ${x.equipment_name}, ${dt(x.entry_at)}: ${(x.problems || []).join('; ')}${x.failure_reason ? ' (' + x.failure_reason + ')' : ''}. Material ${x.storage_code} (${x.condition_name}). Back in range: ${x.window_end ? dt(x.window_end) : 'not yet'}.`,
        fields: [{ name: 'decision', label: 'Impact on this study', type: 'select', required: true, value: x.decision || '',
          options: [{ value: 'No impact', label: 'No impact' }, { value: 'Impact: results flagged', label: 'Impact: flag the results of the exposed material' }, { value: 'Client to decide', label: 'Client to decide' }] },
          { name: 'justification', label: 'Justification', type: 'textarea', required: true, value: x.justification || '', help: 'e.g. how long and how far out of range, the product\'s sensitivity, the pulls concerned.' }] });
      if (!v) return;
      const done = await dialogs.sign({ what: `Excursion ${x.entry_code} for ${st.study_code}: ${v.decision}`, meaning: 'Assessed by', needReason: false,
        submit: ({ signature }) => assessExcursion(st.id, x.logbook_entry_id, { decision: v.decision, justification: v.justification, signature }) });
      if (done) { toast('Assessment recorded.'); reload(); }
    };
    return [
      { field: 'entry_code', title: 'Entry', type: 'link', width: 105, href: (x) => '#/logbooks/entries/' + x.logbook_entry_id },
      { field: 'equipment_code', title: 'Chamber', type: 'link', width: 210, href: (x) => '#/equipment/' + x.equipment_id, compute: (x) => `${x.equipment_code} ${x.equipment_name}` },
      { field: 'storage_code', title: 'Material', type: 'readonly', width: 110 },
      { field: 'entry_at', title: 'When', type: 'readonly', width: 150, format: dt },
      { field: 'problems', title: 'Reading', type: 'readonly', width: 220, compute: (x) => [...(x.problems || []), x.failure_reason ? `(${x.failure_reason})` : ''].filter(Boolean).join(' ') },
      { field: 'window_end', title: 'Back in range', type: 'readonly', width: 150, format: (v) => (v ? dt(v) : 'not yet') },
      { field: 'decision', title: 'Assessment', type: 'readonly', width: 170, compute: (x) => x.decision || 'Not assessed', cellClass: (x) => (!x.decision ? 'tbfail' : x.decision === 'No impact' ? 'tbpass' : 'tbwait') },
      { field: 'assess', title: '', type: 'button', width: 100, label: () => (d.can_assess ? (open ? 'Assess…' : 'Reassess…') : ''), onClick: (x) => d.can_assess && assess(x) },
      { field: 'justification', title: 'Justification', type: 'readonly', width: 260 },
      { field: 'assessed_by_name', title: 'Assessed by', type: 'readonly', width: 170, compute: (x) => (x.assessed_by_name ? `${x.assessed_by_name}, ${d8(x.assessed_at)}` : '') },
      { field: 'affected_pulls', title: 'Pulls of the exposed material', type: 'readonly', width: 240 },
    ];
  }, [d, st, open, dialogs, toast, reload]);
  if (!d.excursions.length) return null;
  return (
    <Section title="Chamber excursions" help={<>Readings outside the chamber&apos;s condition while this study&apos;s material was in it (from the Temperature log). QA assesses each for this study: No impact, Impact (the results of the exposed material are flagged E on the reports) or Client to decide. {open ? <><b>{open} not assessed yet</b>: no report can be issued until they are.</> : 'All assessed.'}</>}>
      <div id="excur"><ReadGrid rows={rows} columns={columns} keyField="key" rowClass={(x) => (x.assessment_id ? '' : 'tbnc')} /></div>
    </Section>
  );
}

// The issued cumulative reports: after each pull's results are finalized; Final once every pull is done
const REPORT_COLS = [
  { field: 'report_code', title: 'Report (PDF)', type: 'link', width: 150, href: () => '#', onClick: (r) => window.open(reportPdfUrl(r.id), '_blank') },
  { field: 'kind', title: 'Kind', type: 'readonly', width: 120, compute: (r) => (r.is_final ? 'Final' : `Interim (v${r.version_no})`), cellClass: (r) => (r.is_final ? 'tbpass' : '') },
  { field: 'issued_at', title: 'Issued', type: 'readonly', width: 160, format: dt },
  { field: 'issued_by_name', title: 'Signed by', type: 'readonly', width: 180 },
];
function ReportsCard({ d, reload }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const s = d.study;
  const blocks = d.report_problems.filter((x) => x.severity === 'Block');
  const issue = async () => {
    const info = d.report_problems.filter((x) => x.severity !== 'Block').map((x) => x.problem).join(' ');
    const done = await dialogs.sign({ what: `Stability report for ${s.study_code}. ${info}`, meaning: 'Issued by', okText: 'Issue and send',
      submit: ({ reason, signature }) => issueReport(s.id, { reason, signature }) });
    if (done) { toast(`${done.report_code} issued${done.is_final ? ' (Final)' : ''} and sent to the client (Outbox).`); reload(); }
  };
  return (
    <Section className="stb-rep" title="Issued reports" help="The cumulative report the client is sent: finalized results only, timepoint by timepoint, with the excursions and their assessment and the amendments. Issue one after each pull's results are finalized (Report Finalization); the one issued when every pull is done and finalized is marked Final. Signed like a COA (your handwritten signature and title on file) and emailed to the client's report contacts.">
      <div id="reports">
        <div className="stb-bar">
          {s.status !== 'Awaiting material' && <Button variant="light" href={previewPdfUrl(s.id)} {...ext}>Preview the next report</Button>}
          {d.can_report ? <Button type="button" variant="primary" id="issue" disabled={blocks.length > 0} onClick={issue}>Issue report…</Button> : <span className="help">reports.finalize is needed to issue reports.</span>}
        </div>
        <ul className="stb-probs">{d.report_problems.map((x, i) => <li key={i} className={x.severity}>{x.problem}</li>)}</ul>
        <ReadGrid rows={d.reports} columns={REPORT_COLS} emptyText="No report issued yet." />
      </div>
    </Section>
  );
}

// Placing the material (or an amendment's new condition) in racks of chambers set to each condition
function PlaceCard({ d, reload }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const s = d.study;
  const adding = s.status !== 'Awaiting material';
  const today = iso(d.today);
  const [date, setDate] = useState(today);
  const [t0, setT0] = useState(String(d.t0units || 1));
  const [busy, setBusy] = useState(false);
  const { rows, columns } = useMemo(() => {
    const rackOpts = (cid) => d.racks.filter((r) => r.condition_id === cid && r.admin_status === 'In Service').map((r) => ({ value: r.id, label: `${r.equipment_name} · rack ${r.rack_code}` }));
    return {
      rows: d.need.map((n) => ({ condition_id: n.condition_id, condition: n.condition_name, need: n.with_reserve, rack_id: (rackOpts(n.condition_id)[0] || {}).value || '', position: '', units: n.with_reserve })),
      columns: [
        { field: 'condition', title: 'Condition', type: 'readonly', width: 150 },
        { field: 'need', title: 'Needed (with reserve)', type: 'readonly', width: 150 },
        { field: 'rack_id', title: 'Chamber and rack', type: 'select', width: 300, options: (r) => rackOpts(r.condition_id) },
        { field: 'position', title: 'Position (shelf / slot)', width: 170 },
        { field: 'units', title: 'Units placed', type: 'int', width: 100 },
      ],
    };
  }, [d]);
  const grid = useGrid({ rows, columns, keyField: 'condition_id', readOnly: !d.can_manage });

  const go = async () => {
    if (busy) return;
    if (grid.errorCount) { toast('Fix the cells marked in red first.', 'err'); return; }
    const all = grid.state.rows;
    const short = all.filter((r) => Number(r.units) < Number(r.need));
    const reason = await dialogs.reason(`placing ${s.study_code} in the chambers${short.length ? ` (${short.map((r) => r.condition).join(', ')} short of material)` : ''}`);
    if (reason === null) return;
    setBusy(true);
    try {
      const out = await placeStudy(s.id, { reason, placement_date: date, t0_units: adding ? '' : t0,
        rows: all.map((r) => ({ condition_id: r.condition_id, rack_id: r.rack_id, position: r.position, units: Number(r.units) })) });
      toast(adding ? `Placed: ${out.pulls} pull(s) scheduled.` : `Placed: ${out.pulls} pulls scheduled; the T0 sample is logged in.`);
      reload();
    } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  const goBtn = d.can_manage ? <Button type="button" variant="primary" id="pl_go" disabled={busy} onClick={go}>Place in chambers</Button> : <span className="help">stability.manage is needed to place material.</span>;
  return adding
    ? <Section title="Place the new condition's material" help={`An amendment added ${d.need.map((n) => n.condition_name).join(', ')}. Put its material in a rack of a chamber set to that condition: its pulls are scheduled from this date (no T0: the baseline was tested when the study started).`}>
      <div id="place">
        <div className="stb-bar"><label>Placement date <Form.Control type="date" id="pl_date" value={date} max={today} min={iso(s.placement_date)} onChange={(e) => setDate(e.target.value)} /></label>{goBtn}</div>
        <DataGrid grid={grid} />
      </div>
    </Section>
    : <Section title="Place the material in the chambers" help={`When the client's material arrives: put each condition's share in a rack of a chamber set to that condition. This logs in the T0 sample (if intake has not), checks the material is enough (every pull plus the ${Number(s.reserve_pct)}% reserve) and schedules the pulls from the placement date.`}>
      <div id="place">
        <div className="stb-bar"><label>Placement date <Form.Control type="date" id="pl_date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Units for T0 testing <Form.Control type="number" id="pl_t0" value={t0} min="1" style={{ width: 80 }} onChange={(e) => setT0(e.target.value)} /></label>{goBtn}</div>
        <DataGrid grid={grid} />
      </div>
    </Section>;
}
