// Report Finalization (#/reports/finalization): five tabs. The queue (everything waiting, with who holds it), the
// person's own worklist (what they claimed), the groups in progress (claims, FB-...), the issued COAs (the archive)
// and the stability reports to issue.
import { useCallback, useMemo, useRef, useState } from 'react';
import { claimTests, coaPdfUrl, finalizationQueue, listIssued, releaseClaim, stabilityReportsDue, verifyUrl } from '../../api/reports.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { plural } from '../../lib/format.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { d8, dt, Failed, Loading, SelectGrid, startReview } from './shared.jsx';

const TABS = [['queue', 'Report Finalization Queue'], ['mine', 'Finalization worklist'], ['batches', 'Batched Finalization'], ['issued', 'Issued COAs'], ['stability', 'Stability reports']];
const INTRO = {
  queue: 'Sample tests whose results QC Review approved. Claim the ones you will finalize (they move to your worklist and nobody else can finalize them), or review them straight away. Red rows are overdue, amber rows are due within a day; OOS results link to their investigation.',
  mine: 'The sample tests you claimed. Select some (or none for all), review each COA as the PDF the client will receive, then sign once for the group: each COA is signed and issued separately. Release what you will not finish so others can take it.',
  batches: 'Groups of sample tests being finalized, and who holds each. Only the holder finalizes them; the holder releases them, or a lab administrator takes them back with a reason.',
  issued: 'Every COA version issued at this lab, newest first: the archive of what was finalized and sent.',
  stability: 'The cumulative stability reports: a study is ready when a pull\'s results were finalized since its last report and every chamber excursion is assessed by QA. Open the study to preview and issue its report (signed, with the same independence rules as a COA).',
};

const urgent = (r) => (r.overdue ? 'rfover' : r.due_soon ? 'rfsoon' : '');
const COLUMNS = [
  { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => '#/samples/' + r.sample_id },
  { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 115 },
  { field: 'client_name', title: 'Client', type: 'link', width: 160, href: (r) => '#/clients/' + r.client_id },
  { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
  { field: 'test_name', title: 'Test', type: 'readonly', width: 210 },
  { field: 'due_date', title: 'Due', type: 'readonly', width: 120, format: (v, r) => (v ? d8(v) + (r.overdue ? ' (overdue)' : r.due_soon ? ' (due soon)' : '') : '') },
  { field: 'rush', title: 'Rush', type: 'readonly', width: 55, format: (v) => (v ? 'Rush' : ''), cellClass: (r) => (r.rush ? 'rfrush' : '') },
  { field: 'oos_codes', title: 'OOS', type: 'link', width: 120, compute: (r) => r.oos_codes || (r.oos_problem ? 'OOS (none opened)' : ''),
    href: (r) => (r.oos_id ? '#/oos/' + r.oos_id : r.oos_problem ? '#/samples/' + r.sample_id : null), cellClass: (r) => (r.oos_codes || r.oos_problem ? 'rfoos' : '') },
  { field: 'claimed_by_name', title: 'Held by', type: 'readonly', width: 170, compute: (r) => (r.claim_code ? `${r.mine ? 'You' : r.claimed_by_name} (${r.claim_code})` : '') },
  { field: 'approved_at', title: 'Approved (QC Review)', type: 'readonly', width: 145, format: dt },
  { field: 'reviewed_by', title: 'Reviewed by', type: 'readonly', width: 130 },
  { field: 'flags', title: 'Notes', type: 'readonly', width: 330, compute: (r) => [r.is_gmp ? 'GMP (QA finalizes)' : '', r.compliance_category || '', r.refinalize ? 'Changed since finalized' : '',
    r.is_retest ? 'Retest' : '', r.oos_problem ? 'Held: ' + r.oos_problem : '', r.other_tests_in_lab ? `${r.other_tests_in_lab} other test${r.other_tests_in_lab > 1 ? 's' : ''} still in the lab` : '', r.account_status === 'On Hold' ? 'Client On Hold' : ''].filter(Boolean).join(' · ') },
];
const MINE_COLUMNS = COLUMNS.filter((c) => c.field !== 'claimed_by_name');
const queueRow = (r) => [r.oos_problem ? 'tbnc' : urgent(r), r.claim_id && !r.mine ? 'rftaken' : ''].join(' ');

const FILTERS = { all: ['All', () => true], open: ['Not claimed', (r) => !r.claim_id], urgent: ['Overdue or due soon', (r) => r.overdue || r.due_soon], rush: ['Rush', (r) => r.rush],
  oos: ['OOS', (r) => r.oos_codes || r.oos_problem], gmp: ['GMP', (r) => r.is_gmp] };
let lastFilter = 'all'; // the queue's filter stays while the person moves around, as in the current app

// a set of queue rows grouped by sample, ready for the review
function reviewRows(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.sample_id)) by.set(r.sample_id, { sample_id: r.sample_id, sample_code: r.sample_code, client_sample_id: r.client_sample_id, tests: [], test_names: [] });
    const it = by.get(r.sample_id); if (!it.tests.includes(r.requested_test_id)) { it.tests.push(r.requested_test_id); it.test_names.push(r.test_name); }
  }
  return [...by.values()];
}

