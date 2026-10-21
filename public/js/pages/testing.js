// Testing (WD-2, migration 016): the backlog by department with Autobatch, the batch list and my worklist, and the batch
// page: one tab per workflow step (Batching, Weighing, Preparation, Dilution, Data Entry, Calculation, Hold Point, QC
// Review) plus Results and QC. Grids take paste from Excel and fill down; equipment and materials are added to the
// selected rows (buttons or right-click); a step is completed with the analyst's signature (and a witness's when the
// step asks for one). Re-analysis and re-prep ask single, duplicate or triplicate, a reason and a signature.
import { api, esc, pageHeader, toast, modal, state, badge, link, signDialog, askReason, confirmBox, currentUser } from '../app.js';
import { reviewTrends } from './trending.js';
import { openOos } from './oos.js';
import { Grid } from '../grid.js';
import { editableGrid, section } from './common.js';
import { enhanceAll } from '../combo.js';
import { printLabels } from '../labels.js';
import { flagsCard, aliquotsCard } from './logbooks.js';

const css = document.createElement('style');
css.textContent = `
.tbtabs { display: flex; gap: 6px; flex-wrap: wrap; margin: -4px 0 14px; }
.tbtabs a { text-decoration: none; border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 6px 12px; border-radius: 7px; font-size: 13.5px; }
.tbtabs a.on { background: var(--green-700); border-color: var(--green-700); color: #fff; }
.tbtabs a .st { display: inline-block; width: 16px; text-align: center; margin-right: 3px; }
.tbtabs a.done .st { color: var(--green-700); } .tbtabs a.on.done .st { color: #fff; }
.tbtabs a small { margin-left: 4px; color: var(--muted); } .tbtabs a.on small { color: #E8F3EC; }
.tbhead { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.tbhead .t { font-size: 16px; font-weight: 700; } .tbhead .m { color: var(--muted); font-size: 13px; margin-top: 2px; }
.tbacts { display: flex; gap: 6px; flex-wrap: wrap; }
.tbnote { background: #F4F6F7; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin: 10px 0; font-size: 13.5px; }
.tbtodo { background: #FFF8E6; border: 1px solid #F0D9A0; border-radius: 8px; padding: 8px 12px; margin: 10px 0; font-size: 13.5px; }
.tbtodo ul { margin: 4px 0 0 18px; padding: 0; }
.tbused { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 10px; }
.tbchip { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--line); background: #fff; border-radius: 14px; padding: 3px 10px; font-size: 12.5px; }
.tbchip b { font-weight: 600; } .tbchip button { border: 0; background: none; cursor: pointer; color: var(--muted); font-size: 14px; padding: 0 0 0 2px; }
.tbform { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 0 16px; margin: 6px 0 10px; }
.tbform .field > label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 2px; }
.tbform input { width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.tbgroup { margin-bottom: 18px; }
.tbmenu { position: fixed; z-index: 60; background: #fff; border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.14); padding: 4px 0; min-width: 240px; }
.tbmenu button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 7px 14px; font: inherit; cursor: pointer; }
.tbmenu button:hover { background: #EEF6F1; }
table.grid td.tbpass { color: var(--green-700); font-weight: 600; } table.grid td.tbfail { color: var(--err-ink); font-weight: 700; }
table.grid td.tbwait { color: var(--muted); } table.grid tr.tbsup td { color: #9AA3AC; text-decoration: line-through; }
table.grid tr.tbrerun td { background: #FBFAF2; }
.rvbar { display: flex; gap: 12px; align-items: center; justify-content: space-between; background: #EEF4FB; border: 1px solid #C9DAF0; border-radius: 8px; padding: 8px 12px; margin: 10px 0; font-size: 13.5px; }
.rvbar.ok { background: var(--green-50); border-color: #BFE6D6; }
.rvhead { display: flex; gap: 12px; align-items: center; justify-content: space-between; margin: 18px 0 6px; } .rvhead h3 { margin: 0; }
.rvswitch { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.rvswitch button { border: 0; background: #fff; padding: 5px 10px; font: inherit; font-size: 12.5px; cursor: pointer; } .rvswitch button.on { background: var(--green-700); color: #fff; }
.rvnone { color: var(--muted); font-size: 13px; padding: 4px 8px; } .tbmuted { color: var(--muted); font-weight: 400; font-size: 13px; }
table.grid tr.rvout td { background: #FDF2F1; }
table.grid tr.tbmade td { background: #EAF6EF; font-weight: 600; }
.witbox { border: 1px dashed var(--line); border-radius: 8px; padding: 8px 12px; margin-top: 8px; }
.tbruns { margin: 6px 0 8px; align-items: center; } .tbruns a { font-size: 13px; padding: 4px 10px; } .tbruns .lbl { font-weight: 600; font-size: 13px; margin-right: 4px; }
.tpcard { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
table.grid tr.rvoff td { color: #9AA3AC; }
.witbox .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.addlist { display: flex; flex-direction: column; gap: 4px; max-height: 50vh; overflow: auto; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.addlist .cb { font-weight: 400; }
@media (max-width: 760px) { .tbform { grid-template-columns: 1fr; } }
`;
document.head.appendChild(css);

const TOP_TABS = [['#/testing', 'Backlog'], ['#/testing/batches', 'Batches'], ['#/testing/batches?show=mine', 'My worklist'], ['#/testing/batches?show=review', 'QC Review']];
const topTabs = (cur) => `<div class="tbtabs">${TOP_TABS.map(([h, l]) => `<a href="${h}" class="${h === cur ? 'on' : ''}">${esc(l)}</a>`).join('')}</div>`;
const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const day = (v) => (v ? String(v).slice(0, 10) : '');
const nfmt = (v) => (v === null || v === undefined || v === '' ? '' : String(+Number(v).toPrecision(6)));
const COUNT_WORDS = [{ value: '1', label: 'Single (1)' }, { value: '2', label: 'Duplicate (2)' }, { value: '3', label: 'Triplicate (3)' }];
const BENCH_TYPES = ['Batching', 'Weighing', 'Preparation', 'Dilution', 'Plating/Inoculation', 'Incubation', 'Data Entry', 'Calculation', 'Hold Point', 'Split off Test'];
const pad2 = (n) => String(n).padStart(2, '0');
const loc = (v) => { if (!v) return ''; const x = new Date(v); return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())} ${pad2(x.getHours())}:${pad2(x.getMinutes())}`; };
const isoOf = (v) => { if (v === null || v === undefined || v === '') return null; const x = new Date(String(v).trim().replace(' ', 'T')); if (Number.isNaN(x.getTime())) throw new Error('Not a date and time: ' + v + ' (use YYYY-MM-DD HH:MM)'); return x.toISOString(); };
const fieldKey = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const sampleHref = (e) => (e.sample_id ? '#/samples/' + e.sample_id : null);

function needLab(main) {
  if (state.site) return true;
  main.innerHTML = '<div class="card err">Choose your lab (top right) first.</div>';
  return false;
}

// ================================================================ BACKLOG
export async function backlog(main) {
  if (!needLab(main)) return;
  const d = await api('/testing/backlog');
  // department, then test version
  const groups = new Map();
  for (const r of d.rows) {
    const dk = r.department_code ? `${r.department_code} ${r.department_name}` : 'No department';
    if (!groups.has(dk)) groups.set(dk, new Map());
    const g = groups.get(dk);
    if (!g.has(r.test_version_id)) g.set(r.test_version_id, []);
    g.get(r.test_version_id).push(r);
  }
  main.innerHTML = pageHeader('Testing', 'The backlog: logged tests waiting for a batch, by department. Re-preps come first, then rush, then by due date. Autobatch fills a batch up to the test\'s maximum and adds its QC; or select rows and batch only those.',
    '', { kind: 'batches' })
    + topTabs('#/testing')
    + (d.rows.length ? '' : '<div class="card">Nothing is waiting. Tests appear here once their sample is logged (and the test has an approved workflow).</div>')
    + [...groups.entries()].map(([dk, g], di) => `<h2 style="margin:18px 0 8px">${esc(dk)}</h2>` + [...g.entries()].map(([vid, rows], ti) => {
      const r0 = rows[0]; const max = d.max_samples[vid];
      return `<div class="card tbgroup">${section(`${r0.test_code} ${r0.test_name} (v${r0.version_no})`,
        `${rows.length} waiting${max ? ` · up to ${max} per batch` : ''}${rows.some((x) => x.kind === 'Re-prep') ? ' · includes re-preps' : ''}`,
        d.can_perform ? `<button class="btn" data-sel="${vid}">Batch selected rows</button> <button class="btn primary" data-auto="${vid}">Autobatch</button>` : '')}<div id="g_${di}_${ti}" data-v="${vid}"></div></div>`;
    }).join('')).join('');
  // split-off requests waiting for the customer (WD-4)
  try {
    const sp = await api('/testing/split-requests');
    if (sp.rows.length) {
      main.insertAdjacentHTML('beforeend', `<div class="card">${section('Split-off requests', 'A sample had a finding and a test was split off (e.g. identification). Record the customer\'s decision; then order the test on the sample (order page). Ordering closes the request.')}<div id="spl"></div></div>`);
      new Grid(main.querySelector('#spl'), { readOnly: true, rows: sp.rows, columns: [
        { field: 'sample_code', title: 'Sample', type: 'link', width: 130, href: (r) => '#/samples/' + r.sample_id },
        { field: 'client_name', title: 'Client', type: 'readonly', width: 150 },
        { field: 'origin_test_name', title: 'From', type: 'readonly', width: 200 },
        { field: 'finding', title: 'Finding', type: 'readonly', width: 180 },
        { field: 'test_name', title: 'Test to order', type: 'readonly', width: 200 },
        { field: 'status', title: 'Status', type: 'readonly', width: 130 },
        { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
        { field: 'yes', title: '', type: 'button', width: 120, label: (r) => (sp.can_decide && r.status === 'Awaiting consent' ? 'Consent given…' : ''), onClick: (r) => decideSplit(r, 'Consent given') },
        { field: 'no', title: '', type: 'button', width: 90, label: (r) => (sp.can_decide && r.status === 'Awaiting consent' ? 'Declined…' : ''), onClick: (r) => decideSplit(r, 'Declined') },
      ] });
    }
  } catch (_) { /* not shown without access */ }
  const grids = {};
  main.querySelectorAll('[data-v]').forEach((host) => {
    const vid = host.dataset.v; let rows;
    for (const g of groups.values()) if (g.has(vid)) rows = g.get(vid);
    grids[vid] = new Grid(host, {
      readOnly: true, rows, emptyText: 'Nothing waiting.', keyField: 'key',
      columns: [
        { field: 'priority', title: 'Priority', type: 'readonly', width: 80, cellClass: (r) => (r.priority !== 'Standard' ? 'flag' : '') },
        { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => '#/samples/' + r.sample_id },
        { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 130 },
        { field: 'client_name', title: 'Client', type: 'readonly', width: 170 },
        { field: 'matrix', title: 'Matrix', type: 'readonly', width: 100 },
        { field: 'due_date', title: 'Due', type: 'readonly', width: 95, format: day },
        { field: 'kind', title: 'Kind', type: 'readonly', width: 140, compute: (r) => (r.kind === 'Re-prep' ? `Re-prep ×${r.replicates}` : r.is_media ? 'Lot QA testing' : 'New'),
          help: 'A lot QA testing sample (its ID is the inventory lot\'s: media, reagents and other items tested before use) joins a batch without counting toward its size or QC' },
        { field: 'reason', title: 'Re-prep reason', type: 'readonly', width: 200 },
        { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
      ],
    });
    grids[vid].rows.forEach((r) => { r.key = r.requested_test_id + ':' + (r.reprep_request_id || ''); });
  });
  const make = async (vid, items) => {
    try {
      const b = await api('/testing/batches', { method: 'POST', body: { test_version_id: vid, items } });
      // to the Batches list (not into the batch), so a supervisor can see the day's batches and assign them (Alex, 2026-10-13)
      toast(`Batch ${b.batch_code} made.`); location.hash = '#/testing/batches?show=open&made=' + encodeURIComponent(b.batch_code);
    } catch (e) { toast(e.message, 'err'); }
  };
  main.querySelectorAll('[data-auto]').forEach((b) => { b.onclick = async () => {
    const vid = b.dataset.auto; const n = grids[vid].rows.length; const max = d.max_samples[vid];
    if (await confirmBox('Autobatch', `Make a batch of ${max && n > max ? `the first ${max}` : `all ${n}`} waiting test${n === 1 ? '' : 's'} (in priority order) with the test's QC? It is assigned to you.`, 'Make the batch')) make(vid, null);
  }; });
  main.querySelectorAll('[data-sel]').forEach((b) => { b.onclick = () => {
    const sel = grids[b.dataset.sel].selectedRows();
    if (!sel.length) { toast('Select the rows to batch first (click and drag, or Shift+click).', 'err'); return; }
    make(b.dataset.sel, sel.map((r) => ({ requested_test_id: r.requested_test_id, reprep_request_id: r.reprep_request_id || null })));
  }; });
  // right-click a selection: add it to an open batch of the same test that has not started (Alex, 2026-10-13)
  if (d.can_perform) main.querySelectorAll('[data-v]').forEach((host) => {
    host.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('td')) return;
      const vid = host.dataset.v; const sel = grids[vid].selectedRows();
      if (!sel.length) return;
      e.preventDefault();
      contextMenu(e.clientX, e.clientY, [[`Add ${sel.length === 1 ? sel[0].sample_code : sel.length + ' selected samples'} to a batch…`, () => addToBatch(vid, sel)],
        ['Make a batch of the selected rows', () => make(vid, sel.map((r) => ({ requested_test_id: r.requested_test_id, reprep_request_id: r.reprep_request_id || null })))]]);
    });
  });
}

