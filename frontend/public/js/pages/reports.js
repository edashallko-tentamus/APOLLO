// Result Finalization and the COA (R-1, migration 026). The queue of approved sample tests; the review of a group of
// COAs one at a time (the PDF in the middle, the sample's history on the left, the release check and notes on the
// right), then one signing act that issues each COA; the COA card on the sample page; the email templates (Outbox).
import { api, esc, pageHeader, toast, modal, badge, link, signDialog, state, can, askReason } from '../app.js';
import { Grid } from '../grid.js';
import { section, editableGrid, pagedList } from './common.js';

const css = document.createElement('style');
css.textContent = `
.fz { display: grid; grid-template-columns: 230px minmax(480px, 1fr) 290px; gap: 10px; align-items: start; }
.fz .card { margin: 0 0 12px; } .fz h2 { font-size: 14px; margin: 0 0 8px; }
.fz .hist dl { display: grid; grid-template-columns: 112px 1fr; gap: 2px 8px; margin: 0; font-size: 12.5px; } .fz .hist dt { color: var(--muted); } .fz .hist dd { margin: 0; }
.fz .hist ul { margin: 4px 0 0; padding-left: 16px; font-size: 12.5px; } .fz .hist li { margin: 2px 0; }
.fz .pdf { width: 100%; height: calc(100vh - 150px); min-height: 640px; border: 1px solid var(--line); border-radius: 6px; background: #f4f6f7; }
.fz .card { padding: 10px 12px; } .fz .chk .lk { display: block; margin-top: 4px; font-weight: 600; }
.rftabs { display: flex; gap: 6px; flex-wrap: wrap; margin: -4px 0 12px; }
.rftabs a { text-decoration: none; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 6px 12px; border-radius: 7px; font-size: 13.5px; }
.rftabs a.on { background: var(--green-700); border-color: var(--green-700); color: #fff; } .rftabs small { opacity: .8; margin-left: 3px; }
.rffil { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 0 0 8px; font-size: 13px; }
.rffil button { border: 1px solid var(--line); background: #fff; border-radius: 14px; padding: 3px 10px; cursor: pointer; font-size: 12.5px; } .rffil button.on { border-color: var(--green-700); background: var(--green-50); font-weight: 700; }
tr.rfover td { background: #fdecec; } tr.rfsoon td { background: #fff4d6; } tr.rftaken td { color: #8a949c; }
td.rfrush { font-weight: 700; color: #b42318; } td.rfoos a { font-weight: 700; color: #b42318; }
.fz .chk { border-left: 4px solid #cfd6da; padding: 6px 8px; margin: 0 0 6px; background: #fafbfc; border-radius: 4px; font-size: 12.5px; }
.fz .chk.Pass { border-color: #2e8b57; } .fz .chk.Block { border-color: #b42318; background: #fdecec; } .fz .chk.Warning { border-color: #c68a00; background: #fff8e6; } .fz .chk.Info { border-color: #6b7c93; }
.fz .chk b { display: block; } .fz .chk .lv { float: right; font-weight: 700; font-size: 11px; text-transform: uppercase; }
.fz .chk textarea { width: 100%; margin-top: 5px; font-size: 12.5px; }
.fz .note { font-size: 12.5px; padding: 5px 6px; border-bottom: 1px solid #eef1f3; } .fz .note .k { color: var(--muted); font-size: 11.5px; } .fz .note button { float: right; }
.fzbar { position: sticky; bottom: 0; background: #fff; border-top: 1px solid var(--line); padding: 10px 0; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; z-index: 5; }
.fzchips { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 10px; } .fzchips button { border: 1px solid var(--line); background: #fff; border-radius: 14px; padding: 3px 10px; cursor: pointer; font-size: 12.5px; }
.fzchips button.on { border-color: var(--green-700); font-weight: 700; } .fzchips button.ready { background: var(--green-50); } .fzchips button.blocked { background: #fdecec; }
@media (max-width: 1300px) { .fz { grid-template-columns: 260px 1fr; } .fz .side { grid-column: 1 / -1; } }
`;
document.head.appendChild(css);

const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const d8 = (v) => (v ? new Date(v).toLocaleDateString([], { dateStyle: 'medium' }) : '');
const sq = () => '?s=' + encodeURIComponent(state.site || '');