export default function QueuePage({ query }) {
  const t = new URLSearchParams(query).get('tab');
  const tab = TABS.some(([k]) => k === t) ? t : 'queue';
  const { data: d, error, reload } = useApi(() => finalizationQueue(), [tab]);
  const mine = useMemo(() => (d ? d.rows.filter((r) => r.mine) : []), [d]);
  const count = d ? { queue: d.rows.length, mine: mine.length, batches: d.claims.length } : {};
  return <>
    <PageHeader title="Report Finalization" subtitle={INTRO[tab]} audit={{ kind: 'finalization' }} />
    <div className="rftabs">{TABS.map(([k, l]) => <a key={k} href={`#/reports/finalization?tab=${k}`} className={k === tab ? 'on' : ''}>{l}{count[k] !== undefined && <> <small>{count[k]}</small></>}</a>)}</div>
    {error && !d ? <Failed error={error} /> : !d ? <Loading /> : <>
      {!d.can_finalize && <div className="notice">You need the &quot;Report Finalization&quot; permission (reports.finalize) in this lab to finalize. Project Managers and QA hold it.</div>}
      {tab === 'issued' ? <IssuedTab query={query} />
        : tab === 'stability' ? <StabilityTab />
          : tab === 'batches' ? <BatchesTab d={d} reload={reload} />
            : tab === 'mine' ? <MineTab mine={mine} reload={reload} />
              : <QueueTab d={d} />}
    </>}
  </>;
}