// Add backlog items to an open batch of the same test version that has not started (no signature: Alex)
async function addToBatch(vid, sel, preset = null) {
  try {
    const open = preset ? [preset] : (await api('/testing/open-batches?version=' + vid)).rows;
    if (!open.length) { toast('No batch of this test is waiting to start: make a new batch instead.', 'err'); return; }
    const r = await modal({ title: `Add ${sel.length} sample${sel.length === 1 ? '' : 's'} to a batch`, okText: 'Add',
      intro: `${esc(sel.map((x) => x.sample_code || x.client_sample_id).join(', '))}. Only batches with no bench work recorded yet can take more samples; the QC follows the number of samples, and a completed Batching step is opened again to confirm the batch.`,
      fields: [{ name: 'batch_id', label: 'Batch', type: 'select', required: true, value: open[0].id, blank: false,
        options: open.map((b) => ({ value: b.id, label: `${b.batch_code} · ${b.sample_count} sample${Number(b.sample_count) === 1 ? '' : 's'}, ${b.qc_count} QC · ${b.assigned_name} · ${b.status}` })) }] });
    if (!r) return;
    const res = await api(`/testing/batches/${r.batch_id}/add`, { method: 'POST', body: { items: sel.map((x) => ({ requested_test_id: x.requested_test_id, reprep_request_id: x.reprep_request_id || null })) } });
    toast(`Added to ${res.batch_code}.`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch (e) { toast(e.message, 'err'); }
}

// The customer's decision on a split-off test (people who handle orders)
export async function decideSplit(r, decision) {
  const m = await modal({ title: `${decision}: ${r.test_name} on ${r.sample_code || r.client_sample_id}`, okText: 'Record',
    intro: `Finding: ${esc(r.finding || '')}. Record who decided and how (e.g. "Sam Nguyen, email 13 Oct").`,
    fields: [{ name: 'note', label: 'Note', type: 'textarea', required: decision === 'Declined' }] });
  if (!m) return;
  try { await api(`/testing/split-requests/${r.id}/decide`, { method: 'POST', body: { decision, note: m.note } }); toast(`${decision} recorded.`); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  catch (e) { toast(e.message, 'err'); }
}

// ================================================================ BATCHES AND MY WORKLIST
const SHOW = { open: 'Open', mine: 'My worklist', review: 'Awaiting review', all: 'All' };
export async function batches(main) {
  if (!needLab(main)) return;
  const show = SHOW[state.query.get('show')] ? state.query.get('show') : 'open';
  const d = await api('/testing/batches?show=' + show);
  main.innerHTML = pageHeader(show === 'mine' ? 'My worklist' : show === 'review' ? 'QC Review' : 'Batches',
    show === 'mine' ? 'Batches assigned to you that are not finished, earliest due first.' : show === 'review' ? 'Batches whose bench work is done, waiting for a reviewer (someone who did not perform or witness their steps).' : 'Every batch in this lab: its step progress and who it is assigned to.', '', { kind: 'batches' })
    + topTabs(show === 'mine' ? '#/testing/batches?show=mine' : show === 'review' ? '#/testing/batches?show=review' : '#/testing/batches')
    + `<div class="wdbar" style="display:flex;gap:8px;margin-bottom:12px;align-items:center">${Object.entries(SHOW).map(([k, l]) => `<a class="btn ${k === show ? 'primary' : ''}" href="#/testing/batches?show=${k}">${esc(l)} <small>${d.counts[k] ?? ''}</small></a>`).join('')}
       ${d.can_assign ? '<span style="flex:1"></span><span class="help">Select batches (Ctrl+click to pick several), then</span> <button class="btn" id="massassign">Assign selected</button>' : ''}</div>
     ${state.query.get('made') ? `<div class="tbnote">Batch <b>${esc(state.query.get('made'))}</b> made and assigned to you. It is highlighted below; open it to start, or assign it with others.</div>` : ''}<div id="g"></div>`;
  const made = state.query.get('made');
  const bg = new Grid(main.querySelector('#g'), {
    readOnly: true, search: true, rows: d.rows, emptyText: show === 'mine' ? 'No batches assigned to you.' : 'No batches.',
    rowClass: (r) => (made && r.batch_code === made ? 'tbmade' : ''),
    onRowOpen: (r) => { location.hash = '#/testing/batches/' + r.id; },
    columns: [
      { field: 'batch_code', title: 'Batch', type: 'link', width: 105, href: (r) => '#/testing/batches/' + r.id },
      { field: 'test_name', title: 'Test', type: 'link', width: 260, compute: (r) => `${r.test_code} ${r.test_name}`, href: (r) => '#/methods/versions/' + r.test_version_id },
      { field: 'version_no', title: 'Ver.', type: 'readonly', width: 45 },
      { field: 'department_code', title: 'Dept.', type: 'readonly', width: 65 },
      { field: 'status', title: 'Status', type: 'readonly', width: 120 },
      { field: 'assigned_name', title: 'Assigned to', type: 'readonly', width: 150 },
      { field: 'sample_count', title: 'Samples', type: 'readonly', width: 70 },
      { field: 'qc_count', title: 'QC', type: 'readonly', width: 50 },
      { field: 'steps', title: 'Steps done', type: 'readonly', width: 85, compute: (r) => `${r.steps_done} of ${r.steps_total}` },
      { field: 'next_step', title: 'Next step', type: 'readonly', width: 170 },
      { field: 'earliest_due', title: 'Earliest due', type: 'readonly', width: 100, format: day },
      { field: 'created_at', title: 'Made', type: 'readonly', width: 140, format: dt },
    ],
  });
  // a supervisor assigns several batches at once (each assignment is recorded on its batch)
  const ma = main.querySelector('#massassign');
  if (ma) ma.onclick = async () => {
    const sel = bg.selectedRows().filter((r) => !['Approved', 'Cancelled'].includes(r.status));
    if (!sel.length) { toast('Select the batches to assign first (click a row; Ctrl+click to add more, Shift+click for a block).', 'err'); return; }
    const r = await modal({ title: `Assign ${sel.length} batch${sel.length === 1 ? '' : 'es'}`, okText: 'Assign',
      intro: esc(sel.map((x) => x.batch_code).join(', ')),
      fields: [{ name: 'user_id', label: 'Who does them', type: 'select', required: true, options: d.people.map((p) => ({ value: p.id, label: p.full_name })) }] });
    if (!r) return;
    let ok = 0; const failed = [];
    for (const x of sel) {
      try { await api(`/testing/batches/${x.id}/assign`, { method: 'POST', body: r }); ok++; } catch (e) { failed.push(`${x.batch_code}: ${e.message}`); }
    }
    if (ok) toast(`${ok} batch${ok === 1 ? '' : 'es'} assigned.`);
    if (failed.length) toast(failed.join(' | '), 'err');
    batches(main);
  };
}

// ================================================================ ONE BATCH
export async function batchPage(main, id) {
  const [d, opts] = await Promise.all([api('/testing/batches/' + id), api(`/testing/batches/${id}/options`)]);
  const b = d.batch;
  const byRun = Object.fromEntries(d.steps.map((s) => [s.id, s]));
  const stepOf = (key) => d.steps.find((s) => s.step_key === key);
  const nextStep = d.steps.find((s) => s.step_name === b.next_step);
  const reviewStep = d.steps.find((s) => s.step_type === 'QC Review');
  const tabKey = state.query.get('step') || (nextStep ? nextStep.step_key : reviewStep && b.status !== 'Cancelled' ? reviewStep.step_key : 'results');
  const cur = tabKey === 'results' ? null : stepOf(tabKey);
  const editable = d.can_perform && !b.is_verification && !['Approved', 'Cancelled'].includes(b.status);
  const icon = (s) => (s.status === 'Completed' ? '✓' : s.status === 'In progress' ? '●' : '○');
  main.innerHTML = pageHeader(`${b.batch_code}: ${b.test_name}`,
    `${link('#/methods/versions/' + b.test_version_id, `${b.test_code} version ${b.version_no}`)} ${badge(b.status)} · ${esc(b.site_code)}${b.department_code ? ' · ' + esc(b.department_code) : ''}
     · ${b.sample_count} sample${Number(b.sample_count) === 1 ? '' : 's'}, ${b.qc_count} QC · assigned to <b>${esc(b.assigned_name)}</b>${b.earliest_due ? ` · earliest due ${esc(day(b.earliest_due))}` : ''}`,
    `<a class="btn ghost" href="#/testing/batches">All batches</a> <button class="btn" id="labelsb" title="Barcode labels: one per entry (Dymo, 1 x 2 1/8 in.)">Print labels</button>${d.can_assign && editable ? ' <button class="btn" id="assign">Assign</button>' : ''}${(d.can_assign || d.can_review) && !b.is_verification && !['Approved', 'Cancelled'].includes(b.status) ? ' <button class="btn" id="cancelb">Cancel batch</button>' : ''}`,
    { kind: 'batch', id: b.id })
    + `<div class="tbtabs">${d.steps.map((s) => `<a href="#/testing/batches/${b.id}?step=${s.step_key}" class="${s.step_key === tabKey ? 'on' : ''} ${s.status === 'Completed' ? 'done' : ''}" title="${esc(s.step_type)}: ${esc(s.status)}"><span class="st">${icon(s)}</span>${esc(s.step_name)}</a>`).join('')}
       <a href="#/testing/batches/${b.id}?step=results" class="${tabKey === 'results' ? 'on' : ''}">Results and QC</a></div>
    ${b.is_verification ? `<div class="tbnote"><b>Workflow verification batch</b> of ${link('#/verification/' + b.verification_id, b.verification_code || 'a verification')}: worked by the automated verification accounts during its run. It is not lab work, is kept out of the lab's lists and takes no changes.</div>` : ''}
    ${b.status === 'Cancelled' ? `<div class="tbtodo"><b>Cancelled</b> by ${esc(b.cancelled_by_name || '')} ${esc(dt(b.cancelled_at))}: ${esc(b.cancelled_reason || '')}. Its samples went back to the backlog.</div>` : ''}
    ${b.status === 'In Progress' && b.returned_reason ? `<div class="tbtodo"><b>Returned by the reviewer</b> (${esc(b.returned_by_name || '')}, ${esc(dt(b.returned_at))}): ${esc(b.returned_reason)}</div>` : ''}
    ${b.status === 'Approved' ? `<div class="tbnote"><b>Approved</b> by ${esc(b.reviewed_by_name || '')} ${esc(dt(b.reviewed_at))}. The results are stored and locked.</div>` : ''}
    <div id="panel"></div>`;
  const reload = () => batchPage(main, id);
  main.querySelector('#labelsb').onclick = () => printLabels('batch', [b.id]);
  const cb = main.querySelector('#cancelb');
  if (cb) cb.onclick = async () => {
    const done = await signDialog({ what: `Cancel ${b.batch_code}`, meaning: 'Cancelled by', needReason: true,
      submit: ({ reason, signature }) => api(`/testing/batches/${b.id}/cancel`, { method: 'POST', body: { reason, signature } }) });
    if (done) { toast('Batch cancelled: its samples are back in the backlog.'); reload(); }
  };
  const as = main.querySelector('#assign');
  if (as) as.onclick = async () => {
    const r = await modal({ title: `Assign ${b.batch_code}`, okText: 'Assign', fields: [{ name: 'user_id', label: 'Who does the batch', type: 'select', required: true, value: b.assigned_to,
      options: opts.people.map((p) => ({ value: p.id, label: p.full_name })) }] });
    if (!r) return;
    try { await api(`/testing/batches/${b.id}/assign`, { method: 'POST', body: r }); toast('Batch assigned.'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const ctx = { d, opts, b, editable, reload, byRun, main };
  const panel = main.querySelector('#panel');
  if (!cur) return resultsPanel(panel, ctx);
  stepPanel(panel, ctx, cur);
}

// In QC Review the reviewer opens each step as the analyst recorded it and approves it here (a recorded click; migration 020)
function reviewBar(ctx, s) {
  const { d, b } = ctx;
  if (s.step_type === 'QC Review' || !(b.status === 'Awaiting Review' || (b.status === 'In Progress' && (d.markable || []).includes(s.id)))) return '';
  const m = (d.review_marks || []).find((x) => x.step_run_id === s.id);
  if (!m) return '';
  const can = d.can_review && !d.performer;
  return `<div class="rvbar ${m.mark_id ? 'ok' : ''}"><span>${m.mark_id ? `✓ Approved in QC Review by <b>${esc(m.marked_by_name || '')}</b> ${esc(dt(m.marked_at))}`
    : can ? '<b>QC Review:</b> check this step as recorded, then approve it.' : 'Waiting for the reviewer to approve this step.'}</span>
    ${can ? `<button class="btn ${m.mark_id ? '' : 'primary'}" data-mark="${m.mark_id ? 'undo' : 'approve'}">${m.mark_id ? 'Undo' : 'Approve step'}</button>` : ''}</div>`;
}

// WD-5: a re-reading is labelled RA1-, RA2-... and belongs to an analytical run (run 1 unless a run added it)
const rlabel = (label, rn) => (Number(rn) > 1 ? `RA${Number(rn) - 1}-${label}` : label);
const runOfReading = (d, stepRun, entry, rn) => Number(d.reading_runs.find((x) => x.step_run_id === stepRun && x.entry_id === entry && Number(x.run_no) === Number(rn))?.run || 1);
const runsAt = (d, stepRun) => Math.max(1, ...d.runs.filter((x) => x.step_run_id === stepRun).map((x) => Number(x.run_no)));
const lastReadingStep = (d) => [...d.steps].filter((x) => x.step_type === 'Data Entry').sort((a, b) => b.sort_order - a.sort_order)[0];
// Values recorded at a step, by entry / analyte / reading
const valueOf = (d, run, entry, analyte, rn) => d.values.find((v) => v.step_run_id === run && v.entry_id === entry && (v.analyte_id || null) === (analyte || null) && Number(v.run_no) === Number(rn));
const runsOf = (d, run, entry) => Number(d.run_counts.find((x) => x.step_run_id === run && x.entry_id === entry)?.runs || 1);
const active = (d) => d.entries.filter((e) => e.status === 'Active' && !e.daily_of_entry_id);   // a linked daily control's data is in its own batch
const benchEntries = (d) => active(d).filter((e) => e.entry_type === 'Sample' || e.qc_class === 'Prep');
// The sample's product category drives the bench (migration 039): its row of a step's "per product category" setting
const catSetting = (c, e) => ((e && e.product_category_id && Array.isArray(c.by_category)) ? c.by_category.find((x) => x.category_id === e.product_category_id) || null : null);
const isWeighed = (c, e) => (e.entry_type === 'Sample' ? !(c.target_mode === 'By product category' && catSetting(c, e)?.not_weighed) : !c.qc_not_weighed);
// the accepted weight range of an entry: one target ± tolerance, or its category's range (null: no range)
function weightRange(c, e) {
  if ((c.target_mode === 'Single' || (!c.target_mode && c.target !== undefined && c.target !== null)) && c.target !== null && c.target !== undefined) {
    const pct = c.tolerance_unit === '%'; const t = Number(c.target); const tol = Number(c.tolerance || 0);
    return { lo: t - (pct ? t * tol / 100 : tol), hi: t + (pct ? t * tol / 100 : tol) };
  }
  if (c.target_mode === 'By product category') { const x = catSetting(c, e); if (x && !x.not_weighed && x.min !== null && x.min !== undefined && x.max !== null && x.max !== undefined) return { lo: Number(x.min), hi: Number(x.max) }; }
  return null;
}
// the amounts a Dilution step expects for an entry: its category's, else the step's default (null: none set)
function dilutionExpected(c, e) {
  const x = c.mode === 'Serial' ? null : catSetting(c, e);
  if (x && x.aliquot) return { aliquot: Number(x.aliquot), diluent: Number(x.diluent || 0), from: e.product_category };
  if (c.mode !== 'Serial' && c.aliquot) return { aliquot: Number(c.aliquot), diluent: Number(c.diluent || 0), from: null };
  return null;
}
// the incubation window of an entry: its category's, else the step's
function incubationWindowOf(c, e) {
  const x = catSetting(c, e);
  if (x && x.window_min !== null && x.window_min !== undefined) return { min: x.window_min, max: x.window_max, from: e.product_category };
  return { min: c.window_min, max: c.window_max, from: null };
}
const kindOf = (e) => (e.entry_type === 'Sample' ? (e.media_lot_id ? 'Lot QA testing' : e.replicate_no > 1 || e.reprep_request_id ? 'Sample (re-prep)' : 'Sample') : e.qc_type);
const usedFor = (list, run, entry) => list.filter((x) => x.step_run_id === run && (x.entry_id === entry || !x.entry_id));
// equipment and lots shown on the bench are links to their records
const eqLink = (x, after) => ({ text: x.equipment_code, href: x.equipment_id ? '#/equipment/' + x.equipment_id : null, after });
const lotLink = (x, after) => ({ text: x.lot_code, href: x.lot_id ? '#/inventory/lots/' + x.lot_id : null, after });

function stepPanel(el, ctx, s) {
  const { d, b, editable } = ctx;
  const before = d.deps.filter((x) => x.step_id === s.step_id).map((x) => d.steps.find((y) => y.step_id === x.depends_on_step_id)).filter(Boolean);
  const waitingFor = before.filter((x) => x.status !== 'Completed');
  const open = s.status !== 'Completed';
  const bench = BENCH_TYPES.includes(s.step_type);
  const canWork = editable && open && !waitingFor.length && bench;
  const cfg = s.config || {};
  const witness = cfg.witness || 'None';
  const isEq = ['Weighing', 'Preparation', 'Data Entry', 'Dilution'].includes(s.step_type);
  const isMat = ['Weighing', 'Preparation', 'Dilution', 'Data Entry', 'Plating/Inoculation', 'Incubation'].includes(s.step_type);
  // a reading step's analytical runs (WD-5): one tab each; equipment and raw data belong to the run shown
  const isRead = s.step_type === 'Data Entry';
  const kmax = isRead ? runsAt(d, s.id) : 1;
  const curRun = isRead ? Math.min(Math.max(Number(state.query.get('run')) || kmax, 1), kmax) : 1;
  const inRun = (x) => !isRead || Number(x.analytical_run_no || 1) === curRun;
  const acts = [];
  if (canWork && isEq) acts.push('<button class="btn" data-a="eq">Add equipment</button>');
  if (canWork && isMat) acts.push('<button class="btn" data-a="mat">Add material</button>');
  if (canWork && s.step_type === 'Weighing') acts.push('<button class="btn" data-a="aliquot">Scan aliquot</button>');
  if (canWork && s.step_type === 'Data Entry') acts.push('<button class="btn" data-a="file">Attach raw data</button>');
  if (editable && s.step_type === 'Data Entry') acts.push('<button class="btn" data-a="rean">Add analytical run</button>');
  if (d.can_pick && s.step_type === 'Data Entry' && canWork) acts.push('<button class="btn" data-a="pick" title="Pick the selected reading as the one reported (with a note)">Pick reported reading…</button>');
  if (editable && ['Data Entry', 'Calculation', 'Weighing', 'Preparation', 'Dilution'].includes(s.step_type)) acts.push('<button class="btn" data-a="reprep">Re-prep</button>');
  // before bench work starts, the batch's samples can change (no signature: Alex, 2026-10-13)
  if (s.step_type === 'Batching' && d.can_edit_samples) {
    acts.push(`<button class="btn" data-a="addsamples">Add samples${d.backlog_waiting ? ` (${d.backlog_waiting} waiting)` : ''}</button>`, '<button class="btn" data-a="rmsamples">Remove selected samples</button>');
  }
  if (canWork) acts.push('<button class="btn primary" data-a="complete">Complete step</button>');
  if (editable && !open && bench) acts.push('<button class="btn" data-a="reopen">Reopen</button>');
  const eqList = d.equipment_used.filter((x) => x.step_run_id === s.id && inRun(x));
  const matList = d.materials.filter((x) => x.step_run_id === s.id);
  const files = d.attachments.filter((x) => x.step_run_id === s.id && inRun(x));
  const label = (eid) => (eid ? d.entries.find((e) => e.id === eid)?.label || '' : 'whole batch');
  const chips = [
    ...eqList.map((x) => `<span class="tbchip">Equipment <b>${link('#/equipment/' + x.equipment_id, x.equipment_code)}</b> ${esc(x.equipment_name)} · ${esc(label(x.entry_id))}${canWork ? ` <button data-rm="equipment:${x.id}" title="Remove">×</button>` : ''}</span>`),
    ...matList.map((x) => `<span class="tbchip">${esc(x.purpose)} <b>${link('#/inventory/lots/' + x.lot_id, x.lot_code)}</b> ${esc(x.item_name || '')}${x.volume ? ` · ${nfmt(x.volume)} ${esc(x.volume_unit || '')}` : ''}${x.logbook_entry_id ? ` · ${link('#/logbooks/entries/' + x.logbook_entry_id, x.logbook_entry_code || 'logbook entry')}` : ''} · ${esc(label(x.entry_id))}${canWork ? ` <button data-rm="material:${x.id}" title="Remove">×</button>` : ''}</span>`),
    ...files.map((x) => `<span class="tbchip">Raw data <b><a href="/api/testing/attachments/${x.id}/file?s=${encodeURIComponent(state.site || '')}">${esc(x.file_name)}</a></b> ${esc(x.uploaded_by)}${canWork ? ` <button data-rm="file:${x.id}" title="Remove">×</button>` : ''}</span>`),
  ];
  const types = (s.equipment_types || []).map((t) => t.type_name + (t.is_main ? ' (main)' : '')).join(', ');
  el.innerHTML = `<div class="card">
    <div class="tbhead"><div><div class="t">${esc(s.step_name)} ${badge(s.status)}</div>
      <div class="m">${esc(s.step_type)}${types ? ' · equipment: ' + esc(types) : ''}${witness !== 'None' ? ` · witness ${esc(witness.toLowerCase())}` : ''}
      ${s.status === 'Completed' ? ` · performed by <b>${esc(s.performed_name || '')}</b> ${esc(dt(s.completed_at))}${s.witness_name ? `, witnessed by <b>${esc(s.witness_name)}</b>` : ''}` : ''}</div></div>
      <div class="tbacts">${acts.join(' ')}</div></div>
    ${s.instructions ? `<div class="tbnote">${esc(s.instructions)}</div>` : ''}
    ${hintFor(s, d)}
    ${waitingFor.length ? `<div class="tbnote">Starts when ${waitingFor.map((x) => `<b>${esc(x.step_name)}</b>`).join(', ')} ${waitingFor.length > 1 ? 'are' : 'is'} completed.</div>` : ''}
    ${open && !waitingFor.length && bench && s.missing.length ? `<div class="tbtodo"><b>Still to do before it can be completed</b><ul>${s.missing.slice(0, 8).map((m) => `<li>${esc(m)}</li>`).join('')}${s.missing.length > 8 ? `<li>and ${s.missing.length - 8} more</li>` : ''}</ul></div>` : ''}
    ${isRead && (kmax > 1 || editable) ? `<div class="tbtabs tbruns"><span class="lbl">Analytical runs:</span>${Array.from({ length: kmax }, (_, i) => i + 1).map((k) => {
      const ar = d.runs.find((x) => x.step_run_id === s.id && Number(x.run_no) === k);
      return `<a href="#/testing/batches/${b.id}?step=${s.step_key}&run=${k}" class="${k === curRun ? 'on' : ''}" title="${esc(ar ? `${ar.reason} (${ar.requested_by}, ${dt(ar.created_at)})` : 'The first run')}">Run ${k}</a>`;
    }).join('')}${editable ? '<a href="#" data-a="rean" title="Read chosen samples again in a new run, with the run\'s own ICV and CCVs">+ Add analytical run</a>' : ''}</div>
      ${kmax > 1 ? `<div class="help" style="margin:-4px 0 8px">Run ${curRun}${curRun > 1 ? `: ${esc(d.runs.find((x) => x.step_run_id === s.id && Number(x.run_no) === curRun)?.reason || '')}` : ''}. Each run has its own readings, raw data file, instrument and analytical QC; the reviewer chooses what is reported.</div>` : ''}` : ''}
    ${chips.length ? `<div class="tbused">${chips.join('')}</div>` : ''}
    ${reviewBar(ctx, s)}
    <div id="body"></div></div>`;
  const rb = el.querySelector('[data-mark]');
  if (rb) rb.onclick = () => markStep(ctx, s.id, rb.dataset.mark === 'undo');
  const body = el.querySelector('#body');
  let grid = null;
  const T = s.step_type;
  if (T === 'Batching') grid = batchingGrid(body, ctx, s, canWork);
  else if (T === 'Weighing') grid = weighingGrid(body, ctx, s, canWork);
  else if (T === 'Preparation') preparationForm(body, ctx, s, canWork);
  else if (T === 'Dilution') grid = dilutionGrid(body, ctx, s, canWork);
  else if (T === 'Data Entry') grid = readingGrid(body, ctx, s, canWork, curRun);
  else if (T === 'Calculation' || T === 'Hold Point') grid = calcGrid(body, ctx, s);
  else if (T === 'Plating/Inoculation') grid = platingGrid(body, ctx, s, canWork);
  else if (T === 'Incubation') grid = incubationPanel(body, ctx, s, canWork);
  else if (T === 'Split off Test') splitPanel(body, ctx, s);
  // loads its own data: a failure (e.g. the session ended meanwhile) shows in the panel, not as a stray page error
  else if (T === 'QC Review') reviewPanel(body, ctx, s).catch((e) => { body.innerHTML = `<div class="card err">${esc(e.message)}</div>`; });
  else body.innerHTML = `<div class="tbnote">${esc(T)} steps are done at the bench from WD-4 (micro).</div>`;
  const selected = () => (grid ? [...new Set(grid.selectedRows().map((r) => r.entry_id).filter(Boolean))] : []);
  const handlers = {
    eq: () => addEquipment(ctx, s, selected(), curRun),
    mat: () => addMaterial(ctx, s, selected()),
    file: () => attachFile(ctx, s, curRun),
    rean: () => reanalysis(ctx, s, selected()),
    pick: () => pickReading(ctx, s, grid ? grid.selectedRows()[0] : null),
    reprep: () => reprep(ctx, selected()),
    complete: async () => {
      // anything typed and not yet autosaved is saved first (0.27.0)
      for (const g of ctx.benchGrids || []) { if (!(await g.flush())) { toast('Some values are not saved yet (see the note above the grid): save them before completing the step.', 'err'); return; } }
      completeStep(ctx, s);
    },
    reopen: () => reopenStep(ctx, s),
    addsamples: () => addSamples(ctx),
    rmsamples: () => removeSamples(ctx, grid ? grid.selectedRows() : []),
    aliquot: () => scanAliquot(ctx, s),
  };
  el.querySelectorAll('[data-a]').forEach((x) => { x.onclick = (ev) => { ev.preventDefault(); handlers[x.dataset.a](); }; });
  el.querySelectorAll('[data-rm]').forEach((x) => { x.onclick = async () => {
    const [kind, rid] = x.dataset.rm.split(':');
    try { await api(`/testing/used/${kind}/${rid}/remove`, { method: 'POST', body: {} }); toast('Removed.'); ctx.reload(); } catch (e) { toast(e.message, 'err'); }
  }; });
  // right-click on the grid: the same actions for the selected rows
  if (grid && (canWork || editable)) {
    body.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('td')) return;
      const items = [];
      if (T === 'Batching' && d.can_edit_samples) items.push(['Remove the selected samples from the batch', handlers.rmsamples], ['Add samples from the backlog…', handlers.addsamples]);
      if (canWork && isEq) items.push(['Add equipment to the selected rows', handlers.eq]);
      if (canWork && isMat) items.push(['Add material to the selected rows', handlers.mat]);
      if (editable && T === 'Data Entry') items.push(['Read the selected rows again in a new analytical run', handlers.rean]);
      if (d.can_pick && canWork && T === 'Data Entry') items.push(['Pick this reading as the one reported…', handlers.pick]);
      if (editable && ['Data Entry', 'Calculation', 'Weighing', 'Preparation', 'Dilution'].includes(T)) items.push(['Re-prep the selected samples', handlers.reprep]);
      if (!items.length) return;
      e.preventDefault(); contextMenu(e.clientX, e.clientY, items);
    });
  }
}

function hintFor(s, d) {
  const c = s.config || {};
  if (s.step_type === 'Split off Test') d.splitTestName = (d.splits.find((x) => x.step_run_id === s.id) || {}).test_name;
  if (s.step_type === 'Weighing') {
    if ((c.target_mode === 'Single' || (!c.target_mode && c.target !== undefined && c.target !== null)) && c.target !== null && c.target !== undefined) {
      const pct = c.tolerance_unit === '%'; const lo = c.target - (pct ? c.target * c.tolerance / 100 : c.tolerance || 0); const hi = c.target + (pct ? c.target * c.tolerance / 100 : c.tolerance || 0);
      return `<div class="tbnote">Target ${nfmt(c.target)} ${esc(c.unit || 'g')} ± ${nfmt(c.tolerance)} ${esc(pct ? '%' : c.unit || 'g')}: accepted ${nfmt(lo)} to ${nfmt(hi)} ${esc(c.unit || 'g')}. Weigh client samples and Prep QC; record the balance used.</div>`;
    }
    if (c.target_mode === 'By product category') {
      const cats = (c.by_category || []).map((x) => { const nm = (d.categories || {})[x.category_id] || 'a category'; return x.not_weighed ? `${esc(nm)}: not weighed` : `${esc(nm)}: ${nfmt(x.min)} to ${nfmt(x.max)} ${esc(c.unit || 'g')}`; });
      return `<div class="tbnote">Each sample is checked against the range of its matrix's product category${cats.length ? ' (' + cats.join('; ') + ')' : ''}.${c.qc_not_weighed ? ' Controls are not weighed.' : ''} Record the balance used.</div>`;
    }
    return '<div class="tbnote">No target weight: weigh as your training and the SOP say. Record the balance used.</div>';
  }
  if (s.step_type === 'Dilution') {
    if (c.mode === 'Serial') return `<div class="tbnote">Serial dilution${c.expected_diluent ? ' in ' + esc(c.expected_diluent) : ''}. Record each aliquot and diluent; the factor multiplies.</div>`;
    return `<div class="tbnote">Standard dilution ${c.aliquot ? `${nfmt(c.aliquot)} + ${nfmt(c.diluent || 0)} (factor ${nfmt((Number(c.aliquot) + Number(c.diluent || 0)) / Number(c.aliquot))})` : ''}${c.expected_diluent ? ' in ' + esc(c.expected_diluent) : ''}. A re-dilution goes in the next pair of columns; the factors multiply.</div>`;
  }
  if (s.step_type === 'Data Entry') return `<div class="tbnote">Enter ${esc(c.value_label || 'the reading')}${c.value_unit ? ` in <b>${esc(c.value_unit)}</b>` : ''} for each entry. Paste straight from the instrument's Excel export (Ctrl+V). ${c.require_attachment === false ? '' : 'Attach the export as raw data. '}Record the check standard used on each ICV and CCV.</div>`;
  if (s.step_type === 'Calculation') return `<div class="tbnote">Calculated live: <code>${esc(c.formula || '')}</code>${(c.overrides || []).length ? ' (some analytes have their own formula)' : ''}. Completing it confirms the results are complete.</div>`;
  if (s.step_type === 'Preparation' && c.procedure_ref) return `<div class="tbnote">Procedure: ${esc(c.procedure_ref)}</div>`;
  if (s.step_type === 'Plating/Inoculation') return `<div class="tbnote">Record the plates for each entry (${nfmt(c.plates_per_entry || 1)} per entry; 0 = not plated) and the levels plated. Record the media lot used${c.expected_media ? ` (expected: ${esc(c.expected_media)})` : ''}; a positive control made from strains also needs its strain lot.</div>`;
  if (s.step_type === 'Incubation') return `<div class="tbnote">Target ${nfmt(c.temp_c)} ± ${nfmt(c.temp_tolerance || 0)} °C for ${nfmt(c.duration)} ${esc(c.duration_unit || 'hours')} (accepted ${nfmt(c.window_min)} to ${nfmt(c.window_max)} ${esc(c.duration_unit || 'hours')}). Put the plates in an incubator as loads: select rows, then <b>Put in an incubator</b>; take each load out when done. A load outside the window or temperature needs a note.</div>`;
  if (s.step_type === 'Split off Test') return `<div class="tbnote">Completing this step raises a request to order <b>${esc(d.splitTestName || 'the split-off test')}</b> for every sample with a finding${c.trigger === 'Always' ? ' (this step splits off every sample)' : ''}. ${c.consent_required === false ? 'No customer consent is needed (step setting): the test is ordered at once from the client\'s accepted quote, or waits as To order when it is not quoted.' : 'The customer\'s consent is recorded on the sample page or the backlog; ordering the test closes the request.'}</div>`;
  return '';
}

// ---------------------------------------------------------------- grids per step type
// A bench grid: new values are recorded under your name; changing a recorded value is a correction and asks for a reason.
// a value that is now recorded: a later change to it is a correction (needs a reason). had: true/false, or one flag
// per analyte (a_<id>) or per weighing (w<k>)
const markHad = (had, ch) => {
  if (had && typeof had === 'object') { const h = { ...had }; for (const f of Object.keys(ch)) { const m = /^(?:a_|w)(.+)$/.exec(f); if (m && ch[f] !== null && ch[f] !== undefined && ch[f] !== '') h[m[1]] = true; } return h; }
  return true;
};
function benchGrid(host, ctx, s, { rows, columns, canWork, toValues, toolbar }) {
  const orig = new Map(rows.map((r) => [r.key, r]));
  const g = editableGrid({
    el: host, rows, columns, readOnly: !canWork, needReason: false, toolbar, emptyText: 'Nothing to record here.',
    rowClass: (r) => (r.run_no > 1 ? 'tbrerun' : ''),
    // saved as it is typed (0.27.0); a correction still asks for its reason first
    autosave: true,
    autosaved: (changes) => { for (const ch of changes) { const o = orig.get(ch.key); if (o) orig.set(ch.key, { ...o, ...ch, had: markHad(o.had, ch) }); } },
    save: async (changes) => {
      const vals = []; let correction = false;
      for (const ch of changes) {
        const r = { ...orig.get(ch.key), ...ch };
        for (const v of toValues(r, orig.get(ch.key), ch)) { vals.push(v); if (v.correction) correction = true; }
      }
      let reason = '';
      if (correction) { reason = await askReason('recorded bench values (a correction)'); if (reason === null) throw new Error('Not saved: changing a recorded value needs a reason.'); }
      await api(`/testing/step-runs/${s.id}/values`, { method: 'POST', body: { reason, rows: vals.map(({ correction: _c, ...v }) => v) } });
    },
    afterSave: () => ctx.reload(),
  });
  g.o.keyField = 'key';
  ctx.benchGrids = [...(ctx.benchGrids || []), g];
  return g;
}

function batchingGrid(host, ctx, s, canWork) {
  const { d } = ctx;
  const samples = active(d).filter((e) => e.entry_type === 'Sample');
  const rows = d.entries.map((e) => ({ key: e.id, entry_id: e.id, ...e, kind: kindOf(e) }));
  const g = editableGrid({
    el: host, rows, readOnly: !canWork, needReason: false, emptyText: 'No entries.',
    rowClass: (r) => (r.status === 'Superseded' ? 'tbsup' : ''),
    columns: [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 170 },
      { field: 'qc_class', title: 'QC class', type: 'readonly', width: 85 },
      { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 130 },
      { field: 'matrix', title: 'Matrix', type: 'readonly', width: 100 },
      { field: 'due_date', title: 'Due', type: 'readonly', width: 95, format: day },
      { field: 'rush_status', title: 'Rush', type: 'readonly', width: 95, format: (v) => (v && v !== 'None' ? v : '') },
      { field: 'parent_entry_id', title: 'Spiked sample', type: 'select', width: 160, help: 'The sample a matrix spike (and its duplicate) is made from',
        options: samples.map((x) => ({ value: x.id, label: x.label })), editable: (r) => ['Matrix Spike', 'Matrix Spike Duplicate'].includes(r.qc_type) },
      { field: 'status', title: 'Status', type: 'readonly', width: 200, compute: (r) => (r.status === 'Superseded' ? r.superseded_reason || 'Superseded' : r.daily_batch_code ? `The day's control, recorded in ${r.daily_batch_code}` : ''),
        href: (r) => (r.daily_batch_id && r.status !== 'Superseded' ? '#/testing/batches/' + r.daily_batch_id : null) },
    ],
    save: async (changes) => {
      for (const ch of changes) await api(`/testing/entries/${ch.key}/parent`, { method: 'POST', body: { parent_entry_id: ch.parent_entry_id || null } });
    },
    afterSave: () => ctx.reload(),
  });
  g.o.keyField = 'key';
  return g;
}