// ---------------------------------------------------------------- the queue
let session = null; // { items: [{ sample_id, sample_code, client_sample_id, tests, test_names }], i, ready, acks, data }
// Alex (2026-10-14, migration 028): four tabs. The queue (everything waiting, with who holds it), the person's own
// worklist (what they claimed), the groups in progress (claims, FB-...), and the issued COAs (the archive).
const TABS = [['queue', 'Report Finalization Queue'], ['mine', 'Finalization worklist'], ['batches', 'Batched Finalization'], ['issued', 'Issued COAs'], ['stability', 'Stability reports']];
let queueFilter = 'all';
const noteLast = { kind: '', on: '' };
export async function queue(main) {
  const tab = TABS.some(([k]) => k === state.query?.get('tab')) ? state.query.get('tab') : 'queue';
  const d = await api('/reports/queue');
  const mine = d.rows.filter((r) => r.mine);
  const count = { queue: d.rows.length, mine: mine.length, batches: d.claims.length, issued: '', stability: '' };
  const intro = {
    queue: 'Sample tests whose results QC Review approved. Claim the ones you will finalize (they move to your worklist and nobody else can finalize them), or review them straight away. Red rows are overdue, amber rows are due within a day; OOS results link to their investigation.',
    mine: 'The sample tests you claimed. Select some (or none for all), review each COA as the PDF the client will receive, then sign once for the group: each COA is signed and issued separately. Release what you will not finish so others can take it.',
    batches: 'Groups of sample tests being finalized, and who holds each. Only the holder finalizes them; the holder releases them, or a lab administrator takes them back with a reason.',
    issued: 'Every COA version issued at this lab, newest first: the archive of what was finalized and sent.',
    stability: 'The cumulative stability reports: a study is ready when a pull\'s results were finalized since its last report and every chamber excursion is assessed by QA. Open the study to preview and issue its report (signed, with the same independence rules as a COA).' }[tab];
  main.innerHTML = pageHeader('Report Finalization', intro, '', { kind: 'finalization' })
    + `<div class="rftabs">${TABS.map(([k, l]) => `<a href="#/reports/finalization?tab=${k}" class="${k === tab ? 'on' : ''}">${esc(l)}${count[k] !== '' ? ` <small>${count[k]}</small>` : ''}</a>`).join('')}</div>`
    + (d.can_finalize ? '' : '<div class="card warn">You need the "Report Finalization" permission (reports.finalize) in this lab to finalize. Project Managers and QA hold it.</div>')
    + '<div id="body"></div>';
  const body = main.querySelector('#body');
  if (tab === 'issued') return issuedTab(body);
  if (tab === 'stability') return stabilityTab(body);
  if (tab === 'batches') return batchesTab(body, d, main);
  const urgent = (r) => (r.overdue ? 'rfover' : r.due_soon ? 'rfsoon' : '');
  const columns = [
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
  if (tab === 'mine') {
    body.innerHTML = `<div class="card">${section('My worklist', '', `<button class="btn primary" id="go" ${mine.length ? '' : 'disabled'}>Review selected (or all)</button> <button class="btn" id="rel" ${mine.length ? '' : 'disabled'}>Release selected…</button>`)}<div id="g"></div></div>`;
    const g = new Grid(body.querySelector('#g'), { readOnly: true, search: true, rows: mine, emptyText: 'You hold nothing. Claim sample tests on the Report Finalization Queue tab.',
      rowClass: urgent, columns: columns.filter((c) => c.field !== 'claimed_by_name') });
    body.querySelector('#go').onclick = () => { const s = g.selectedRows(); start(s.length ? s : mine); };
    body.querySelector('#rel').onclick = async () => {
      const s = g.selectedRows(); if (!s.length) { toast('Select the sample tests to release.', 'err'); return; }
      const byClaim = new Map(); s.forEach((r) => { if (!byClaim.has(r.claim_id)) byClaim.set(r.claim_id, []); byClaim.get(r.claim_id).push(r.requested_test_id); });
      try { for (const [cid, tests] of byClaim) await api(`/reports/claims/${cid}/release`, { method: 'POST', body: { tests } }); toast('Released: back in the queue for anyone.'); queue(main); } catch (e) { toast(e.message, 'err'); }
    };
    return;
  }
  // the queue: final COAs due after an OOS decision, then everything waiting
  const FILTERS = { all: ['All', () => true], open: ['Not claimed', (r) => !r.claim_id], urgent: ['Overdue or due soon', (r) => r.overdue || r.due_soon], rush: ['Rush', (r) => r.rush],
    oos: ['OOS', (r) => r.oos_codes || r.oos_problem], gmp: ['GMP', (r) => r.is_gmp] };
  if (!FILTERS[queueFilter]) queueFilter = 'all';
  body.innerHTML = (d.final_due.length ? `<div class="card">${section('Final COA due', 'The client decided on a confirmed OOS (no Phase II retest): issue the final COA. It is a new version with the same results, marked final.')}<div id="fdg"></div></div>` : '')
    + `<div class="card">${section('Waiting for finalization', '', `<button class="btn primary" id="claim" ${d.can_finalize ? '' : 'disabled'}>Claim selected</button> <button class="btn" id="go" ${d.can_finalize ? '' : 'disabled'}>Review selected now</button>`)}
      <div class="rffil">Show: ${Object.entries(FILTERS).map(([k, [l, fn]]) => `<button data-f="${k}" class="${k === queueFilter ? 'on' : ''}">${esc(l)} <small>${d.rows.filter(fn).length}</small></button>`).join('')}</div><div id="g"></div></div>`;
  if (d.final_due.length) new Grid(body.querySelector('#fdg'), { readOnly: true, rows: d.final_due, columns: [
    { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => '#/samples/' + r.sample_id },
    { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
    { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
    { field: 'last_version', title: 'Last issued', type: 'readonly', width: 150, compute: (r) => `${r.sample_code}-R${r.last_version}` },
    { field: 'decisions', title: 'Client decision', type: 'readonly', width: 260 },
    { field: 'go', title: '', type: 'button', width: 140, label: () => (d.can_finalize ? 'Issue final COA…' : ''),
      onClick: (r) => { session = { items: [{ sample_id: r.sample_id, sample_code: r.sample_code, client_sample_id: r.client_sample_id, tests: [], test_names: ['Final COA (no new result)'] }], i: 0, ready: {}, acks: {}, data: {} }; location.hash = '#/reports/review'; } }] });
  const g = new Grid(body.querySelector('#g'), { readOnly: true, search: true, rows: d.rows.filter(FILTERS[queueFilter][1]), emptyText: 'Nothing waits for finalization.',
    rowClass: (r) => [r.oos_problem ? 'tbnc' : urgent(r), r.claim_id && !r.mine ? 'rftaken' : ''].join(' '), columns });
  body.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { queueFilter = b.dataset.f; queue(main); }; });
  body.querySelector('#claim').onclick = async () => {
    const s = g.selectedRows(); if (!s.length) { toast('Select the sample tests to claim (Ctrl+click or Shift+click for several).', 'err'); return; }
    const taken = s.filter((r) => r.claim_id); const free = s.filter((r) => !r.claim_id);
    if (!free.length) { toast('Those are already held by someone.', 'err'); return; }
    try {
      const x = await api('/reports/claim', { method: 'POST', body: { tests: [...new Set(free.map((r) => r.requested_test_id))] } });
      toast(`${x.claim_code}: ${free.length} sample test${free.length === 1 ? '' : 's'} claimed${taken.length ? ` (${taken.length} already held were skipped)` : ''}. They are on your Finalization worklist.`);
      location.hash = '#/reports/finalization?tab=mine';
    } catch (e) { toast(e.message, 'err'); }
  };
  body.querySelector('#go').onclick = () => {
    const s = g.selectedRows(); const others = s.filter((r) => r.claim_id && !r.mine);
    if (others.length) { toast(`Held by someone else: ${[...new Set(others.map((r) => r.sample_code))].join(', ')}. Leave them out.`, 'err'); return; }
    start(s);
  };
}
function start(rows) {
  if (!rows.length) { toast('Select the sample tests to finalize first.', 'err'); return; }
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.sample_id)) by.set(r.sample_id, { sample_id: r.sample_id, sample_code: r.sample_code, client_sample_id: r.client_sample_id, tests: [], test_names: [] });
    const it = by.get(r.sample_id); if (!it.tests.includes(r.requested_test_id)) { it.tests.push(r.requested_test_id); it.test_names.push(r.test_name); }
  }
  session = { items: [...by.values()], i: 0, ready: {}, acks: {}, data: {} };
  location.hash = '#/reports/review';
}
// groups in progress (claims)
function batchesTab(body, d, main) {
  body.innerHTML = `<div class="card"><div id="g"></div></div>`;
  new Grid(body.querySelector('#g'), { readOnly: true, rows: d.claims, emptyText: 'No group is being finalized.', columns: [
    { field: 'claim_code', title: 'Group', type: 'readonly', width: 100 },
    { field: 'claimed_by_name', title: 'Held by', type: 'readonly', width: 170, format: (v, r) => (r.mine ? 'You' : v) },
    { field: 'created_at', title: 'Claimed', type: 'readonly', width: 145, format: dt },
    { field: 'open_tests', title: 'To finalize', type: 'readonly', width: 90 },
    { field: 'done_tests', title: 'Finalized', type: 'readonly', width: 80 },
    { field: 'samples', title: 'Samples', type: 'readonly', width: 380 },
    { field: 'note', title: 'Note', type: 'readonly', width: 160 },
    { field: 'open', title: '', type: 'button', width: 110, label: (r) => (r.mine ? 'My worklist' : ''), onClick: () => { location.hash = '#/reports/finalization?tab=mine'; } },
    { field: 'rel', title: '', type: 'button', width: 130, label: (r) => (r.mine ? 'Release all' : d.can_take_over ? 'Take back…' : ''), onClick: async (r) => {
      let reason = null;
      if (!r.mine) { reason = await askReason(`taking ${r.claim_code} back from ${r.claimed_by_name}`); if (reason === null) return; }
      try { await api(`/reports/claims/${r.id}/release`, { method: 'POST', body: { reason } }); toast(`${r.claim_code} released: its tests are back in the queue.`); queue(main); } catch (e) { toast(e.message, 'err'); }
    } }] });
}
// the archive: issued COAs
let issuedDays = 90;
async function issuedTab(body) {
  body.innerHTML = '<div class="card"><div id="g"></div></div>';
  // one page at a time from the server (0.35.0), newest first; a report ID, sample ID or verification code opens the PDF
  pagedList({ el: body.querySelector('#g'), url: '/reports/issued', filterParam: 'f', filter: state.query.get('f') || 'all', q: state.query.get('find') || '',
    filters: [['all', 'All'], ['final', 'Final'], ['interim', 'Not final']],
    placeholder: 'Search by report, sample, client sample ID, order, client or verification code; scan or type one and press Enter to open the report',
    open: (v) => { window.open(`/api/reports/coa/${v.id}/pdf${sq()}`, '_blank'); },
    render: (el, rows) => new Grid(el, { readOnly: true, rows, emptyText: 'No COA here.', columns: [
    { field: 'report_id', title: 'Report', type: 'link', width: 165, onClick: (v) => window.open(`/api/reports/coa/${v.id}/pdf${sq()}`, '_blank') },
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
    { field: 'verify_code', title: 'Verification code', type: 'link', width: 145, onClick: (v) => window.open(`/verify.html?c=${v.verify_code}`, '_blank') }] }) });
}