function QueueTab({ d }) {
  const toast = useToast();
  const gridRef = useRef(null);
  const [filter, setFilterState] = useState(() => (FILTERS[lastFilter] ? lastFilter : 'all'));
  const setFilter = (k) => { lastFilter = k; setFilterState(k); };
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => d.rows.filter(FILTERS[filter][1]), [d, filter]);
  const dueCols = useMemo(() => [
    { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => '#/samples/' + r.sample_id },
    { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
    { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
    { field: 'last_version', title: 'Last issued', type: 'readonly', width: 150, compute: (r) => `${r.sample_code}-R${r.last_version}` },
    { field: 'decisions', title: 'Client decision', type: 'readonly', width: 260 },
    { field: 'go', title: '', type: 'button', width: 140, label: () => (d.can_finalize ? 'Issue final COA…' : ''),
      onClick: (r) => { if (d.can_finalize) startReview([{ sample_id: r.sample_id, sample_code: r.sample_code, client_sample_id: r.client_sample_id, tests: [], test_names: ['Final COA (no new result)'] }]); } },
  ], [d.can_finalize]);

  async function claim() {
    const s = gridRef.current.selectedRows();
    if (!s.length) { toast('Select the sample tests to claim (Ctrl+click or Shift+click for several).', 'err'); return; }
    const taken = s.filter((r) => r.claim_id); const free = s.filter((r) => !r.claim_id);
    if (!free.length) { toast('Those are already held by someone.', 'err'); return; }
    setBusy(true);
    try {
      const x = await claimTests([...new Set(free.map((r) => r.requested_test_id))]);
      toast(`${x.claim_code}: ${plural(free.length, 'sample test')} claimed${taken.length ? ` (${taken.length} already held were skipped)` : ''}. They are on your Finalization worklist.`);
      window.location.hash = '#/reports/finalization?tab=mine';
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  }
  function reviewNow() {
    const s = gridRef.current.selectedRows(); const others = s.filter((r) => r.claim_id && !r.mine);
    if (others.length) { toast(`Held by someone else: ${[...new Set(others.map((r) => r.sample_code))].join(', ')}. Leave them out.`, 'err'); return; }
    if (!s.length) { toast('Select the sample tests to finalize first.', 'err'); return; }
    startReview(reviewRows(s));
  }

  return <>
    {d.final_due.length > 0 && <Section title="Final COA due" help="The client decided on a confirmed OOS (no Phase II retest): issue the final COA. It is a new version with the same results, marked final.">
      <ReadGrid rows={d.final_due} columns={dueCols} />
    </Section>}
    <Section title="Waiting for finalization" actions={<>
      <button type="button" className="btn primary" disabled={!d.can_finalize || busy} onClick={claim}>Claim selected</button>{' '}
      <button type="button" className="btn" disabled={!d.can_finalize} onClick={reviewNow}>Review selected now</button></>}>
      <div className="rffil">Show: {Object.entries(FILTERS).map(([k, [l, fn]]) => (
        <button key={k} type="button" data-f={k} className={k === filter ? 'on' : ''} onClick={() => setFilter(k)}>{l} <small>{d.rows.filter(fn).length}</small></button>))}</div>
      <SelectGrid gridRef={gridRef} rows={rows} columns={COLUMNS} search emptyText="Nothing waits for finalization." rowClass={queueRow} />
    </Section>
  </>;
}

function MineTab({ mine, reload }) {
  const toast = useToast();
  const gridRef = useRef(null);
  const [busy, setBusy] = useState(false);
  function go() {
    const s = gridRef.current.selectedRows(); const rows = s.length ? s : mine;
    if (!rows.length) { toast('Select the sample tests to finalize first.', 'err'); return; }
    startReview(reviewRows(rows));
  }
  async function release() {
    const s = gridRef.current.selectedRows(); if (!s.length) { toast('Select the sample tests to release.', 'err'); return; }
    const byClaim = new Map(); s.forEach((r) => { if (!byClaim.has(r.claim_id)) byClaim.set(r.claim_id, []); byClaim.get(r.claim_id).push(r.requested_test_id); });
    setBusy(true);
    try { for (const [cid, tests] of byClaim) await releaseClaim(cid, { tests }); toast('Released: back in the queue for anyone.'); reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  }
  return <Section title="My worklist" actions={<>
    <button type="button" className="btn primary" disabled={!mine.length} onClick={go}>Review selected (or all)</button>{' '}
    <button type="button" className="btn" disabled={!mine.length || busy} onClick={release}>Release selected…</button></>}>
    <SelectGrid gridRef={gridRef} rows={mine} columns={MINE_COLUMNS} search rowClass={urgent}
      emptyText="You hold nothing. Claim sample tests on the Report Finalization Queue tab." />
  </Section>;
}

function BatchesTab({ d, reload }) {
  const toast = useToast();
  const dialogs = useDialogs();
  const columns = useMemo(() => [
    { field: 'claim_code', title: 'Group', type: 'readonly', width: 100 },
    { field: 'claimed_by_name', title: 'Held by', type: 'readonly', width: 170, format: (v, r) => (r.mine ? 'You' : v) },
    { field: 'created_at', title: 'Claimed', type: 'readonly', width: 145, format: dt },
    { field: 'open_tests', title: 'To finalize', type: 'readonly', width: 90 },
    { field: 'done_tests', title: 'Finalized', type: 'readonly', width: 80 },
    { field: 'samples', title: 'Samples', type: 'readonly', width: 380 },
    { field: 'note', title: 'Note', type: 'readonly', width: 160 },
    { field: 'open', title: '', type: 'button', width: 110, label: (r) => (r.mine ? 'My worklist' : ''), onClick: (r) => { if (r.mine) window.location.hash = '#/reports/finalization?tab=mine'; } },
    { field: 'rel', title: '', type: 'button', width: 130, label: (r) => (r.mine ? 'Release all' : d.can_take_over ? 'Take back…' : ''), onClick: async (r) => {
      if (!r.mine && !d.can_take_over) return;
      let reason = null;
      if (!r.mine) { reason = await dialogs.reason(`taking ${r.claim_code} back from ${r.claimed_by_name}`); if (reason === null) return; }
      try { await releaseClaim(r.id, { reason }); toast(`${r.claim_code} released: its tests are back in the queue.`); reload(); } catch (e) { toast(e.message, 'err'); }
    } },
  ], [d.can_take_over, dialogs, toast, reload]);
  return <div className="card"><ReadGrid rows={d.claims} columns={columns} emptyText="No group is being finalized." /></div>;
}

const ISSUED_FILTERS = [['all', 'All'], ['final', 'Final'], ['interim', 'Not final']];
function IssuedTab({ query }) {
  const { site } = useSession();
  const siteId = site?.id;
  const openPdf = useCallback((v) => window.open(coaPdfUrl(v.id, siteId), '_blank'), [siteId]);
  const columns = useMemo(() => [
    { field: 'report_id', title: 'Report', type: 'link', width: 165, href: () => '#', onClick: openPdf },
    { field: 'version_no', title: 'Version', type: 'readonly', width: 65 },
    { field: 'is_final', title: 'Final', type: 'readonly', width: 55, format: (v) => (v ? 'Yes' : '') },
    { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (v) => '#/samples/' + v.sample_id },
    { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 120 },
    { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (v) => '#/clients/' + v.client_id },
    { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (v) => '#/orders/' + v.lab_order_id },
    { field: 'issued_at', title: 'Issued', type: 'readonly', width: 145, format: dt },
    { field: 'issued_by_name', title: 'Finalized by', type: 'readonly', width: 145 },
    { field: 'group_code', title: 'Group', type: 'readonly', width: 85 },
    { field: 'emails', title: 'Emailed', type: 'link', width: 75, format: (v) => (v ? 'Outbox' : 'No'), href: (v) => (v.emails ? '#/outbox?find=' + encodeURIComponent(v.sample_code) : null) },
    { field: 'verify_code', title: 'Verification code', type: 'link', width: 145, href: () => '#', onClick: (v) => window.open(verifyUrl(v.verify_code), '_blank') },
  ], [openPdf]);
  const load = useCallback((params, opts) => listIssued(params, opts), []);
  return <div className="card">
    <PagedList load={load} query={query} filters={ISSUED_FILTERS} filterParam="f" open={openPdf}
      placeholder="Search by report, sample, client sample ID, order, client or verification code; scan or type one and press Enter to open the report">
      {(rows) => <ReadGrid rows={rows} columns={columns} emptyText="No COA here." />}
    </PagedList>
  </div>;
}

const STAB_COLS = [
  { field: 'study_code', title: 'Study', type: 'link', width: 105, href: (r) => '#/stability/studies/' + r.id },
  { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
  { field: 'product', title: 'Product', type: 'readonly', width: 210 },
  { field: 'status', title: 'Status', type: 'readonly', width: 95 },
  { field: 'pulls', title: 'Pulls taken', type: 'readonly', width: 90, compute: (r) => `${r.pulls_done} of ${r.pulls_total}` },
  { field: 'finalized', title: 'Finalized results', type: 'readonly', width: 115 },
  { field: 'ready', title: 'Report', type: 'readonly', width: 260, compute: (r) => (r.blocked ? 'Not now' : r.next_report || 'Ready'), cellClass: (r) => (r.blocked ? '' : 'tbpass') },
  { field: 'blocked', title: 'Why not now', type: 'readonly', width: 380 },
  { field: 'last_report_code', title: 'Last issued', type: 'readonly', width: 130 },
  { field: 'last_report_at', title: 'On', type: 'readonly', width: 140, format: dt },
];
const blockedRow = (r) => (r.blocked ? 'mutedrow' : '');
function StabilityTab() {
  const { data, error } = useApi(() => stabilityReportsDue(), []);
  return <div className="card">{error && !data ? <Failed error={error} /> : !data ? <Loading />
    : <ReadGrid rows={data.rows} columns={STAB_COLS} search rowClass={blockedRow} emptyText="No placed stability study at this lab." />}</div>;
}