function weighingGrid(host, ctx, s, canWork) {
  const { d } = ctx; const c = s.config || {}; const unit = c.unit || 'g';
  const single = (c.target_mode === 'Single' || (!c.target_mode && c.target !== undefined && c.target !== null)) && c.target !== null && c.target !== undefined;
  const pct = c.tolerance_unit === '%';
  const lo = single ? c.target - (pct ? c.target * c.tolerance / 100 : c.tolerance || 0) : null; const hi = single ? c.target + (pct ? c.target * c.tolerance / 100 : c.tolerance || 0) : null;
  // replicate weighings (migration 033): one column per weighing, and their average (the step's weight)
  const reps = Math.max(1, Math.min(10, Number(c.replicates) || 1));
  if (reps > 1) return replicateWeighingGrid(host, ctx, s, canWork, reps, unit);
  const rows = benchEntries(d).map((e) => {
    const v = valueOf(d, s.id, e.id, null, 1);
    return { key: e.id, entry_id: e.id, ...e, kind: kindOf(e), weight: v ? (v.value_num === null ? null : Number(v.value_num)) : null, had: !!(v && v.value_num !== null), entered_by: v?.entered_by || '',
      aliquot: v && v.logbook_entry_id ? (v.data || {}).aliquot || 'aliquot' : '', aliquot_id: v ? v.logbook_entry_id : null,
      weighed: isWeighed(c, e), range: weightRange(c, e) };
  });
  const outside = (r) => r.range && r.weight !== null && r.weight !== undefined && r.weight !== '' && (Number(r.weight) < r.range.lo - 1e-12 || Number(r.weight) > r.range.hi + 1e-12);
  return benchGrid(host, ctx, s, { rows, canWork,
    columns: [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 170 },
      { field: 'matrix', title: 'Matrix', type: 'readonly', width: 100 },
      { field: 'weight', title: `Weight (${unit})`, type: 'number', width: 110, validate: (v) => (v !== null && v <= 0 ? 'A weight must be above zero' : null), editable: (r) => !r.aliquot_id && r.weighed },
      { field: 'aliquot', title: 'Aliquot', type: 'link', width: 115, href: (r) => (r.aliquot_id ? '#/logbooks/entries/' + r.aliquot_id : null), help: 'Weighed in the sample weights logbook and scanned here (Scan aliquot)' },
      { field: 'check', title: 'Check', type: 'readonly', width: 120, compute: (r) => (!r.range || r.weight === null || r.weight === undefined || r.weight === '' ? '' : outside(r) ? 'Outside the range' : 'In range'),
        cellClass: (r) => (outside(r) ? 'tbfail' : '') },
      { field: 'product_category', title: 'Category', type: 'readonly', width: 130 },
      { field: 'range', title: 'Accepted', type: 'readonly', width: 130, compute: (r) => (!r.weighed ? 'Not weighed' : r.range ? `${nfmt(+r.range.lo.toPrecision(6))} to ${nfmt(+r.range.hi.toPrecision(6))}` : '') },
      { field: 'balance', title: 'Balance', type: 'readonly', width: 150, compute: (r) => usedFor(d.equipment_used, s.id, r.entry_id).map((x) => x.equipment_code).join(', '),
        links: (r) => usedFor(d.equipment_used, s.id, r.entry_id).map((x) => eqLink(x)) },
      { field: 'spike', title: 'Spike', type: 'readonly', width: 200, compute: (r) => usedFor(d.materials, s.id, r.entry_id).filter((x) => x.purpose === 'Spike').map((x) => `${x.lot_code} ${nfmt(x.volume)} ${x.volume_unit || ''}`).join(', '),
        links: (r) => usedFor(d.materials, s.id, r.entry_id).filter((x) => x.purpose === 'Spike').map((x) => lotLink(x, `${nfmt(x.volume)} ${x.volume_unit || ''}`.trim())) },
      { field: 'entered_by', title: 'Recorded by', type: 'readonly', width: 140 },
    ],
    toValues: (r, o) => [{ entry_id: r.entry_id, value_num: r.weight, correction: o.had }],
  });
}