// Stability reports (S-2, migration 041): the studies with a cumulative report to issue
async function stabilityTab(body) {
  body.innerHTML = '<div class="card"><div id="g"></div></div>';
  const x = await api('/stability/reports-due');
  new Grid(body.querySelector('#g'), { readOnly: true, search: true, rows: x.rows, emptyText: 'No placed stability study at this lab.',
    rowClass: (r) => (r.blocked ? 'mutedrow' : ''), columns: [
    { field: 'study_code', title: 'Study', type: 'link', width: 105, href: (r) => '#/stability/studies/' + r.id },
    { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
    { field: 'product', title: 'Product', type: 'readonly', width: 210 },
    { field: 'status', title: 'Status', type: 'readonly', width: 95 },
    { field: 'pulls', title: 'Pulls taken', type: 'readonly', width: 90, compute: (r) => `${r.pulls_done} of ${r.pulls_total}` },
    { field: 'finalized', title: 'Finalized results', type: 'readonly', width: 115 },
    { field: 'ready', title: 'Report', type: 'readonly', width: 260, compute: (r) => (r.blocked ? 'Not now' : r.next_report || 'Ready'), cellClass: (r) => (r.blocked ? '' : 'tbpass') },
    { field: 'blocked', title: 'Why not now', type: 'readonly', width: 380 },
    { field: 'last_report_code', title: 'Last issued', type: 'readonly', width: 130 },
    { field: 'last_report_at', title: 'On', type: 'readonly', width: 140, format: dt }] });
}

// ---------------------------------------------------------------- the review of a group, one COA at a time
export async function review(main) {
  if (!session || !session.items.length) { location.hash = '#/reports/finalization'; return; }
  const it = session.items[session.i];
  main.innerHTML = pageHeader(`Report Finalization: COA ${session.i + 1} of ${session.items.length}`, `${esc(it.sample_code)}${it.client_sample_id ? ' (' + esc(it.client_sample_id) + ')' : ''} · ${esc(it.test_names.join(', '))}`,
    `<a class="btn ghost" href="#/reports/finalization">Back to the queue</a>`, { kind: 'sample', id: it.sample_id }) + '<div class="card">Making the COA…</div>';
  let d;
  try { d = await api('/reports/preview', { method: 'POST', body: { sample_id: it.sample_id, tests: it.tests } }); } catch (e) { main.querySelector('.card:last-child').textContent = e.message; return; }
  session.data[it.sample_id] = d;
  const c = d.content; const x = d.context; const s = x.sample;
  const acks = session.acks[it.sample_id] || (session.acks[it.sample_id] = {});
  const blocks = d.checks.filter((k) => k.level === 'Block');
  const chips = session.items.map((y, k) => {
    const dd = session.data[y.sample_id]; const bl = dd && dd.checks.some((q) => q.level === 'Block');
    return `<button data-go="${k}" class="${k === session.i ? 'on' : ''} ${session.ready[y.sample_id] ? 'ready' : ''} ${bl ? 'blocked' : ''}">${session.ready[y.sample_id] ? '✓ ' : ''}${esc(y.sample_code)}</button>`;
  }).join('');
  const kv = (pairs) => `<dl>${pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const resultRows = c.tests.flatMap((t) => t.results.map((r) => ({ t, r })));
  main.innerHTML = pageHeader(`Report Finalization: COA ${session.i + 1} of ${session.items.length}`,
    `${link('#/samples/' + s.id, s.sample_code)}${s.client_sample_id ? ' (' + esc(s.client_sample_id) + ')' : ''} · ${link('#/clients/' + s.client_id, s.client_name)} · Report ${esc(c.report_id || c.coa_code)} · version ${c.version_no}${c.is_final ? ' (final)' : ''} ${c.is_gmp ? badge('GMP') : ''}`,
    `<a class="btn ghost" href="#/reports/finalization">Back to the queue</a>`, { kind: 'sample', id: s.id }) + `
  <div class="fzchips">${chips}</div>
  <div class="fz">
    <div class="hist">
      <div class="card"><h2>Submission</h2>${kv([['Order', link('#/orders/' + s.order_id, s.order_code)], ['PO', esc(s.po_number)], ['Channel', esc(s.channel)],
        ['Received', esc(dt(s.received_at || s.logged_at))], ['Logged', esc(`${dt(s.logged_at)}${s.logged_by_name ? ' by ' + s.logged_by_name : ''}`)], ['Category', esc(s.compliance_category || 'Not given')],
        ['Condition', esc(s.condition)], ['Temperature', s.receipt_temperature === null ? '' : esc(s.receipt_temperature + ' °C')], ['Lot', esc(s.lot)], ['Description', esc(s.description)],
        ['Client', `${esc(s.client_name)}${s.account_status !== 'Active' ? ' ' + badge(s.account_status) : ''}`], ['Partial reports', s.allow_partial_reports ? 'Yes' : 'No: one COA at the end']])}</div>
      <div class="card"><h2>Notes and comments</h2>${s.order_notes ? `<p class="help"><b>Order:</b> ${esc(s.order_notes)}</p>` : ''}
        ${x.tests.filter((t) => t.special_instructions).map((t) => `<p class="help"><b>${esc(t.test_name)}:</b> ${esc(t.special_instructions)}</p>`).join('')}
        ${x.notes.length ? x.notes.map((n) => `<div class="note"><span class="k">${n.kind === 'Internal' ? 'Internal' : 'On the COA'}${n.analyte ? ' · ' + esc(n.test_name + ' ' + n.analyte) : n.test_name ? ' · ' + esc(n.test_name) : ''} · ${esc(n.by_name)}</span><br>${esc(n.note_text)}</div>`).join('')
          : (!s.order_notes && !x.tests.some((t) => t.special_instructions) ? '<p class="help">None.</p>' : '')}</div>
      <div class="card"><h2>Attachments</h2>${x.attachments.length ? `<ul>${x.attachments.map((a) => `<li><a href="/api/attachments/${a.id}/file${sq()}" target="_blank" rel="noopener">${esc(a.label || a.file_name)}</a> <span class="help">${esc(a.kind)}${a.sample_id ? '' : ', whole order'}</span></li>`).join('')}</ul>` : '<p class="help">No attachments.</p>'}</div>
      <div class="card"><h2>History</h2><ul>
        ${x.batches.map((b) => `<li>${link('#/testing/batches/' + b.id, b.batch_code)} ${esc(b.test_name)} (${esc(b.status)})</li>`).join('')}
        ${x.changes.map((a) => `<li>${esc(dt(a.changed_at))} ${esc(a.full_name)}: ${esc(Object.keys(a.changed_fields || {}).filter((f) => !['record_version', 'modified_at', 'modified_by'].includes(f)).join(', ') || 'changed')}${a.reason ? ' (' + esc(a.reason) + ')' : ''}</li>`).join('')}
        ${x.versions.map((v) => `<li><a href="/api/reports/coa/${v.id}/pdf${sq()}" target="_blank" rel="noopener">${esc(v.report_id || v.coa_code)} (version ${v.version_no})</a> issued ${esc(dt(v.issued_at))} by ${esc(v.issued_by_name)}</li>`).join('')}
      </ul></div>
    </div>
    <div>${d.token ? `<iframe class="pdf" title="COA preview" src="/api/reports/preview/${d.token}#navpanes=0&view=Fit"></iframe><p class="help"><a href="/api/reports/preview/${d.token}" target="_blank" rel="noopener" id="openpdf">Open the PDF in a new tab</a>. The issued PDF is made again when you sign (same content; "Preview, not issued" leaves the footer).</p>` : '<div class="card err">The PDF could not be made: see the release check.</div>'}</div>
    <div class="side">
      <div class="card" id="checks"><h2>Release check</h2>
        ${d.checks.map((k) => `<div class="chk ${k.level}" data-code="${esc(k.code)}"><span class="lv">${esc(k.level)}</span><b>${esc(k.title)}</b>${esc(k.detail)}${(k.links || []).map((l) => `<a class="lk" href="${esc(l.href)}">${esc(l.text)}</a>`).join('')}
          ${k.level === 'Warning' ? `<textarea rows="2" data-ack="${esc(k.code)}" placeholder="Why it can be released despite this (required)">${esc(acks[k.code] || '')}</textarea>` : ''}</div>`).join('')}
      </div>
      <div class="card"><h2>Add a note</h2>${d.can_notes ? `
        <div class="field"><label for="nk">Kind</label><select id="nk"><option value="COA">On the COA (the client sees it)</option><option value="Internal">Internal (never printed)</option></select></div>
        <div class="field"><label for="nt">On</label><select id="nt"><option value="">The sample</option>${c.tests.map((t) => `<option value="${t.requested_test_id}|">${esc(t.test_name)}</option>`).join('')}
          ${resultRows.map(({ t, r }) => `<option value="${t.requested_test_id}|${r.analyte_id}">${esc(t.test_name)}: ${esc(r.analyte)}${r.label ? ' (' + esc(r.label) + ')' : ''}</option>`).join('')}</select></div>
        <div class="field"><label for="nc">Canned comment</label><select id="nc"><option value=""></option>${d.canned.map((q) => `<option value="${q.id}">${esc(q.reason_text)}</option>`).join('')}</select></div>
        <div class="field"><label for="nx">Or type it</label><textarea id="nx" rows="2"></textarea></div>
        <button class="btn" id="addnote">Add the note</button>
        ${x.notes.length ? `<h3 style="margin:12px 0 4px;font-size:13px">On this sample</h3>${x.notes.map((n) => `<div class="note"><button class="btn ghost" data-rm="${n.id}" title="Remove the note">×</button><span class="k">${n.kind === 'Internal' ? 'Internal' : 'On the COA'}${n.analyte ? ' · ' + esc(n.analyte) : n.test_name ? ' · ' + esc(n.test_name) : ''}</span><br>${esc(n.note_text)}</div>`).join('')}` : ''}`
        : '<p class="help">You need reports.notes to add notes.</p>'}</div>
    </div>
  </div>
  <div class="fzbar">
    <button class="btn" id="prev" ${session.i ? '' : 'disabled'}>Previous</button>
    <button class="btn ${session.ready[it.sample_id] ? '' : 'primary'}" id="ready" ${blocks.length ? 'disabled' : ''}>${session.ready[it.sample_id] ? 'Ready ✓ (undo)' : 'Mark ready and go to the next'}</button>
    <button class="btn" id="next" ${session.i < session.items.length - 1 ? '' : 'disabled'}>Next</button>
    <span class="help" id="readyn"></span>
    <span style="flex:1"></span>
    <button class="btn primary" id="sign">Sign and issue</button>
  </div>`;
  const q = (sel) => main.querySelector(sel);
  // the note's Kind and On keep the last choice (Alex: adding several notes to the same analyte)
  for (const [sel, key] of [['#nk', 'kind'], ['#nt', 'on']]) {
    const el = q(sel); if (!el) continue;
    if (noteLast[key] && [...el.options].some((o) => o.value === noteLast[key])) { el.value = noteLast[key]; el.dispatchEvent(new Event('change')); }
    el.addEventListener('change', () => { noteLast[key] = el.value; });
  }
  const nReady = () => session.items.filter((y) => session.ready[y.sample_id]).length;
  q('#readyn').textContent = `${nReady()} of ${session.items.length} ready${blocks.length ? ' · this COA is blocked: see the release check' : ''}`;
  q('#sign').disabled = !nReady();
  q('#sign').textContent = `Sign and issue ${nReady()} COA${nReady() === 1 ? '' : 's'}`;
  main.querySelectorAll('[data-ack]').forEach((t) => { t.oninput = () => { acks[t.dataset.ack] = t.value; }; });
  const go = (k) => { session.i = k; review(main); };
  main.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(Number(b.dataset.go)); });
  q('#prev').onclick = () => go(session.i - 1);
  q('#next').onclick = () => go(session.i + 1);
  q('#ready').onclick = () => {
    if (session.ready[it.sample_id]) { delete session.ready[it.sample_id]; review(main); return; }
    const missing = d.checks.filter((k) => k.level === 'Warning' && !String(acks[k.code] || '').trim());
    if (missing.length) { toast(`Give a reason to release despite: ${missing.map((k) => k.title).join(', ')}`, 'err'); return; }
    session.ready[it.sample_id] = true;
    const nxt = session.items.findIndex((y, k) => k > session.i && !session.ready[y.sample_id]);
    if (nxt >= 0) go(nxt); else review(main);
  };
  if (q('#addnote')) q('#addnote').onclick = async () => {
    const [rt, an] = (q('#nt').value || '|').split('|');
    const body = { sample_id: s.id, kind: q('#nk').value, requested_test_id: rt || null, analyte_id: an || null, reason_code_id: q('#nc').value || null, note_text: q('#nx').value };
    if (!body.reason_code_id && !body.note_text.trim()) { toast('Choose a canned comment or type the note.', 'err'); return; }
    try { await api('/reports/notes', { method: 'POST', body }); toast('Note added; the COA is made again.'); delete session.ready[it.sample_id]; review(main); } catch (e) { toast(e.message, 'err'); }
  };
  main.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => {
    const reason = await askReason('removing this note'); if (reason === null) return;
    try { await api(`/reports/notes/${b.dataset.rm}/remove`, { method: 'POST', body: { reason } }); delete session.ready[it.sample_id]; review(main); } catch (e) { toast(e.message, 'err'); }
  }; });
  q('#sign').onclick = async () => {
    const items = session.items.filter((y) => session.ready[y.sample_id]);
    if (!items.length) return;
    const reissue = items.some((y) => !y.tests.length);
    const out = await signDialog({ what: `Finalize and issue ${items.length} COA${items.length > 1 ? 's' : ''}: ${items.map((y) => y.sample_code).join(', ')}. One signature applies to each COA separately.${reissue ? ' A new version without a new result needs the reason (e.g. a corrected client detail).' : ''}`,
      meaning: 'Finalized by', needReason: reissue,
      submit: async ({ signature, reason }) => api('/reports/finalize', { method: 'POST', body: { signature, reason, items: items.map((y) => ({ sample_id: y.sample_id, tests: y.tests, acks: session.acks[y.sample_id] || {} })) } }) });
    if (!out) return;
    const issued = out.issued.filter((y) => !y.held); const held = out.issued.filter((y) => y.held);
    toast(`${out.group}: ${issued.length} COA${issued.length === 1 ? '' : 's'} issued and placed in the Outbox${held.length ? `; ${held.length} finalized and held for the final COA (no partial reports)` : ''}.`);
    session.items = session.items.filter((y) => !session.ready[y.sample_id]); session.ready = {}; session.i = 0;
    location.hash = session.items.length ? '#/reports/review?n=' + Date.now() : '#/reports/finalization';
  };
}

// ---------------------------------------------------------------- the COA card on the sample page
export async function sampleCoaCard(host, sampleId) {
  let d;
  try { d = await api(`/reports/samples/${sampleId}/coa`); } catch (_) { host.remove(); return; }
  host.innerHTML = `${section('Certificate of Analysis', 'Every version issued for this sample, newest first. Versions are never changed or deleted; each PDF has its SHA-256 fingerprint and carries the previous version\'s, and its verification code lets anyone check a copy.',
    '')}<div id="coag"></div>
    <h3 style="margin:14px 0 6px;font-size:14px">Notes</h3><div id="coan"></div>
    <h3 style="margin:14px 0 6px;font-size:14px">Attachments</h3><div id="coaa"></div>${d.can_attach ? '<p><button class="btn" id="attach">Add an attachment…</button></p>' : ''}
    ${d.versions.length && can('reports.finalize') ? '<p class="help">A new version without a new result (a corrected note or client detail): <button class="btn" id="reissue">Issue a new version…</button></p>' : ''}`;
  new Grid(host.querySelector('#coag'), { readOnly: true, rows: d.versions, emptyText: 'No COA issued yet (Result Finalization).',
    columns: [
      { field: 'version_no', title: 'Report', type: 'link', width: 170, compute: (v) => (v.report_id ? `${v.report_id} (v${v.version_no})` : `${v.coa_code} v${v.version_no}`), href: (v) => `/api/reports/coa/${v.id}/pdf${sq()}` },
      { field: 'is_final', title: 'Final', type: 'readonly', width: 60, format: (v) => (v ? 'Yes' : '') },
      { field: 'issued_at', title: 'Issued', type: 'readonly', width: 150, format: dt },
      { field: 'issued_by_name', title: 'Finalized by', type: 'readonly', width: 160 },
      { field: 'group_code', title: 'Group', type: 'readonly', width: 90 },
      { field: 'verify_code', title: 'Verification code', type: 'link', width: 150, href: (v) => `/verify.html?c=${v.verify_code}` },
      { field: 'sha256', title: 'SHA-256', type: 'readonly', width: 230, format: (v) => (v ? v.slice(0, 24) + '…' : '') },
      { field: 'prev_sha256', title: 'Previous version\'s', type: 'readonly', width: 180, format: (v) => (v ? v.slice(0, 16) + '…' : '') },
    ] });
  new Grid(host.querySelector('#coan'), { readOnly: true, rows: d.notes, emptyText: 'No notes.', columns: [
    { field: 'kind', title: 'Kind', type: 'readonly', width: 90, format: (v) => (v === 'Internal' ? 'Internal' : 'On the COA') },
    { field: 'on', title: 'On', type: 'readonly', width: 220, compute: (n) => (n.analyte ? `${n.test_name}: ${n.analyte}` : n.test_name || 'The sample') },
    { field: 'note_text', title: 'Note', type: 'readonly', width: 420 },
    { field: 'by_name', title: 'By', type: 'readonly', width: 150 },
    { field: 'created_at', title: 'When', type: 'readonly', width: 150, format: dt }] });
  new Grid(host.querySelector('#coaa'), { readOnly: true, rows: d.attachments, emptyText: 'No attachments.', columns: [
    { field: 'file_name', title: 'File', type: 'link', width: 280, compute: (a) => a.label || a.file_name, href: (a) => `/api/attachments/${a.id}/file${sq()}` },
    { field: 'kind', title: 'Kind', type: 'readonly', width: 170 },
    { field: 'scope', title: 'For', type: 'readonly', width: 110, compute: (a) => (a.sample_id ? 'This sample' : 'Whole order') },
    { field: 'added_by', title: 'Added by', type: 'readonly', width: 150 },
    { field: 'created_at', title: 'When', type: 'readonly', width: 150, format: dt }] });
  if (host.querySelector('#attach')) host.querySelector('#attach').onclick = () => addAttachment(sampleId, () => sampleCoaCard(host, sampleId));
  if (host.querySelector('#reissue')) host.querySelector('#reissue').onclick = () => {
    const v = d.versions[0];
    session = { items: [{ sample_id: sampleId, sample_code: v.report_id ? v.report_id.replace(/-R\d+$/, '') : v.coa_code.replace(/^COA-/, ''), client_sample_id: '', tests: [], test_names: ['A new version (no new result)'] }], i: 0, ready: {}, acks: {}, data: {} };
    location.hash = '#/reports/review';
  };
}
export async function addAttachment(sampleId, done) {
  const v = await modal({ title: 'Add an attachment', okText: 'Add', html: '<div class="field"><label for="af">File</label><input type="file" id="af"></div>',
    fields: [{ name: 'kind', label: 'Kind', type: 'select', blank: false, value: 'Sample submission form', options: ['Sample submission form', 'Chain of custody', 'Client correspondence', 'Photo', 'Other'] },
      { name: 'label', label: 'Label' }, { name: 'whole_order', label: 'For', type: 'checkbox', cbLabel: 'The whole order (e.g. one submission form for every sample)', value: true }],
    collect: (m) => ({ file: m.querySelector('#af').files[0] || null }) });
  if (!v) return;
  if (!v.file) { toast('Choose a file.', 'err'); return; }
  const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(v.file); });
  try {
    await api(`/samples/${sampleId}/attachments`, { method: 'POST', body: { file_name: v.file.name, mime_type: v.file.type || 'application/octet-stream', b64, kind: v.kind, label: v.label, whole_order: v.whole_order } });
    toast('Attachment added.'); if (done) done();
  } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------- email templates (Outbox, Templates tab)
export async function templates(host) {
  const d = await api('/outbox/templates');
  host.innerHTML = `<p class="help">Every automatic email is sent from one of these templates. Words in {{double braces}} are filled in by the system (the list is under each template). ${d.can_edit ? 'Edit the name, subject or active tick here; "Wording…" edits the body.' : 'QA and administrators edit them (outbox.templates).'}</p><div id="tg"></div>`;
  const grid = editableGrid({ el: host.querySelector('#tg'), rows: d.rows, readOnly: !d.can_edit, what: 'the email templates',
    columns: [
      { field: 'template_name', title: 'Template', width: 260, required: true },
      { field: 'template_code', title: 'Sent for', type: 'readonly', width: 160 },
      { field: 'subject', title: 'Subject', width: 420, required: true },
      { field: 'is_active', title: 'Active', type: 'bool', width: 70 },
      { field: 'body', title: 'Wording', type: 'button', width: 110, label: () => (d.can_edit ? 'Wording…' : 'Read…'), onClick: (r) => wording(r) },
    ],
    save: (rows, reason) => api('/outbox/templates', { method: 'POST', body: { rows, reason } }),
    afterSave: () => templates(host) });
  async function wording(r) {
    const v = await modal({ title: r.template_name, wide: true, okText: d.can_edit ? 'Save' : 'Close', intro: `Filled in by the system: ${esc(r.placeholders || 'nothing')}`,
      fields: [{ name: 'body', label: 'Wording', type: 'textarea', value: r.body, required: true }] });
    if (!v || !d.can_edit || v.body === r.body) return;
    const reason = await askReason('the template wording'); if (reason === null) return;
    try { await api('/outbox/templates', { method: 'POST', body: { rows: [{ id: r.id, body: v.body }], reason } }); toast('Template saved.'); templates(host); } catch (e) { toast(e.message, 'err'); }
  }
  return grid;
}

// ---------------------------------------------------------------- compliance categories (Admin > Matrices)
export async function categories(host) {
  const d = await api('/compliance-categories');
  host.innerHTML = `<h2>Compliance categories</h2><p class="help">What the sample is, as declared on the sample submission form (the sample grid's Category column). GMP categories are finalized by the quality team (reports.finalize_gmp). Kept by QA and administrators (master.compliance).</p><div id="ccg"></div>`;
  editableGrid({ el: host.querySelector('#ccg'), rows: d.rows, allowAdd: d.can_edit, readOnly: !d.can_edit, what: 'the compliance categories',
    newRow: () => ({ status: 'Active', is_gmp: false, sort_order: (d.rows.length + 1) * 10 }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'category_name', title: 'Category', required: true, width: 230 },
      { field: 'is_gmp', title: 'GMP', type: 'bool', width: 60 },
      { field: 'description', title: 'Description', width: 300 },
      { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 100 },
    ],
    save: (rows, reason) => api('/compliance-categories', { method: 'POST', body: { rows, reason } }),
    afterSave: () => categories(host) });
}

export const canFinalize = () => can('reports.finalize');