// N weights per entry (paste a row of 10 weights from the balance printout, or fill them in); the average is worked out
// by the database once all N are in (entry_weight), and shown here
function replicateWeighingGrid(host, ctx, s, canWork, reps, unit) {
  const { d } = ctx;
  const ks = Array.from({ length: reps }, (_, i) => i + 1);
  const rows = benchEntries(d).map((e) => {
    const r = { key: e.id, entry_id: e.id, ...e, kind: kindOf(e), had: {} };
    for (const k of ks) { const v = valueOf(d, s.id, e.id, null, k); r['w' + k] = v && v.value_num !== null ? Number(v.value_num) : null; r.had[k] = !!(v && v.value_num !== null); }
    return r;
  });
  const avg = (r) => { const w = ks.map((k) => r['w' + k]); return w.every((x) => x !== null && x !== undefined && x !== '') ? w.reduce((a, b) => a + Number(b), 0) / reps : null; };
  return benchGrid(host, ctx, s, { rows, canWork,
    columns: [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 150 },
      ...ks.map((k) => ({ field: 'w' + k, title: `${k}`, type: 'number', width: 72, help: `Weighing ${k} of ${reps} (${unit})`, validate: (v) => (v !== null && v <= 0 ? 'A weight must be above zero' : null) })),
      { field: 'avg', title: `Average (${unit})`, type: 'readonly', width: 120, compute: (r) => { const a = avg(r); return a === null ? `${ks.filter((k) => r['w' + k] !== null && r['w' + k] !== undefined).length} of ${reps}` : String(Number(a.toPrecision(6))); } },
      { field: 'balance', title: 'Balance', type: 'readonly', width: 150, compute: (r) => usedFor(d.equipment_used, s.id, r.entry_id).map((x) => x.equipment_code).join(', '),
        links: (r) => usedFor(d.equipment_used, s.id, r.entry_id).map((x) => eqLink(x)) },
    ],
    toValues: (r, o, ch) => ks.filter((k) => ('w' + k) in ch).map((k) => ({ entry_id: r.entry_id, run_no: k, value_num: r['w' + k], correction: o.had[k] })),
  });
}

function preparationForm(host, ctx, s, canWork) {
  const fields = (s.config || {}).fields || [];
  const vals = s.fields || {};
  host.innerHTML = fields.length ? `<div class="tbform">${fields.map((f) => {
    const k = fieldKey(f.label); const t = f.type === 'Number' ? 'number' : f.type === 'Date' ? 'date' : f.type === 'Time' ? 'time' : 'text';
    return `<div class="field"><label for="pf_${k}">${esc(f.label)}</label><input id="pf_${k}" data-k="${k}" type="${t}" ${t === 'number' ? 'step="any"' : ''} value="${esc(vals[k] ?? '')}" ${canWork ? '' : 'disabled'}></div>`;
  }).join('')}</div>${canWork ? '<button class="btn primary" id="pf_save">Save</button>' : ''}<div class="help" style="margin-top:6px">Filled once for the whole batch. Number fields feed the calculation.</div>`
    : '<div class="tbnote">This step has no fields to fill in; complete it when the preparation is done.</div>';
  const sv = host.querySelector('#pf_save');
  if (sv) sv.onclick = async () => {
    const out = {}; let correction = false;
    host.querySelectorAll('[data-k]').forEach((i) => { const v = i.value.trim(); if (v !== '') out[i.dataset.k] = v; if ((vals[i.dataset.k] ?? '') !== '' && String(vals[i.dataset.k]) !== v) correction = true; });
    let reason = '';
    if (correction) { reason = await askReason(`${s.step_name}: changed fields (a correction)`); if (reason === null) return; }
    try { await api(`/testing/step-runs/${s.id}/fields`, { method: 'POST', body: { fields: out, reason } }); toast('Saved.'); ctx.reload(); } catch (e) { toast(e.message, 'err'); }
  };
}

function dilutionGrid(host, ctx, s, canWork) {
  const { d } = ctx; const c = s.config || {}; const n = Math.min(Math.max(Number(c.fields_per_entry) || 1, 1), 4);
  const factor = (r) => { let f = null; for (let i = 1; i <= n; i++) { const a = Number(r['a' + i]); if (r['a' + i] !== null && r['a' + i] !== undefined && r['a' + i] !== '' && a > 0) f = (f || 1) * (a + (Number(r['d' + i]) || 0)) / a; } return f; };
  const finalVol = (r) => { let v = null; for (let i = 1; i <= n; i++) { const a = Number(r['a' + i]); if (r['a' + i] !== null && r['a' + i] !== undefined && r['a' + i] !== '' && a > 0) v = a + (Number(r['d' + i]) || 0); } return v; };
  const rows = benchEntries(d).map((e) => {
    const v = valueOf(d, s.id, e.id, null, 1); const f = v?.data?.fields || []; const r = { key: e.id, entry_id: e.id, ...e, kind: kindOf(e), had: !!(v && f.length), entered_by: v?.entered_by || '', expected: dilutionExpected(c, e) };
    for (let i = 1; i <= n; i++) { r['a' + i] = f[i - 1]?.aliquot ?? null; r['d' + i] = f[i - 1]?.diluent ?? null; }
    return r;
  });
  const cols = [
    { field: 'position', title: '#', type: 'readonly', width: 40 },
    { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
    { field: 'kind', title: 'Type', type: 'readonly', width: 150 },
  ];
  const differs = (r) => r.expected && r.a1 !== null && r.a1 !== undefined && r.a1 !== '' && (Math.abs(Number(r.a1) - r.expected.aliquot) > 1e-9 || Math.abs((Number(r.d1) || 0) - r.expected.diluent) > 1e-9);
  for (let i = 1; i <= n; i++) cols.push({ field: 'a' + i, title: n > 1 ? `Aliquot ${i}` : 'Aliquot', type: 'number', width: 80, min: 0 }, { field: 'd' + i, title: n > 1 ? `Diluent ${i}` : 'Diluent', type: 'number', width: 80, min: 0 });
  cols.forEach((x) => { if (x.field === 'a1' || x.field === 'd1') x.cellClass = (r) => (differs(r) ? 'flag' : ''); });
  cols.push({ field: 'factor', title: 'Factor', type: 'readonly', width: 75, compute: (r) => nfmt(factor(r)) }, { field: 'final', title: 'Final volume', type: 'readonly', width: 95, compute: (r) => nfmt(finalVol(r)) },
    { field: 'exp', title: 'Expected', type: 'readonly', width: 150, help: 'The amounts for the sample\'s product category (its matrix), or the step\'s default',
      compute: (r) => (r.expected ? `${nfmt(r.expected.aliquot)} + ${nfmt(r.expected.diluent)}${r.expected.from ? ' (' + r.expected.from + ')' : ''}` : '') },
    { field: 'entered_by', title: 'Recorded by', type: 'readonly', width: 140 },
    // 0.27.0: further dilutions recorded with later analytical runs (each run's readings use their own)
    { field: 'further', title: 'Later runs', type: 'readonly', width: 180, help: 'Further dilutions recorded with an analytical run (Add analytical run); that run\'s readings use them',
      compute: (r) => d.values.filter((v) => v.step_run_id === s.id && v.entry_id === r.entry_id && !v.analyte_id && Number(v.run_no) > 1)
        .sort((a, b) => Number(a.run_no) - Number(b.run_no)).map((v) => `Run ${v.run_no}: ×${nfmt(+dilFactor(v.data).toPrecision(6))}`).join(', ') });
  const g = benchGrid(host, ctx, s, { rows, canWork, columns: cols,
    toolbar: canWork && rows.some((r) => r.expected) ? `<button class="mini" id="dl_std">${(c.by_category || []).length ? 'Each sample\'s amounts (by its matrix) for empty rows' : `Standard dilution (${nfmt(c.aliquot)} + ${nfmt(c.diluent || 0)}) for empty rows`}</button>` : '',
    toValues: (r, o) => {
      const fields = []; for (let i = 1; i <= n; i++) if (r['a' + i] !== null && r['a' + i] !== undefined && r['a' + i] !== '') fields.push({ aliquot: Number(r['a' + i]), diluent: Number(r['d' + i]) || 0 });
      return [{ entry_id: r.entry_id, data: fields.length ? { fields } : {}, correction: o.had }];
    } });
  host.addEventListener('click', (ev) => {
    if (ev.target.id !== 'dl_std') return;
    const ai = g.cols.findIndex((x) => x.field === 'a1'); const di = g.cols.findIndex((x) => x.field === 'd1');
    g.rows.forEach((r, ri) => { if ((r.a1 === null || r.a1 === undefined || r.a1 === '') && r.expected) { g.setCell(ri, ai, String(r.expected.aliquot)); g.setCell(ri, di, String(r.expected.diluent)); } });
    g.render(); g._changed();
  });
  return g;
}

// 0.27.0 (migration 048): each analytical run can have its own dilution; a reading uses its run's (the latest at or before it)
const dilutionSteps = (d) => d.steps.filter((x) => x.step_type === 'Dilution');
const dilFactor = (data) => { let f = null; for (const p of (data && data.fields) || []) { const a = Number(p.aliquot); if (a > 0) f = (f || 1) * (a + (Number(p.diluent) || 0)) / a; } return f; };
function entryDilution(d, entry, run) {
  for (const ds of dilutionSteps(d)) {
    const v = d.values.filter((x) => x.step_run_id === ds.id && x.entry_id === entry && !x.analyte_id && Number(x.run_no) <= run).sort((a, b) => Number(b.run_no) - Number(a.run_no))[0];
    if (v) return dilFactor(v.data);
  }
  return null;
}
const readingDilution = (d, s, r) => entryDilution(d, r.entry_id, runOfReading(d, s.id, r.entry_id, r.run_no));
function pickText(d, r) {
  const e = d.entries.find((x) => x.id === r.entry_id);
  const ps = (d.picks || []).filter((p) => e && p.requested_test_id === e.requested_test_id && p.entry_id === r.entry_id && Number(p.run_no) === Number(r.run_no));
  return ps.map((p) => `✓ ${p.analyte_name || 'All analytes'}: ${p.note}`).join('; ');
}
// the analyst picks the reading reported for the sample (all analytes, or one), with a note
async function pickReading(ctx, s, row) {
  const { d } = ctx;
  if (!row) { toast('Select the reading to report first (click its row).', 'err'); return; }
  const e = d.entries.find((x) => x.id === row.entry_id);
  if (!e || e.entry_type !== 'Sample') { toast('Pick a sample\'s reading (QC readings are judged, not picked).', 'err'); return; }
  const f = readingDilution(d, s, row);
  const m = await modal({ title: `Report ${rlabel(e.label, row.run_no)}`, okText: 'Pick it',
    intro: `Reading ${row.run_no} of ${esc(e.label)}${f ? `, made at ×${esc(nfmt(+f.toPrecision(6)))}` : ''}. QC Review reports it unless the reviewer chooses otherwise; your note goes with it.`,
    fields: [{ name: 'analyte_id', label: 'For', type: 'select', blank: false, value: '', options: [{ value: '', label: 'Every analyte of the sample' }, ...d.analytes.map((a) => ({ value: a.analyte_id, label: a.analyte_name }))] },
      { name: 'note', label: 'Why this reading (e.g. run 1 was over the calibration range)', type: 'textarea', required: true }] });
  if (!m) return;
  try { await api(`/testing/entries/${e.id}/pick`, { method: 'POST', body: { run_no: row.run_no, analyte_id: m.analyte_id || null, note: m.note } }); toast('Picked: QC Review will report this reading.'); ctx.reload(); }
  catch (err) { toast(err.message, 'err'); }
}

function readingGrid(host, ctx, s, canWork, curRun = 1) {
  const { d } = ctx; const c = s.config || {};
  const ids = c.analyte_ids && c.analyte_ids.length ? c.analyte_ids : null;
  const ans = d.analytes.filter((a) => !ids || ids.includes(a.analyte_id));
  const rows = [];
  for (const e of active(d)) {
    const runs = runsOf(d, s.id, e.id);
    for (let rn = 1; rn <= runs; rn++) {
      if (runOfReading(d, s.id, e.id, rn) !== curRun) continue;
      const r = { key: `${e.id}:${rn}`, entry_id: e.id, run_no: rn, ...e, label: rlabel(e.label, rn), kind: kindOf(e), had: {} };
      for (const a of ans) {
        const v = valueOf(d, s.id, e.id, a.analyte_id, rn);
        r['a_' + a.analyte_id] = v ? (a.result_type === 'Numeric' ? (v.value_num === null ? null : Number(v.value_num)) : v.value_text) : null;
        r.had[a.analyte_id] = !!(v && (v.value_num !== null || v.value_text));
      }
      rows.push(r);
    }
  }
  // readings that are not results (039): flagged until the entry has a valid reading in a later run
  const inv = (d.invalid_readings || []).filter((x) => x.step_run_id === s.id);
  const invOf = (r) => inv.find((x) => x.entry_id === r.entry_id && x.run_no === r.run_no);
  const notResult = (a, v) => (a.invalid_values || []).includes(v);
  const cols = [
    { field: 'position', title: '#', type: 'readonly', width: 40 },
    { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
    { field: 'kind', title: 'Type', type: 'readonly', width: 150 },
    { field: 'run_no', title: 'Reading', type: 'readonly', width: 65, help: 'Reading 2 and up (RA1-, RA2-...) come from added analytical runs; every reading is kept and the reviewer decides what is reported' },
    ...ans.map((a) => (a.result_type === 'Numeric'
      ? { field: 'a_' + a.analyte_id, title: `${a.analyte_name}${c.value_unit ? ` (${c.value_unit})` : ''}`, type: 'number', width: 115 }
      : { field: 'a_' + a.analyte_id, title: a.analyte_name, type: (a.result_values || []).length ? 'select' : 'text', options: a.result_values || [], width: 120,
          cellClass: (r) => (notResult(a, r['a_' + a.analyte_id]) ? 'tbfail' : '') })),
    { field: 'standard', title: 'Check standard', type: 'readonly', width: 150, compute: (r) => (['ICV', 'CCV'].includes(r.qc_type) ? usedFor(d.materials, s.id, r.entry_id).filter((x) => x.purpose === 'Standard' && x.entry_id === r.entry_id).map((x) => x.lot_code).join(', ') || 'record it' : ''),
      links: (r) => (['ICV', 'CCV'].includes(r.qc_type) ? usedFor(d.materials, s.id, r.entry_id).filter((x) => x.purpose === 'Standard' && x.entry_id === r.entry_id).map((x) => lotLink(x)) : []),
      cellClass: (r) => (['ICV', 'CCV'].includes(r.qc_type) && !d.materials.some((x) => x.step_run_id === s.id && x.entry_id === r.entry_id && x.purpose === 'Standard') ? 'flag' : '') },
    { field: 'rerun', title: 'Re-run', type: 'readonly', width: 150, help: 'A reading that is not a result (e.g. Indeterminate, Signal error): read it again in a new analytical run (right-click the row)',
      compute: (r) => { const x = invOf(r); return !x ? '' : x.replaced ? 'Read again' : 'Re-run required'; }, cellClass: (r) => { const x = invOf(r); return x && !x.replaced ? 'tbfail' : ''; } },
    // 0.27.0 (after the existing columns, which tests paste by number): the dilution of this reading's run, and the analyst's pick
    ...(dilutionSteps(d).length ? [{ field: 'dil', title: 'Dilution', type: 'readonly', width: 80, align: 'right', help: 'The dilution factor this reading was made on (its analytical run\'s)',
      compute: (r) => { const f = readingDilution(d, s, r); return f === null ? '' : '×' + nfmt(+f.toPrecision(6)); } }] : []),
    { field: 'picked', title: 'Reported', type: 'readonly', width: 220, help: 'The reading the analyst picked to report (QC Review uses it unless the reviewer chooses otherwise)',
      compute: (r) => pickText(d, r), cellClass: (r) => (pickText(d, r) ? 'tbpass' : '') },
  ];
  return benchGrid(host, ctx, s, { rows, canWork, columns: cols,
    toValues: (r, o, ch) => ans.filter((a) => ('a_' + a.analyte_id) in ch).map((a) => (a.result_type === 'Numeric'
      ? { entry_id: r.entry_id, analyte_id: a.analyte_id, run_no: r.run_no, value_num: r['a_' + a.analyte_id], correction: o.had[a.analyte_id] }
      : { entry_id: r.entry_id, analyte_id: a.analyte_id, run_no: r.run_no, value_text: r['a_' + a.analyte_id] ?? '', correction: o.had[a.analyte_id] })) });
}

// ---------------------------------------------------------------- micro (WD-4)
function platingGrid(host, ctx, s, canWork) {
  const { d } = ctx; const c = s.config || {};
  const rows = benchEntries(d).map((e) => {
    const v = valueOf(d, s.id, e.id, null, 1);
    return { key: e.id, entry_id: e.id, ...e, kind: kindOf(e), plates: v && v.value_num !== null ? Number(v.value_num) : null, levels: v?.data?.levels || null, had: !!(v && v.value_num !== null), entered_by: v?.entered_by || '' };
  });
  const g = benchGrid(host, ctx, s, { rows, canWork,
    toolbar: canWork ? `<button class="mini" id="pl_std">${nfmt(c.plates_per_entry || 1)} plate${Number(c.plates_per_entry || 1) === 1 ? '' : 's'} for empty rows</button>` : '',
    columns: [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 150 },
      { field: 'plates', title: 'Plates', type: 'int', width: 70, min: 0, help: '0 = not plated' },
      { field: 'levels', title: 'Levels plated', type: 'text', width: 140, help: 'e.g. 1:10, 1:100' },
      { field: 'media', title: 'Media lot', type: 'readonly', width: 160, compute: (r) => usedFor(d.materials, s.id, r.entry_id).filter((x) => x.purpose === 'Media').map((x) => x.lot_code).join(', '),
        links: (r) => usedFor(d.materials, s.id, r.entry_id).filter((x) => x.purpose === 'Media').map((x) => lotLink(x)),
        cellClass: (r) => (r.plates > 0 && !usedFor(d.materials, s.id, r.entry_id).some((x) => x.purpose === 'Media') ? 'flag' : '') },
      { field: 'strain', title: 'Strain', type: 'readonly', width: 150, compute: (r) => d.materials.filter((x) => x.entry_id === r.entry_id && x.purpose === 'Strain').map((x) => x.lot_code).join(', '),
        links: (r) => d.materials.filter((x) => x.entry_id === r.entry_id && x.purpose === 'Strain').map((x) => lotLink(x)) },
      { field: 'entered_by', title: 'Recorded by', type: 'readonly', width: 140 },
    ],
    toValues: (r, o) => [{ entry_id: r.entry_id, value_num: r.plates, data: r.levels ? { levels: r.levels } : {}, correction: o.had }] });
  host.addEventListener('click', (ev) => {
    if (ev.target.id !== 'pl_std') return;
    const pi = g.cols.findIndex((x) => x.field === 'plates');
    g.rows.forEach((r, ri) => { if (r.plates === null || r.plates === undefined || r.plates === '') g.setCell(ri, pi, String(c.plates_per_entry || 1)); });
    g.render(); g._changed();
  });
  return g;
}

function incubationPanel(host, ctx, s, canWork) {
  const { d, opts } = ctx;
  const loads = d.loads.filter((l) => l.step_run_id === s.id);
  const ents = benchEntries(d);
  const label = (id) => d.entries.find((e) => e.id === id)?.label || '';
  const loadsOf = (id) => loads.filter((l) => !l.entry_ids || l.entry_ids.includes(id));
  host.innerHTML = `<h3 style="margin:4px 0 6px">Entries</h3><div id="inc_e"></div><h3 style="margin:16px 0 6px">Incubator loads</h3><div id="inc_l"></div>`;
  const cfg = s.config || {}; const unitW = cfg.duration_unit === 'days' ? 'd' : 'h';
  const eg = new Grid(host.querySelector('#inc_e'), { readOnly: true, keyField: 'key', rows: ents.map((e) => ({ ...e, key: e.id, entry_id: e.id, kind: kindOf(e), win: incubationWindowOf(cfg, e) })),
    toolbar: canWork ? '<button class="mini" data-inc="new">Put in an incubator (the selected rows, or all)</button>' : '',
    columns: [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 160 },
      { field: 'window', title: 'Window', type: 'readonly', width: 170, help: 'The acceptable time: the sample\'s product category (its matrix) when the step sets one, else the step\'s',
        compute: (r) => (r.win.min === null || r.win.min === undefined ? '' : `${nfmt(r.win.min)} to ${nfmt(r.win.max)} ${unitW}${r.win.from ? ' (' + r.win.from + ')' : ''}`) },
      { field: 'load', title: 'Load', type: 'readonly', width: 380, compute: (r) => loadsOf(r.entry_id).map((l) => `${l.equipment_code} in ${loc(l.time_in)}${l.time_out ? ', out ' + loc(l.time_out) : ''}`).join('; ') || 'Not in an incubator yet',
        links: (r) => loadsOf(r.entry_id).map((l) => eqLink(l, `in ${loc(l.time_in)}${l.time_out ? ', out ' + loc(l.time_out) : ''}`)),
        cellClass: (r) => (loadsOf(r.entry_id).length ? '' : 'flag') },
    ] });
  host.addEventListener('click', async (ev) => {
    if (ev.target.dataset.inc !== 'new') return;
    const ids = [...new Set(eg.selectedRows().map((r) => r.entry_id))];
    const types = (s.equipment_types || []).map((t) => t.equipment_type_id);
    const list = opts.equipment.filter((e) => !types.length || types.includes(e.equipment_type_id));
    if (!list.length) { toast('This lab has no incubator of the type this step uses.', 'err'); return; }
    const m = await modal({ title: `Incubator load: ${s.step_name}`, okText: 'Start', intro: `For ${esc(forWhat(ctx, ids))}. The incubator must be available and in calibration.`,
      fields: [
        { name: 'equipment_id', label: 'Incubator', type: 'select', required: true, options: list.map((e) => ({ value: e.id, label: `${e.equipment_code} ${e.equipment_name}${e.availability !== 'Available' ? ' · ' + e.availability : ''}${e.calibration_status === 'Deficient' ? ' · out of calibration' : ''}` })) },
        { name: 'time_in', label: 'Time in', value: loc(new Date()), required: true, help: 'YYYY-MM-DD HH:MM (now by default)' },
        { name: 'temperature', label: 'Temperature read (°C)', type: 'number' },
      ] });
    if (!m) return;
    try { await api(`/testing/step-runs/${s.id}/loads`, { method: 'POST', body: { ...m, time_in: isoOf(m.time_in), entry_ids: ids } }); toast('Load started.'); ctx.reload(); } catch (e) { toast(e.message, 'err'); }
  });
  const rows = loads.map((l) => ({ ...l, key: l.id, entries: l.entry_ids ? l.entry_ids.map(label).join(', ') : 'Whole batch', tin: loc(l.time_in), tout: loc(l.time_out) }));
  const orig = new Map(rows.map((r) => [r.key, r]));
  const g = editableGrid({ el: host.querySelector('#inc_l'), rows, readOnly: !canWork, needReason: false, emptyText: 'No loads yet.',
    columns: [
      { field: 'equipment_code', title: 'Incubator', type: 'link', width: 95, href: (r) => '#/equipment/' + r.equipment_id },
      { field: 'entries', title: 'Holds', type: 'readonly', width: 230 },
      { field: 'tin', title: 'Time in', type: 'text', width: 140 },
      { field: 'tout', title: 'Time out', type: 'text', width: 140 },
      { field: 'duration', title: 'Duration', type: 'readonly', width: 90, compute: (r) => (r.duration === null || r.duration === undefined ? '' : `${nfmt(Number(r.duration).toFixed(1))} ${r.duration_unit === 'days' ? 'd' : 'h'}`) },
      { field: 'temperature', title: '°C', type: 'number', width: 60 },
      { field: 'check_text', title: 'Check', type: 'readonly', width: 230, cellClass: (r) => (r.check_text ? 'tbfail' : '') },
      { field: 'note', title: 'Note (why acceptable)', type: 'text', width: 230 },
      // the incubator's sensor over the whole load, when one is linked (0.25.0; after the existing columns, which tests paste by number)
      { field: 'sensor', title: 'Sensor during the load', type: 'readonly', width: 190, compute: (r) => (!r.sensor ? '' : !r.sensor.n ? 'No readings' : `${nfmt(r.sensor.lo)} to ${nfmt(r.sensor.hi)} °C (${r.sensor.n} readings)`) },
      { field: 'out', title: '', type: 'button', width: 85, label: (r) => (canWork && !r.time_out ? 'Take out' : ''),
        onClick: async (r) => { if (!canWork || r.time_out) return; try { await api(`/testing/loads/${r.id}`, { method: 'POST', body: { time_out: 'now' } }); toast('Taken out.'); ctx.reload(); } catch (e) { toast(e.message, 'err'); } } },
    ],
    save: async (changes) => {
      let correction = false; const bodies = [];
      for (const ch of changes) {
        const o = orig.get(ch.key); const body = {};
        if ('tin' in ch) { body.time_in = isoOf(ch.tin); correction = true; }
        if ('tout' in ch) { body.time_out = isoOf(ch.tout); if (o.time_out) correction = true; }
        if ('temperature' in ch) { body.temperature = ch.temperature; if (o.temperature !== null && o.temperature !== undefined) correction = true; }
        if ('note' in ch) body.note = ch.note;
        bodies.push([ch.key, body]);
      }
      let reason = '';
      if (correction) { reason = await askReason('recorded incubator loads (a correction)'); if (reason === null) throw new Error('Not saved: a correction needs a reason.'); }
      for (const [id, body] of bodies) await api(`/testing/loads/${id}`, { method: 'POST', body: { ...body, reason } });
    },
    afterSave: () => ctx.reload() });
  g.o.keyField = 'key';
  return eg;
}

function splitPanel(host, ctx, s) {
  const rows = ctx.d.splits.filter((x) => x.step_run_id === s.id);
  host.innerHTML = '<div id="sp_g"></div>';
  new Grid(host.querySelector('#sp_g'), { readOnly: true, rows, emptyText: s.status === 'Completed' ? 'No sample had a finding: nothing was split off.' : 'Requests appear when the step is completed.',
    columns: [
      { field: 'sample_code', title: 'Sample', type: 'link', width: 140, href: (r) => '#/samples/' + r.sample_id },
      { field: 'finding', title: 'Finding', type: 'readonly', width: 220 },
      { field: 'test_name', title: 'Test to order', type: 'readonly', width: 230 },
      { field: 'status', title: 'Status', type: 'readonly', width: 130, cellClass: (r) => (r.status === 'Awaiting consent' ? 'flag' : '') },
      { field: 'decided_by_name', title: 'Decision recorded by', type: 'readonly', width: 160 },
      { field: 'decision_note', title: 'Note', type: 'readonly', width: 240 },
      { field: 'alerts', title: 'Client alerted', type: 'readonly', width: 300, help: 'The presumptive result email (step setting "Alert the client"): who, and when it was queued in the Outbox',
        compute: (r) => alertText(r.alerts) },
    ] });
}
export function alertText(a) {
  const xs = Array.isArray(a) ? a : [];
  return xs.length ? `${xs.map((x) => x.to_name || x.to_address).join(', ')}, ${loc(xs[0].queued_at)} (${xs[0].by})` : '';
}

// Calculated results of a Calculation (or Hold Point) step: the value, rounded and reported as the test says, live
function calcGrid(host, ctx, s) {
  const { d } = ctx;
  const key = s.step_type === 'Calculation' ? s.step_key : null;
  const res = d.results.filter((x) => (key ? x.step_key === key : x.is_final) && d.entries.find((e) => e.id === x.entry_id)?.qc_class !== 'Analytical');
  return resultTable(host, d, res, s.step_type === 'Calculation' && !res.some((x) => x.is_final) ? 'value' : 'reported');
}
// "Waiting for {weigh.weight}" in words: the step's name and the value it gives
function humanWaiting(d, w) {
  return String(w).replace(/\{(\w+)\.(\w+)\}/g, (m, k, f) => {
    const st = d.steps.find((x) => x.step_key === k); if (!st) return m;
    const what = { weight: 'weight', factor: 'dilution factor', final_volume: 'final volume', reading: 'reading', result: 'result' }[f]
      || ((st.config?.fields || []).find((x) => fieldKey(x.label) === f)?.label) || f.replace(/_/g, ' ');
    return `${st.step_name}: ${what}`;
  });
}
function resultTable(host, d, res, show) {
  const rows = []; const by = new Map();
  for (const x of res) {
    const k = `${x.entry_id}:${x.run_no}`;
    if (!by.has(k)) { const e = d.entries.find((y) => y.id === x.entry_id); const ls = lastReadingStep(d);
      const r = { key: k, entry_id: x.entry_id, run_no: x.run_no, ...e, label: rlabel(e.label, x.run_no), run: ls ? runOfReading(d, ls.id, x.entry_id, x.run_no) : 1, kind: kindOf(e), waiting: new Set() }; by.set(k, r); rows.push(r); }
    const r = by.get(k);
    r['a_' + x.analyte_id] = show === 'reported' && x.is_final ? (x.reported ?? '') : nfmt(x.value);
    if (x.waiting) r.waiting.add(humanWaiting(d, x.waiting));
  }
  rows.sort((a, b) => a.position - b.position || a.run_no - b.run_no);
  rows.forEach((r) => { r.waiting = [...r.waiting].join('; '); });
  const units = Object.fromEntries(d.analytes.map((a) => [a.analyte_id, a.reporting_unit]));
  return new Grid(host, { readOnly: true, rows, keyField: 'key', emptyText: 'No results yet.', rowClass: (r) => (r.run_no > 1 ? 'tbrerun' : ''),
    columns: [
      { field: 'position', title: '#', type: 'readonly', width: 40 },
      { field: 'label', title: 'Entry', type: 'link', width: 170, href: sampleHref },
      { field: 'kind', title: 'Type', type: 'readonly', width: 150 },
      { field: 'run', title: 'Run', type: 'readonly', width: 50, help: 'The analytical run the reading came from' },
      ...d.analytes.map((a) => ({ field: 'a_' + a.analyte_id, title: `${a.analyte_name}${units[a.analyte_id] ? ` (${units[a.analyte_id]})` : ''}`, type: 'readonly', width: 115, align: 'right' })),
      { field: 'waiting', title: 'Waiting for', type: 'readonly', width: 260, cellClass: () => 'tbwait' },
    ] });
}

function resultsPanel(el, ctx) {
  const { d, b, editable } = ctx;
  el.innerHTML = `<div class="card">${section('Results', 'Final results, calculated live from the bench data and reported as the test says (rounding, LOQ and LOD). Readings 2 and up (RA1-, RA2-...) are re-analyses in added analytical runs; the reviewer chooses what is reported, or the average.',
      editable ? '<button class="btn" id="rp">Re-prep selected samples</button>' : '')}<div id="res"></div></div>
    <div class="card">${section('QC verdicts', 'Each QC entry judged per analyte against the test\'s acceptance criteria: recoveries (check standards against the standard used, spikes against the amount spiked), RPD of the spike duplicate, blanks. Waiting means data is still missing.')}<div id="qc"></div></div>`;
  // check standards (ICV, CCV) have no sample result: they are judged on their reading under QC verdicts
  const g = resultTable(el.querySelector('#res'), d, d.results.filter((x) => x.is_final && d.entries.find((e) => e.id === x.entry_id)?.qc_class !== 'Analytical'), 'reported');
  const rp = el.querySelector('#rp');
  if (rp) rp.onclick = () => reprep(ctx, [...new Set(g.selectedRows().map((r) => r.entry_id))]);
  new Grid(el.querySelector('#qc'), { readOnly: true, rows: d.verdicts.map((v, i) => ({ ...v, key: i })), keyField: 'key', emptyText: 'This test has no QC criteria.',
    columns: [
      { field: 'label', title: 'QC entry', type: 'readonly', width: 180 },
      { field: 'analytical_run', title: 'Run', type: 'readonly', width: 50 },
      { field: 'limit_type', title: 'Check', type: 'readonly', width: 130 },
      { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 120 },
      { field: 'measured', title: 'Measured', type: 'readonly', width: 90, align: 'right', format: (v, r) => (v === null || v === undefined ? '' : nfmt(v) + (['Recovery %', 'RPD'].includes(r.limit_type) ? ' %' : '')) },
      { field: 'limit_text', title: 'Limit', type: 'readonly', width: 120 },
      { field: 'verdict', title: 'Verdict', type: 'readonly', width: 95, cellClass: (r) => ({ Pass: 'tbpass', Fail: 'tbfail' }[r.verdict] || 'tbwait') },
      { field: 'note', title: 'How', type: 'readonly', width: 380 },
    ] });
  if (b.status === 'Awaiting Review') el.insertAdjacentHTML('afterbegin', '<div class="tbnote">Every bench step is completed: this batch is <b>waiting for QC Review</b> (WD-3).</div>');
}

// ---------------------------------------------------------------- QC Review (WD-3; nested layout and step approvals, Alex 2026-10-13)
// Results are nested under each sample (the sample repeated down the side) and show only hits above the LOQ plus anything to
// act on; QC is nested under each QC entry and shows only the checks that failed or are waiting. "All analytes" shows everything.
const reviewView = { results: 'hits', qc: 'exceptions' };   // kept while the page is reloaded
const reviewOpen = new Map();                               // batch id -> Set of group keys the reviewer opened or closed
async function reviewPanel(host, ctx, s) {
  const { b, d } = ctx;
  const r = await api(`/testing/batches/${b.id}/review`);
  // OOS investigations of this batch's results (R-2): a nonconforming result is flagged with "Open OOS…", never opened by itself
  const oosFor = await api(`/oos/for?batch=${b.id}`).catch(() => ({ rows: [], can_open: false }));
  // a timepoint review (e.g. day 7) has its own panel: its steps, its results and the preliminary release (WD-5)
  const tp = s && (r.timepoints || []).find((x) => x.step_run_id === s.id);
  if (tp) return timepointPanel(host, ctx, r, tp);
  const can = r.can_review && !r.performer && b.status === 'Awaiting Review';
  const note = b.status === 'Approved' ? '' : b.status === 'Cancelled' ? '<div class="tbnote">This batch was cancelled.</div>'
    : b.status !== 'Awaiting Review' ? '<div class="tbnote">The batch comes to review when every bench step is completed.</div>'
    : !r.can_review ? '<div class="tbnote">Waiting for a reviewer: someone with testing.review in this lab (Lab Supervisor or QA by default).</div>'
    : r.performer ? '<div class="tbnote">You performed or witnessed a step of this batch, so someone else reviews it.</div>' : '';
  const marks = d.review_marks || [];
  const unmarked = marks.filter((m) => !m.mark_id).length;
  host.innerHTML = `${note}
    ${can ? (r.problems.length ? `<div class="tbtodo"><b>To resolve before approval</b><ul>${r.problems.slice(0, 10).map((p) => `<li>${esc(p)}</li>`).join('')}${r.problems.length > 10 ? `<li>and ${r.problems.length - 10} more</li>` : ''}</ul></div>`
      : '<div class="tbnote"><b>Ready to approve.</b> Every step is approved; approving the batch stores the chosen results and compares them with each sample\'s specification.</div>') : ''}
    ${can ? `<div class="tbacts" style="margin:6px 0 12px"><button class="btn primary" id="rv_ok" ${r.problems.length ? 'disabled title="Resolve the items listed first"' : ''}>Approve batch</button><button class="btn" id="rv_ret">Return to the analyst</button></div>` : ''}
    ${(d.invalid_readings || []).length ? `<div class="tbnote"><b>Readings that are not results</b> (never reported; each needs a valid reading in a later analytical run):
      ${d.invalid_readings.map((x) => `${esc(x.label)} ${esc(x.analyte_name)}: ${esc(x.value_text)} (run ${x.analytical_run})${x.replaced ? ', read again' : ', <b>not read again yet</b>'}`).join(' · ')}</div>` : ''}
    ${(r.timepoints || []).length ? `<div class="tbnote"><b>Timepoint reviews</b> (released on their own as preliminary results; carried into the final results unchanged):
      ${r.timepoints.map((x) => `${link(`#/testing/batches/${b.id}?step=${x.step_key}`, x.step_name)}: ${x.released ? `released by ${esc(x.released_by_name || '')} ${esc(dt(x.released_at))}` : x.ready ? 'ready for review' : 'waiting for its steps'}`).join(' · ')}</div>` : ''}
    ${marks.length && b.status !== 'Cancelled' ? `<h3 style="margin:14px 0 6px">Steps ${b.status === 'Awaiting Review' ? `<small class="tbmuted">${unmarked ? `${unmarked} of ${marks.length} still to approve: open each step, check it, then approve it` : 'all approved'}</small>` : ''}</h3><div id="rv_steps"></div>` : ''}
    <div class="rvhead"><h3>${b.status === 'Approved' ? 'Stored results' : 'Results to report'}</h3>
      <div class="rvswitch" data-sw="results"><button data-v="hits" class="${reviewView.results === 'hits' ? 'on' : ''}">Hits above the LOQ and items to check</button><button data-v="all" class="${reviewView.results === 'all' ? 'on' : ''}">All analytes</button></div></div>
    <div id="rv_res"></div>
    ${(r.loads || []).length ? '<h3 style="margin:14px 0 6px">Incubator loads outside their target</h3><div id="rv_loads"></div>' : ''}
    <div id="rv_flags"></div><div id="rv_aliq"></div>
    <div class="rvhead"><h3>QC</h3>
      <div class="rvswitch" data-sw="qc"><button data-v="exceptions" class="${reviewView.qc === 'exceptions' ? 'on' : ''}">Failing or waiting only</button><button data-v="all" class="${reviewView.qc === 'all' ? 'on' : ''}">All analytes</button></div></div>
    <div id="rv_qc"></div><div id="rv_trend"></div>`;
  reviewTrends(host.querySelector('#rv_trend'), b.id);
  host.querySelectorAll('.rvswitch').forEach((sw) => sw.querySelectorAll('button').forEach((bt) => { bt.onclick = () => { reviewView[sw.dataset.sw] = bt.dataset.v; reviewPanel(host, ctx).catch((e) => toast(e.message, 'err')); }; }));
  if (!reviewOpen.has(b.id)) reviewOpen.set(b.id, new Map());
  const opened = reviewOpen.get(b.id);   // group key -> true/false once the reviewer has toggled it
  const isOpen = (key, dflt) => (opened.has(key) ? opened.get(key) : dflt);
  const toggleCol = (grid, rows, key) => ({ field: '_t', title: '', type: 'button', width: 44, label: (x) => (isOpen(key(x), x._dflt) ? '▾' : '▸'),
    onClick: (x) => { opened.set(key(x), !isOpen(key(x), x._dflt)); grid().render(); } });

  // ---- steps: each approved by the reviewer with a click (a recorded mark); one signature approves the batch
  const st = host.querySelector('#rv_steps');
  if (st) new Grid(st, { readOnly: true, rows: marks.map((m, i) => ({ ...m, key: i, n: i + 1, step_key: d.steps.find((s) => s.id === m.step_run_id)?.step_key })), keyField: 'key',
    rowClass: (m) => (m.mark_id ? '' : 'tbrerun'),
    columns: [
      { field: 'n', title: '#', type: 'readonly', width: 40 },
      { field: 'step_name', title: 'Step', type: 'link', width: 220, href: (m) => `#/testing/batches/${b.id}?step=${m.step_key}`, help: 'Opens the step as the analyst recorded it (read only)' },
      { field: 'step_type', title: 'Type', type: 'readonly', width: 150 },
      { field: 'mk', title: 'Review', type: 'readonly', width: 280, compute: (m) => (m.mark_id ? `Approved by ${m.marked_by_name} ${dt(m.marked_at)}` : 'Not approved yet'),
        cellClass: (m) => (m.mark_id ? 'tbpass' : 'tbwait') },
      { field: 'act', title: '', type: 'button', width: 120, label: (m) => (!can ? '' : m.mark_id ? 'Undo' : 'Approve step'), onClick: (m) => can && markStep(ctx, m.step_run_id, !!m.mark_id) },
    ] });

  // ---- results: one row per sample, its analytes nested under it
  const specText = (x) => (x.spec_text || [x.spec_min !== null && x.spec_min !== undefined ? '≥ ' + nfmt(x.spec_min) : '', x.spec_max !== null && x.spec_max !== undefined ? '≤ ' + nfmt(x.spec_max) : ''].filter(Boolean).join(' and ')) + (x.spec_unit && !x.spec_text ? ' ' + x.spec_unit : '');
  const confCls = (x) => (x.conformance === 'Does not conform' ? 'tbfail' : x.conformance === 'Conforms' ? 'tbpass' : '');
  const oosOf = (x) => oosFor.rows.find((o) => o.requested_test_id === x.requested_test_id && o.analyte_id === x.analyte_id);
  const oosLabel = (x) => { const o = oosOf(x); if (o) return o.oos_code + (o.status === 'Closed' ? ' (closed)' : ''); return x.conformance === 'Does not conform' && x.chosen && !x.result_key && oosFor.can_open && b.status !== 'Cancelled' ? 'Open OOS…' : ''; };
  const oosClick = async (x) => {
    const o = oosOf(x); if (o) { location.hash = '#/oos/' + o.id; return; }
    if (x.conformance !== 'Does not conform' || !x.chosen || x.result_key || !oosFor.can_open) return;
    try { await openOos({ requested_test_id: x.requested_test_id, analyte_id: x.analyte_id, batch_id: b.id, label: `${x.analyte_name} ${x.reported ?? x.value_text ?? ''}${x.unit ? ' ' + x.unit : ''} in ${x.sample_label} (${b.batch_code})` }); } catch (e) { toast(e.message, 'err'); }
  };
  const approved = b.status === 'Approved';
  const items = approved
    ? r.stored.map((x) => ({ ...x, group: x.requested_test_id, sample_label: x.sample_code || x.client_sample_id, chosen: true }))
    : r.items.map((x) => ({ ...x, group: x.requested_test_id, key: `${x.requested_test_id}|${x.analyte_id}`, n: x.candidates.length,
      chosen: !!x.chosen_entry_id, sample_id: d.entries.find((e) => e.requested_test_id === x.requested_test_id)?.sample_id }));
  // what is shown under a sample: hits above the LOQ, plus anything to act on (a reading to choose, no result, out of specification)
  const shown = (x) => reviewView.results === 'all' || x.hit || !x.chosen || x.conformance === 'Does not conform';
  const samples = [];
  for (const x of items) {
    let s = samples.find((y) => y.group === x.group);
    if (!s) { s = { group: x.group, key: x.group, sample_label: x.sample_label, sample_id: x.sample_id, matrix: d.entries.find((e) => e.requested_test_id === x.group)?.matrix || '', rows: [] }; samples.push(s); }
    s.rows.push(x);
  }
  samples.forEach((s) => {
    s.hits = s.rows.filter((x) => x.hit).length; s.todo = s.rows.filter((x) => !x.chosen).length; s.out = s.rows.filter((x) => x.conformance === 'Does not conform').length;
    s.vis = s.rows.filter(shown); s._dflt = s.vis.length > 0;
    s.summary = `${s.rows.length} analyte${s.rows.length === 1 ? '' : 's'} · ${s.hits ? `${s.hits} above the LOQ` : 'nothing above the LOQ'}${s.todo ? ` · ${s.todo} to choose` : ''}${s.out ? ` · ${s.out} out of specification` : ''}`;
  });
  let sg = null;
  sg = new Grid(host.querySelector('#rv_res'), { readOnly: true, rows: samples, keyField: 'key', emptyText: 'No samples in this batch.',
    rowClass: (s) => (s.out ? 'rvout' : ''),
    detail: { open: (s) => isOpen('s:' + s.group, s._dflt), key: (s) => 's:' + s.group + ':' + reviewView.results, render: (s, node) => sampleRows(s, node) },
    columns: [
      toggleCol(() => sg, samples, (s) => 's:' + s.group),
      { field: 'sample_label', title: 'Sample', type: 'link', width: 150, href: (s) => (s.sample_id ? '#/samples/' + s.sample_id : null) },
      { field: 'matrix', title: 'Matrix', type: 'readonly', width: 120 },
      { field: 'summary', title: 'Analytes', type: 'readonly', width: 420 },
      { field: 'conf', title: 'Conformance', type: 'readonly', width: 150, compute: (s) => (s.out ? 'Does not conform' : s.rows.some((x) => x.conformance === 'Conforms') ? 'Conforms' : ''), cellClass: (s) => (s.out ? 'tbfail' : '') },
    ] });
  function sampleRows(s, node) {
    if (!s.vis.length) { node.innerHTML = `<div class="rvnone">Nothing above the LOQ and nothing to check (${s.rows.length} analyte${s.rows.length === 1 ? '' : 's'}). "All analytes" shows them.</div>`; return; }
    const cols = [
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
      { field: 'conformance', title: 'Conformance', type: 'readonly', width: 135, cellClass: confCls },
      { field: 'oos', title: 'OOS', type: 'button', width: 130, label: oosLabel, onClick: oosClick,
        help: 'An out-of-specification result is flagged, not investigated by itself: correct the sample details or specification if they were wrong, otherwise open the investigation' },
      ...(approved ? [{ field: 'approved_by_name', title: 'Approved by', type: 'readonly', width: 150 }] : []),
    ];
    return new Grid(node, { rows: s.vis, columns: cols, readOnly: true, keyField: 'key', rowClass: (x) => (!x.chosen ? 'tbrerun' : '') });
  }

  // ---- incubator loads outside their window or temperature: the reviewer accepts each (WD-5.1)
  if ((r.loads || []).length) loadsGrid(host.querySelector('#rv_loads'), ctx, r.loads, can);
  flagsCard(host.querySelector('#rv_flags'), ctx, can);   // equipment flagged by its logbook (L-1, migration 034)
  aliquotsCard(host.querySelector('#rv_aliq'), ctx);       // weighed aliquots of the batch's samples (L-2, migration 035)

  // ---- QC: one row per QC entry, its checks per analyte nested under it
  const acc = (v) => r.accepted.find((q) => q.entry_id === v.entry_id && (q.analyte_id || null) === (v.analyte_id || null) && q.limit_type === v.limit_type && Number(q.analytical_run || 1) === Number(v.analytical_run || 1));
  // a run's analytical QC counts only when the run holds a reported reading; a prep QC's first run always counts (WD-5)
  const used = (r.used_runs || [1]).map(Number);
  const counts = (v) => used.includes(Number(v.analytical_run || 1)) || (Number(v.analytical_run || 1) === 1 && d.entries.find((e) => e.id === v.entry_id)?.qc_class !== 'Analytical');
  const groups = [];
  r.verdicts.forEach((v, i) => {
    const gk = `${v.entry_id}:${v.analytical_run || 1}`;
    let gq = groups.find((x) => x.key === gk);
    if (!gq) { gq = { entry_id: v.entry_id, key: gk, run: Number(v.analytical_run || 1), label: v.label, qc_type: d.entries.find((e) => e.id === v.entry_id)?.qc_type || '', counts: counts(v), rows: [] }; groups.push(gq); }
    gq.rows.push({ ...v, key: i, acc: acc(v), counts: counts(v) });
  });
  groups.forEach((gq) => {
    const n = (k) => gq.rows.filter((x) => x.verdict === k).length;
    gq.fail = n('Fail'); gq.wait = n('Waiting'); gq.pass = n('Pass');
    gq.open_items = gq.counts ? gq.rows.filter((x) => ['Fail', 'Waiting'].includes(x.verdict) && !x.acc).length : 0;
    gq.vis = gq.rows.filter((x) => reviewView.qc === 'all' || (['Fail', 'Waiting'].includes(x.verdict) && x.counts)); gq._dflt = gq.vis.length > 0;
    gq.verdict = gq.fail ? 'Fail' : gq.wait ? 'Waiting' : 'Pass';
    gq.summary = `${gq.rows.length} check${gq.rows.length === 1 ? '' : 's'}: ${gq.pass} pass${gq.fail ? `, ${gq.fail} fail` : ''}${gq.wait ? `, ${gq.wait} waiting` : ''}${!gq.counts ? ' · not used: no reported reading comes from this run' : gq.open_items ? ` · ${gq.open_items} to accept or return` : (gq.fail || gq.wait) ? ' · accepted' : ''}`;
  });
  let qg = null;
  qg = new Grid(host.querySelector('#rv_qc'), { readOnly: true, rows: groups, keyField: 'key', emptyText: 'This test has no QC criteria.',
    rowClass: (gq) => (gq.counts ? '' : 'rvoff'),
    detail: { open: (gq) => isOpen('q:' + gq.key, gq._dflt), key: (gq) => 'q:' + gq.key + ':' + reviewView.qc, render: (gq, node) => qcRows(gq, node) },
    columns: [
      toggleCol(() => qg, groups, (gq) => 'q:' + gq.key),
      { field: 'label', title: 'QC entry', type: 'readonly', width: 190 },
      { field: 'run', title: 'Run', type: 'readonly', width: 50 },
      { field: 'qc_type', title: 'QC type', type: 'readonly', width: 170 },
      { field: 'summary', title: 'Checks', type: 'readonly', width: 380 },
      { field: 'verdict', title: 'Verdict', type: 'readonly', width: 95, cellClass: (gq) => ({ Pass: 'tbpass', Fail: 'tbfail' }[gq.verdict] || 'tbwait') },
    ] });
  function qcRows(gq, node) {
    if (!gq.vis.length) { node.innerHTML = `<div class="rvnone">${gq.counts ? `All ${gq.rows.length} check${gq.rows.length === 1 ? '' : 's'} pass.` : 'Not used for reporting (no reported reading comes from this run).'} "All analytes" shows them.</div>`; return; }
    return new Grid(node, { readOnly: true, rows: gq.vis, keyField: 'key',
      columns: [
        { field: 'label', title: 'QC entry', type: 'readonly', width: 160, help: 'Repeated on every row so a long analyte list keeps its place' },
        { field: 'limit_type', title: 'Check', type: 'readonly', width: 120 },
        { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 120 },
        { field: 'measured', title: 'Measured', type: 'readonly', width: 85, align: 'right', format: (v, x) => (v === null || v === undefined ? '' : nfmt(v) + (['Recovery %', 'RPD'].includes(x.limit_type) ? ' %' : '')) },
        { field: 'limit_text', title: 'Limit', type: 'readonly', width: 110 },
        { field: 'verdict', title: 'Verdict', type: 'readonly', width: 85, cellClass: (x) => ({ Pass: 'tbpass', Fail: 'tbfail' }[x.verdict] || 'tbwait') },
        { field: 'accepted', title: 'Accepted', type: 'readonly', width: 300, compute: (x) => (x.acc ? `${x.acc.accepted_by}: ${x.acc.justification}` : '') },
        { field: 'act', title: '', type: 'button', width: 90, label: (x) => (can && x.counts && ['Fail', 'Waiting'].includes(x.verdict) && !x.acc ? 'Accept…' : ''),
          onClick: async (x) => {
            if (!can || !x.counts || !['Fail', 'Waiting'].includes(x.verdict) || x.acc) return;
            const m = await modal({ title: `Accept ${x.label} ${x.analyte_name || ''} ${x.limit_type}`, okText: 'Accept', intro: `Verdict: <b>${esc(x.verdict)}</b>${x.measured !== null && x.measured !== undefined ? ` (${esc(nfmt(x.measured))})` : ''}, limit ${esc(x.limit_text || '')}. Write why the batch can still be reported (it is kept with your name).`,
              fields: [{ name: 'justification', label: 'Justification', type: 'textarea', required: true }] });
            if (!m) return;
            try { await api(`/testing/batches/${b.id}/accept-qc`, { method: 'POST', body: { entry_id: x.entry_id, analyte_id: x.analyte_id, limit_type: x.limit_type, justification: m.justification, analytical_run: x.analytical_run || 1 } }); toast('QC accepted with your justification.'); ctx.reload(); }
            catch (e) { toast(e.message, 'err'); }
          } },
        { field: 'note', title: 'How', type: 'readonly', width: 280 },
      ] });
  }

  const ok = host.querySelector('#rv_ok');
  if (ok) ok.onclick = async () => {
    if (r.problems.length) { toast('Resolve the items listed first.', 'err'); return; }
    const done = await signDialog({ what: `QC Review and approval of ${b.batch_code}`, meaning: 'Reviewed by', needReason: false,
      submit: ({ signature }) => api(`/testing/batches/${b.id}/approve`, { method: 'POST', body: { signature } }) });
    if (done) { toast('Batch approved: results stored.'); ctx.reload(); }
  };
  const ret = host.querySelector('#rv_ret');
  if (ret) ret.onclick = async () => {
    const steps = d.steps.filter((x) => x.status === 'Completed' && x.step_type !== 'QC Review' && x.step_type !== 'Batching');
    const m = await modal({ title: `Return ${b.batch_code} to the analyst`, okText: 'Next: sign', intro: 'The step you choose and every step after it reopen, and lose their review approval. Say what needs fixing in the next dialog.',
      fields: [{ name: 'step_run_id', label: 'Reopen from', type: 'select', required: true, blank: false, value: steps[steps.length - 1]?.id, options: steps.map((x) => ({ value: x.id, label: x.step_name })) }] });
    if (!m) return;
    const done = await signDialog({ what: `Return ${b.batch_code} to the analyst (from ${steps.find((x) => x.id === m.step_run_id)?.step_name})`, meaning: 'Returned by', needReason: true,
      submit: ({ reason, signature }) => api(`/testing/batches/${b.id}/return`, { method: 'POST', body: { step_run_id: m.step_run_id, reason, signature } }) });
    if (done) { toast('Returned to the analyst.'); ctx.reload(); }
  };
}

// What is reported for a sample and analyte: the reading chosen, or the average of the readings ticked (WD-5)
function choiceText(x) {
  if (!x.chosen_entry_id) return x.n ? 'Not chosen yet' : 'No result';
  if (x.mode === 'Average') return `Average of ${(x.readings || []).length} readings: ${x.reported ?? nfmt(x.value)}`;
  const c = x.candidates.find((y) => y.entry_id === x.chosen_entry_id && Number(y.run_no) === Number(x.chosen_run_no)) || {};
  return `${c.label || ''}${x.n > 1 ? ` (run ${c.run || 1})` : ''}: ${x.reported ?? x.value_text ?? nfmt(x.value)}${x.auto_chosen ? ' (only reading)' : ''}`
    + (/^Picked by the analyst/.test(x.justification || '') ? ` · ${x.justification}` : '');   // 0.27.0: the analyst's pick and note
}
const storedBasis = (x) => (x.basis === 'Average' ? `Average of ${(x.averaged || []).length} readings` : x.basis === 'Picked' ? 'One reading chosen' : 'The only reading')
  + (x.justification ? `: ${x.justification}` : '');

// Tick one reading (a justification when there are several) or several to report their average
async function chooseReading(ctx, x, key = null) {
  const cur = (c) => (x.mode === 'Average' ? (x.readings || []).some((y) => y.entry_id === c.entry_id && Number(y.run_no) === Number(c.run_no))
    : c.entry_id === x.chosen_entry_id && Number(c.run_no) === Number(x.chosen_run_no));
  const m = await modal({ title: `Reportable result: ${x.sample_label} ${x.analyte_name}`, okText: 'Save', wide: true,
    intro: 'Tick <b>one</b> reading to report it, or <b>several</b> to report their average. Write why: a justification is required when one reading is picked from several, or when readings are left out of the average. It is kept with your name.',
    fields: [...x.candidates.map((c, i) => ({ name: 'c' + i, type: 'checkbox', label: '', value: !x.auto_chosen && cur(c),
      cbLabel: `${c.label} · run ${c.run || 1} · ${c.reported ?? c.value_text ?? nfmt(c.value)}` })),
      { name: 'justification', label: 'Justification', type: 'textarea', value: x.justification || '' }] });
  if (!m) return;
  const ticked = x.candidates.filter((c, i) => m['c' + i]);
  if (!ticked.length) { toast('Tick a reading (or several for their average).', 'err'); return; }
  const row = { requested_test_id: x.requested_test_id, analyte_id: x.analyte_id, result_key: key, justification: m.justification,
    entry_id: ticked[0].entry_id, run_no: Number(ticked[0].run_no), readings: ticked.length > 1 ? ticked.map((c) => ({ entry_id: c.entry_id, run_no: Number(c.run_no) })) : null };
  try { await api(`/testing/batches/${ctx.b.id}/choose`, { method: 'POST', body: { rows: [row] } }); toast(ticked.length > 1 ? 'The average will be reported.' : 'Reportable reading saved.'); ctx.reload(); }
  catch (e) { toast(e.message, 'err'); }
}

// A timepoint review (e.g. day 7 of a stability or preservative efficacy study): approve the steps before it, choose the
// results, then release them as preliminary (signed "Reviewed by"). The final review carries them over unchanged.
function timepointPanel(host, ctx, r, tp) {
  const { b, d } = ctx;
  const can = r.can_review && !r.performer && tp.ready && !tp.released && ['In Progress', 'Awaiting Review'].includes(b.status);
  const marks = (d.review_marks || []).filter((m) => (tp.feeds || []).includes(m.step_run_id));
  const tpLoads = (r.loads || []).filter((l) => (tp.feeds || []).includes(l.step_run_id));
  host.innerHTML = `${tp.released ? `<div class="tbnote"><b>Released</b> as preliminary results by ${esc(tp.released_by_name || '')} ${esc(dt(tp.released_at))}. The steps before it are locked; the final review carries these results over unchanged.</div>`
      : !tp.ready ? '<div class="tbnote">This timepoint comes to review when every step before it is completed.</div>'
      : !r.can_review ? '<div class="tbnote">Waiting for a reviewer: someone with testing.review in this lab.</div>'
      : r.performer ? '<div class="tbnote">You performed or witnessed a step of this batch, so someone else reviews it.</div>'
      : tp.problems.length ? `<div class="tbtodo"><b>To resolve before release</b><ul>${tp.problems.slice(0, 10).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
      : '<div class="tbnote"><b>Ready to release.</b> The results are stored as <b>Preliminary: not a final result</b> and can be reported as such.</div>'}
    ${can ? `<div class="tbacts" style="margin:6px 0 12px"><button class="btn primary" id="tp_rel" ${tp.problems.length ? 'disabled title="Resolve the items listed first"' : ''}>Release preliminary results</button></div>` : ''}
    <h3 style="margin:14px 0 6px">Steps before this timepoint</h3><div id="tp_steps"></div>
    ${tpLoads.length ? '<h3 style="margin:14px 0 6px">Incubator loads outside their target</h3><div id="tp_loads"></div>' : ''}
    <div id="tp_flags"></div>
    <h3 style="margin:14px 0 6px">${tp.released ? 'Released results' : 'Results to release'}</h3><div id="tp_res"></div>`;
  new Grid(host.querySelector('#tp_steps'), { readOnly: true, rows: marks.map((m, i) => ({ ...m, key: i, step_key: d.steps.find((x) => x.id === m.step_run_id)?.step_key })), keyField: 'key',
    emptyText: 'No steps.', rowClass: (m) => (m.mark_id ? '' : 'tbrerun'),
    columns: [
      { field: 'step_name', title: 'Step', type: 'link', width: 220, href: (m) => `#/testing/batches/${b.id}?step=${m.step_key}` },
      { field: 'status', title: 'Status', type: 'readonly', width: 110 },
      { field: 'mk', title: 'Review', type: 'readonly', width: 280, compute: (m) => (m.mark_id ? `Approved by ${m.marked_by_name} ${dt(m.marked_at)}` : 'Not approved yet'), cellClass: (m) => (m.mark_id ? 'tbpass' : 'tbwait') },
      { field: 'act', title: '', type: 'button', width: 120, label: (m) => (!can || m.status !== 'Completed' ? '' : m.mark_id ? 'Undo' : 'Approve step'), onClick: (m) => can && markStep(ctx, m.step_run_id, !!m.mark_id) },
    ] });
  if (tpLoads.length) loadsGrid(host.querySelector('#tp_loads'), ctx, tpLoads, can);
  flagsCard(host.querySelector('#tp_flags'), ctx, can, tp.feeds || []);
  const resultName = (k) => d.steps.find((x) => x.step_key === k)?.step_name || k;
  if (tp.released) {
    new Grid(host.querySelector('#tp_res'), { readOnly: true, rows: tp.stored.map((x, i) => ({ ...x, key: i })), keyField: 'key', emptyText: 'Nothing stored.',
      columns: [
        { field: 'sample_code', title: 'Sample', type: 'link', width: 140, href: (x) => '#/samples/' + x.sample_id },
        { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 150 },
        { field: 'result_name', title: 'Result of', type: 'readonly', width: 150 },
        { field: 'reported', title: 'Result', type: 'readonly', width: 90, align: 'right' },
        { field: 'unit', title: 'Unit', type: 'readonly', width: 65 },
        { field: 'stage', title: 'Stage', type: 'readonly', width: 190, compute: (x) => (x.stage === 'Preliminary' ? 'Preliminary: not a final result' : 'Final (carried over)') },
        { field: 'basis', title: 'Reported as', type: 'readonly', width: 200, compute: storedBasis },
      ] });
  } else {
    const rows = tp.items.map((x, i) => ({ ...x, key: i, n: x.candidates.length, sample_id: d.entries.find((e) => e.requested_test_id === x.requested_test_id)?.sample_id }));
    new Grid(host.querySelector('#tp_res'), { readOnly: true, rows, keyField: 'key', emptyText: tp.ready ? 'No results.' : 'The results appear when the steps before it are completed.',
      rowClass: (x) => (x.chosen_entry_id ? '' : 'tbrerun'),
      columns: [
        { field: 'sample_label', title: 'Sample', type: 'link', width: 140, href: (x) => (x.sample_id ? '#/samples/' + x.sample_id : null) },
        { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 150 },
        { field: 'rk', title: 'Result of', type: 'readonly', width: 150, compute: (x) => resultName(x.result_key) },
        { field: 'reported', title: 'Result', type: 'readonly', width: 90, align: 'right', compute: (x) => (x.chosen_entry_id ? x.reported ?? x.value_text ?? '' : '') },
        { field: 'unit', title: 'Unit', type: 'readonly', width: 65 },
        { field: 'n', title: 'Readings', type: 'readonly', width: 75 },
        { field: 'choice', title: 'Reportable reading', type: 'readonly', width: 290, compute: choiceText },
        { field: 'pick', title: '', type: 'button', width: 90, label: (x) => (can && x.n > 1 ? 'Choose…' : ''), onClick: (x) => can && x.n > 1 && chooseReading(ctx, x, x.result_key) },
      ] });
  }
  const rel = host.querySelector('#tp_rel');
  if (rel) rel.onclick = async () => {
    if (tp.problems.length) { toast('Resolve the items listed first.', 'err'); return; }
    const done = await signDialog({ what: `${tp.step_name} of ${b.batch_code}: release preliminary results`, meaning: 'Reviewed by', needReason: false,
      submit: ({ signature }) => api(`/testing/batches/${b.id}/timepoints/${tp.step_run_id}/release`, { method: 'POST', body: { signature } }) });
    if (done) { toast('Preliminary results released.'); ctx.reload(); }
  };
}

// Incubator loads outside their window or temperature: the analyst's note, and the reviewer's acceptance (WD-5.1)
function loadsGrid(node, ctx, loads, can) {
  const ok = (l) => l.accepted_justification && l.accepted_check === l.check_text;
  new Grid(node, { readOnly: true, rows: loads.map((l, i) => ({ ...l, key: i })), keyField: 'key', rowClass: (l) => (ok(l) ? '' : 'tbrerun'),
    columns: [
      { field: 'equipment_code', title: 'Incubator', type: 'link', width: 95, href: (l) => '#/equipment/' + l.equipment_id },
      { field: 'step_name', title: 'Step', type: 'readonly', width: 170 },
      { field: 'check_text', title: 'Outside the target', type: 'readonly', width: 260, cellClass: () => 'tbfail' },
      { field: 'note', title: 'Analyst\'s note', type: 'readonly', width: 240 },
      { field: 'acc', title: 'Accepted', type: 'readonly', width: 280, compute: (l) => (ok(l) ? `${l.accepted_by}: ${l.accepted_justification}` : 'Not accepted yet'), cellClass: (l) => (ok(l) ? 'tbpass' : 'tbwait') },
      { field: 'act', title: '', type: 'button', width: 90, label: (l) => (can && !ok(l) ? 'Accept…' : ''),
        onClick: async (l) => {
          if (!can || ok(l)) return;
          const m = await modal({ title: `Accept the load in ${l.equipment_code}`, okText: 'Accept', intro: `${esc(l.check_text)}. Analyst's note: ${esc(l.note || '(none)')}. Write why the results can still be reported (it is kept with your name).`,
            fields: [{ name: 'justification', label: 'Justification', type: 'textarea', required: true }] });
          if (!m) return;
          try { await api(`/testing/batches/${ctx.b.id}/accept-load`, { method: 'POST', body: { load_id: l.id, justification: m.justification } }); toast('Load accepted with your justification.'); ctx.reload(); }
          catch (e) { toast(e.message, 'err'); }
        } },
    ] });
}

// The reviewer approves a step (or undoes the approval): a recorded click, not a signature
// Add samples waiting in the backlog (same test version) to this batch, before bench work starts
async function addSamples(ctx) {
  const { b } = ctx;
  let rows;
  try { rows = (await api(`/testing/batches/${b.id}/pool`)).rows; } catch (e) { toast(e.message, 'err'); return; }
  if (!rows.length) { toast(`Nothing of ${b.test_name} is waiting in the backlog.`, 'err'); return; }
  const key = (r) => r.requested_test_id + ':' + (r.reprep_request_id || '');
  const html = `<div class="addlist">${rows.map((r) => `<label class="cb"><input type="checkbox" value="${esc(key(r))}">
      <b>${esc(r.sample_code || r.client_sample_id)}</b> ${esc(r.client_name || '')}${r.matrix ? ' · ' + esc(r.matrix) : ''}${r.due_date ? ' · due ' + esc(day(r.due_date)) : ''}
      ${r.priority !== 'Standard' ? ` <span class="badge">${esc(r.priority)}</span>` : ''}${r.is_media ? ' <span class="badge">Lot QA testing</span>' : ''}${r.kind === 'Re-prep' ? ` (re-prep ×${r.replicates})` : ''}</label>`).join('')}</div>`;
  const v = await modal({ title: `Add samples to ${b.batch_code}`, okText: 'Add to the batch', wide: true, html,
    intro: 'Waiting in the backlog for this test version, in priority order. The batch\'s QC follows the number of samples; a completed Batching step opens again so the batch is confirmed. Lot QA testing samples do not count toward the batch size.',
    collect: (m) => ({ picked: [...m.querySelectorAll('.addlist input:checked')].map((x) => x.value) }) });
  if (!v) return;
  if (!v.picked.length) { toast('Tick the samples to add.', 'err'); return; }
  const items = rows.filter((r) => v.picked.includes(key(r))).map((r) => ({ requested_test_id: r.requested_test_id, reprep_request_id: r.reprep_request_id || null }));
  try { const r = await api(`/testing/batches/${b.id}/add`, { method: 'POST', body: { items } }); toast(`${r.added} sample${Number(r.added) === 1 ? '' : 's'} added to ${b.batch_code}.`); ctx.reload(); }
  catch (e) { toast(e.message, 'err'); }
}
// Remove the selected samples (back to the backlog), before bench work starts
async function removeSamples(ctx, selected) {
  const { b } = ctx;
  const pick = [...new Map(selected.filter((r) => r.entry_type === 'Sample' && r.status === 'Active').map((r) => [r.requested_test_id + ':' + (r.reprep_request_id || ''), r])).values()];
  if (!pick.length) { toast('Select the sample rows to remove first (click a row; Ctrl+click to add more).', 'err'); return; }
  if (!(await confirmBox(`Remove from ${b.batch_code}`, `Remove ${pick.map((r) => esc(r.label)).join(', ')} from the batch? ${pick.length === 1 ? 'It goes' : 'They go'} back to the backlog; the batch's QC follows the number of samples.`, 'Remove'))) return;
  let n = 0; const failed = [];
  for (const r of pick) {
    try { await api(`/testing/entries/${r.entry_id || r.id}/remove`, { method: 'POST', body: {} }); n++; } catch (e) { failed.push(`${r.label}: ${e.message}`); }
  }
  if (n) toast(`${n} sample${n === 1 ? '' : 's'} removed: back in the backlog.`);
  if (failed.length) toast(failed.join(' | '), 'err');
  ctx.reload();
}

async function markStep(ctx, stepRunId, undo) {
  try {
    await api(`/testing/batches/${ctx.b.id}/steps/${stepRunId}/review-mark`, { method: 'POST', body: { undo } });
    toast(undo ? 'Step approval undone.' : 'Step approved.'); ctx.reload();
  } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------- actions
function contextMenu(x, y, items) {
  document.querySelectorAll('.tbmenu').forEach((m) => m.remove());
  const m = document.createElement('div'); m.className = 'tbmenu';
  m.innerHTML = items.map(([l], i) => `<button data-i="${i}">${esc(l)}</button>`).join('');
  document.body.appendChild(m);
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + 'px'; m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + 'px';
  const close = () => { m.remove(); document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', esc1, true); };
  const out = (e) => { if (!m.contains(e.target)) close(); };
  const esc1 = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('mousedown', out, true); document.addEventListener('keydown', esc1, true); }, 0);
  m.querySelectorAll('[data-i]').forEach((bt) => { bt.onclick = () => { close(); items[Number(bt.dataset.i)][1](); }; });
}
const forWhat = (ctx, ids) => (ids.length ? `${ids.length} selected entr${ids.length === 1 ? 'y' : 'ies'} (${ids.slice(0, 4).map((i) => ctx.d.entries.find((e) => e.id === i)?.label).join(', ')}${ids.length > 4 ? ', …' : ''})` : 'the whole batch (no rows selected)');

async function addEquipment(ctx, s, ids, run = 1) {
  const types = (s.equipment_types || []).map((t) => t.equipment_type_id);
  const list = ctx.opts.equipment.filter((e) => !types.length || types.includes(e.equipment_type_id));
  if (!list.length) { toast('This lab has no equipment of the type this step uses.', 'err'); return; }
  const r = await modal({ title: `Equipment used: ${s.step_name}${s.step_type === 'Data Entry' ? `, run ${run}` : ''}`, okText: 'Add', intro: `For ${esc(forWhat(ctx, ids))}. Only available equipment in calibration can be used.`,
    fields: [{ name: 'equipment_id', label: 'Equipment', type: 'select', required: true,
      options: list.map((e) => ({ value: e.id, label: `${e.equipment_code} ${e.equipment_name} (${e.type_name})${e.availability !== 'Available' ? ' · ' + e.availability : ''}${e.calibration_status === 'Deficient' ? ' · out of calibration' : ''}` })) }] });
  if (!r) return;
  try { await api(`/testing/step-runs/${s.id}/equipment`, { method: 'POST', body: { equipment_id: r.equipment_id, entry_ids: ids, analytical_run_no: run } }); toast('Equipment recorded.'); ctx.reload(); } catch (e) { toast(e.message, 'err'); }
}

// A weighed aliquot (sample weights logbook): its barcode (entry code) scanned at a Weighing step fills in the weight
// and the balance (L-2, migration 035)
async function scanAliquot(ctx, s) {
  const r = await modal({ title: `Scan aliquot: ${s.step_name}`, okText: 'Use it', intro: 'Scan (or type) the aliquot\'s barcode: its entry code in the sample weights logbook (LBE-...). Its weight and balance are recorded for its sample in this batch. Scan another aliquot to replace a weight; a typed weight cannot replace one from an aliquot.',
    fields: [{ name: 'code', label: 'Aliquot barcode', required: true }] });
  if (!r) return;
  try { const x = await api(`/testing/step-runs/${s.id}/scan-aliquot`, { method: 'POST', body: { code: r.code } }); toast(`Weight recorded for ${x.label} from ${r.code.toUpperCase()}.`); ctx.reload(); } catch (e) { toast(e.message, 'err'); }
}

async function addMaterial(ctx, s, ids) {
  const purpose = s.step_type === 'Weighing' ? 'Spike' : s.step_type === 'Data Entry' ? 'Standard' : s.step_type === 'Dilution' ? 'Diluent' : s.step_type === 'Plating/Inoculation' ? 'Media' : 'Reagent';
  let lbEntries = [];
  try { lbEntries = (await api(`/testing/batches/${ctx.b.id}/lot-entries`)).rows; } catch (_) { lbEntries = []; }
  const r = await modal({ title: `Material used: ${s.step_name}`, okText: 'Add', wide: true,
    intro: `For ${esc(forWhat(ctx, ids))}. The amount used is taken off the lot's stock <b>for each selected row</b>. For a spike it is the volume added: the amount spiked is calculated from the lot's concentrations. A check standard (ICV, CCV) is recorded as Standard.`,
    fields: [
      { name: 'lot_id', label: 'Lot', type: 'select', required: true, options: [...ctx.opts.lots].sort((x, y) => (x.not_qualified ? 1 : 0) - (y.not_qualified ? 1 : 0)).map((l) => ({ value: l.id, label: `${l.lot_code} ${l.item_name || ''}${l.analytes ? ' (' + l.analytes + ')' : ''} · on hand ${nfmt(l.on_hand)} ${l.unit || ''}${l.expiration_date ? ' · exp. ' + day(l.expiration_date) : ''}${l.not_qualified ? ' · NOT RELEASED: ' + l.not_qualified : ''}` })) },
      { name: 'purpose', label: 'Used as', type: 'select', required: true, blank: false, value: purpose, options: ['Spike', 'Standard', 'Reagent', 'Diluent', 'Media', 'Strain', 'Other'] },
      { name: 'volume', label: 'Amount used (per row)', type: 'number', required: true, help: 'Taken off the lot\'s stock; in a unit that converts to the lot\'s unit' },
      { name: 'volume_unit', label: 'Unit', type: 'select', blank: false, value: 'mL', options: ['mL', 'µL', 'L', 'g', 'mg', 'kg', 'each'] },
      ...(lbEntries.length ? [{ name: 'logbook_entry_id', label: 'Logbook entry (only when a lot has several usable ones)', type: 'select', options: lbEntries.map((x) => ({ value: x.entry_id, label: `${x.lot_code}: ${x.entry_code} ${x.status}${x.valid_until ? ', usable until ' + dt(x.valid_until) : ''}` })),
        help: 'A lot with logbook values (an inoculum, a culture) carries its entry: the approved one inside its validity is used, else choose' }] : []),
    ] });
  if (!r) return;
  try { await api(`/testing/step-runs/${s.id}/materials`, { method: 'POST', body: { ...r, entry_ids: ids } }); toast('Material recorded.'); ctx.reload(); } catch (e) { toast(e.message, 'err'); }
}

function attachFile(ctx, s, run = 1) {
  const inp = document.createElement('input'); inp.type = 'file';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast('The file is too large (20 MB at most).', 'err'); return; }
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        await api(`/testing/step-runs/${s.id}/attachments`, { method: 'POST', body: { file_name: f.name, mime_type: f.type || 'application/octet-stream', content_base64: String(rd.result).split(',')[1] || '', label: run > 1 ? `Raw data, run ${run}` : 'Raw data', analytical_run_no: run } });
        toast('Raw data attached.'); ctx.reload();
      } catch (e) { toast(e.message, 'err'); }
    };
    rd.readAsDataURL(f);
  };
  inp.click();
}

// Add an analytical run (WD-5): the samples ticked are read again (single, duplicate or triplicate) in a new run, which
// gets its own analytical QC (ICV, CCV...), raw data file and instrument
async function reanalysis(ctx, s, ids) {
  const cands = active(ctx.d).filter((e) => e.qc_class !== 'Analytical');
  const r = await modal({ title: `Add an analytical run: ${s.step_name}`, okText: 'Next: sign', wide: true,
    intro: 'Tick the samples (and prep QC) to read again from the same preparation. The new run gets its own ICV and CCVs, raw data file and instrument; every reading is kept and the reviewer chooses what is reported (or the average). New readings are labelled RA1-, RA2-...',
    fields: [{ name: 'runs', label: 'Readings of each in the new run', type: 'select', blank: false, value: '1', options: COUNT_WORDS },
      // 0.27.0: the ticked samples can be diluted further for this run (their run-1 dilution with one more aliquot + diluent)
      ...(dilutionSteps(ctx.d).length && s.id === lastReadingStep(ctx.d)?.id ? [
        { name: 'aliquot', label: 'Further dilution for this run: aliquot (leave empty to read the same solution)', type: 'number' },
        { name: 'diluent', label: 'Further dilution: diluent', type: 'number', help: 'e.g. 1 + 9 = ×10 more; the factors multiply, and only this run\'s readings use it' }] : []),
      ...cands.map((e) => ({ name: 'e_' + e.id, type: 'checkbox', label: '', cbLabel: `${e.label} (${kindOf(e)})`, value: ids.includes(e.id) }))] });
  if (!r) return;
  const pick = cands.filter((e) => r['e_' + e.id]).map((e) => e.id);
  if (!pick.length) { toast('Tick the samples to read again.', 'err'); return; }
  const further = r.aliquot ? ` diluted further ${r.aliquot} + ${r.diluent || 0}` : '';
  const done = await signDialog({ what: `New analytical run (${COUNT_WORDS[r.runs - 1].label.toLowerCase()}) of ${pick.length} entr${pick.length === 1 ? 'y' : 'ies'} in ${ctx.b.batch_code}${further}`, meaning: 'Requested by', needReason: true,
    submit: ({ reason, signature }) => api(`/testing/step-runs/${s.id}/runs`, { method: 'POST', body: { entry_ids: pick, replicates: Number(r.runs), aliquot: r.aliquot || null, diluent: r.diluent || null, reason, signature } }) });
  if (done) { toast('Analytical run added: enter its readings, raw data and instrument.'); location.hash = `#/testing/batches/${ctx.b.id}?step=${s.step_key}&run=${done.run_no || ''}`; }
}

async function reprep(ctx, ids) {
  const samples = ids.filter((i) => ctx.d.entries.find((e) => e.id === i)?.entry_type === 'Sample');
  if (!samples.length) { toast('Select the samples to re-prepare first (QC is made again with the new batch).', 'err'); return; }
  const r = await modal({ title: 'Re-prep', okText: 'Next: sign', intro: `Prepare ${esc(forWhat(ctx, samples))} again in a new batch. They go to the top of the backlog; their entries here are superseded and keep their data.`,
    fields: [{ name: 'replicates', label: 'How many new preparations', type: 'select', blank: false, value: '1', options: COUNT_WORDS }] });
  if (!r) return;
  const done = await signDialog({ what: `Re-prep (${COUNT_WORDS[r.replicates - 1].label.toLowerCase()}) from ${ctx.b.batch_code}`, meaning: 'Requested by', needReason: true,
    submit: ({ reason, signature }) => api(`/testing/batches/${ctx.b.id}/reprep`, { method: 'POST', body: { entry_ids: samples, replicates: Number(r.replicates), reason, signature } }) });
  if (done) { toast('Re-prep asked for: the samples are back at the top of the backlog.'); ctx.reload(); }
}

async function reopenStep(ctx, s) {
  const done = await signDialog({ what: `Reopen ${s.step_name} of ${ctx.b.batch_code}`, meaning: 'Reopened by', needReason: true,
    submit: ({ reason, signature }) => api(`/testing/step-runs/${s.id}/reopen`, { method: 'POST', body: { reason, signature } }) });
  if (done) { toast('Step reopened.'); ctx.reload(); }
}

// Complete a step: the analyst signs "Performed by"; with Witnessed ticked, the witness signs in the same dialog
function completeStep(ctx, s) {
  const mode = (s.config || {}).witness || 'None';
  const u = currentUser();
  const what = `${s.step_name} of ${ctx.b.batch_code}`;
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal sigmodal"><h3>Complete step</h3>
    <p class="intro">You are signing: <b>${esc(what)}</b>.<br>Your signature means <b>Performed by</b> and covers every entry in the batch; it is stored with your name, the date and time.</p>
    <div class="fields">
      <div class="sigbox"><div class="field"><label for="c_user">User ID <span class="req">*</span></label><input id="c_user" autocomplete="username" value="${esc(u?.username || '')}"></div>
        <div class="field"><label for="c_pass">Password <span class="req">*</span></label><input id="c_pass" type="password" autocomplete="current-password"></div></div>
      ${mode === 'None' ? '' : `<label class="cb" style="display:block;margin-top:10px"><input type="checkbox" id="c_wit" ${mode === 'Required' ? 'checked disabled' : ''}> Witnessed${mode === 'Required' ? ' (this step requires a witness)' : ''}</label>
        <div class="witbox" id="c_wbox" ${mode === 'Required' ? '' : 'hidden'}><div class="help">The witness signs too (<b>Witnessed by</b>): another person who does bench work in this lab, with their own user ID and password.</div>
          <div class="two"><div class="field"><label for="c_wuser">Witness user ID <span class="req">*</span></label><input id="c_wuser" autocomplete="off"></div>
          <div class="field"><label for="c_wpass">Witness password <span class="req">*</span></label><input id="c_wpass" type="password" autocomplete="off"></div></div></div>`}
    </div><div class="merr" role="alert"></div>
    <div class="mbtns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>Sign and complete</button></div></div>`;
  document.body.appendChild(m);
  const $ = (q) => m.querySelector(q);
  const err = (t, f) => { $('.merr').textContent = t; if (f) f.focus(); };
  const wit = $('#c_wit');
  if (wit && mode !== 'Required') wit.onchange = () => { $('#c_wbox').hidden = !wit.checked; };
  $('#c_pass').focus();
  const close = () => m.remove();
  $('[data-x]').onclick = close;
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') $('[data-ok]').click(); });
  $('[data-ok]').onclick = async () => {
    const signature = { username: $('#c_user').value.trim(), password: $('#c_pass').value };
    if (!signature.username) return err('Enter your user ID.', $('#c_user'));
    if (!signature.password) return err('Enter your password to sign.', $('#c_pass'));
    let witness = null;
    if (wit && wit.checked) {
      witness = { username: $('#c_wuser').value.trim(), password: $('#c_wpass').value };
      if (!witness.username) return err('The witness enters their user ID.', $('#c_wuser'));
      if (!witness.password) return err('The witness enters their password.', $('#c_wpass'));
      if (witness.username.toLowerCase() === signature.username.toLowerCase()) return err('The witness must be someone else.', $('#c_wuser'));
    }
    const ok = $('[data-ok]'); ok.disabled = true; err('');
    try {
      await api(`/testing/step-runs/${s.id}/complete`, { method: 'POST', body: { signature, witness } });
      close(); toast(witness ? 'Step completed, signed and witnessed.' : 'Step completed and signed.'); ctx.reload();
    } catch (e) { ok.disabled = false; $('#c_pass').value = ''; if ($('#c_wpass')) $('#c_wpass').value = ''; err(e.message, $('#c_pass')); }
  };
  enhanceAll(m);
}
