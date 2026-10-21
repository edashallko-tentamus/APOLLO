// OOS investigations (R-2, migration 027). Never opened by itself (Alex): QC Review and the sample page flag an
// out-of-specification result and offer "Open OOS…", because the sample details or the client's answer often settle
// it first. Full Phase I (GMP samples): analyst section, supervisor section, QA conclusion. Check and Acknowledge:
// one reviewer answers the checklist and concludes. The conclusion makes the investigation report (PDF). Retests,
// the client's answers (from the link in the OOS email) and QA's retest determination are on the same page.
import { api, esc, pageHeader, toast, modal, badge, link, signDialog, state } from '../app.js';
import { Grid } from '../grid.js';
import { editableGrid, pagedList } from './common.js';

const css = document.createElement('style');
css.textContent = `
.oosg { display: grid; grid-template-columns: minmax(320px, 420px) 1fr; gap: 12px; align-items: start; }
.oosg dl { display: grid; grid-template-columns: 140px 1fr; gap: 3px 10px; margin: 0; font-size: 13px; } .oosg dt { color: var(--muted); } .oosg dd { margin: 0; }
.oosck { border-left: 4px solid #cfd6da; padding: 6px 8px; margin: 0 0 6px; background: #fafbfc; border-radius: 4px; font-size: 12.5px; }
.oosck.Pass { border-color: #2e8b57; } .oosck.Fail { border-color: #b42318; background: #fdecec; } .oosck.Info { border-color: #6b7c93; }
.oosck b { display: block; } .oosck .lv { float: right; font-weight: 700; font-size: 11px; text-transform: uppercase; }
.oossec { margin: 0 0 12px; } .oossec h2 { font-size: 15px; margin: 0 0 6px; } .oossec .signed { color: var(--muted); font-size: 12.5px; margin: 4px 0 8px; }
.oossec textarea { width: 100%; font-size: 13px; } .oossec .fl { margin: 8px 0 4px; font-weight: 600; font-size: 12.5px; }
.oosacts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.oosdue.late { color: #b42318; font-weight: 700; }
`;
document.head.appendChild(css);

const dt = (v) => (v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const d8 = (v) => (v ? new Date(String(v).slice(0, 10) + 'T12:00:00').toLocaleDateString([], { dateStyle: 'medium' }) : '');
const sq = () => '?s=' + encodeURIComponent(state.site || '');
const PHASE1 = 'Full Phase I (21 CFR 211)';

// ---------------------------------------------------------------- open (QC Review, the sample page)
// ctx: { requested_test_id, analyte_id, batch_id, label }; returns the new investigation's id (and opens it) or null
export async function openOos(ctx) {
  const v = await modal({ title: 'Open an OOS investigation', okText: 'Next: sign',
    intro: `<b>${esc(ctx.label || 'This result')}</b> does not conform to its specification. Check the sample details and the specification first: if they were wrong, correct them instead (no investigation is needed). Opening starts the investigation, its automatic data checks and its target date.`,
    fields: [{ name: 'reason', label: 'Why it is opened (optional)', type: 'textarea', help: 'For example what has already been checked, or what the client said.' }] });
  if (!v) return null;
  const out = await signDialog({ what: `Open an OOS investigation: ${ctx.label || ''}`, meaning: 'Opened by', needReason: false,
    submit: ({ signature }) => api('/oos/open', { method: 'POST', body: { requested_test_id: ctx.requested_test_id, analyte_id: ctx.analyte_id, batch_id: ctx.batch_id || null, reason: v.reason, signature } }) });
  if (!out) return null;
  toast('OOS investigation opened.');
  location.hash = '#/oos/' + out.id;
  return out.id;
}

// ---------------------------------------------------------------- the list
export async function list(main) {
  main.innerHTML = pageHeader('OOS investigations', 'Out-of-specification results under investigation in this lab. An investigation is opened from QC Review or the sample page ("Open OOS…"); GMP samples follow Full Phase I, the others Check and Acknowledge. A result under investigation is held from the COA until it is concluded.',
    '<a class="btn ghost" href="#/oos/config">Checklists and target times</a>', { kind: 'oos_list' })
    + '<div class="card"><div id="g"></div></div>';
  // one page at a time from the server (0.35.0), newest first
  pagedList({ el: main.querySelector('#g'), url: '/oos', q: state.query.get('find') || '', filter: state.query.get('show') || 'open',
    filters: [['open', 'Open'], ['overdue', 'Overdue'], ['closed', 'Closed'], ['all', 'All']],
    placeholder: 'Search by investigation, sample, client, test, analyte or batch; type an OOS code and press Enter to open it',
    open: (r) => { location.hash = '#/oos/' + r.id; },
    render: (el, rows) => new Grid(el, { readOnly: true, rows, emptyText: 'No OOS investigations here.',
    rowClass: (r) => (r.overdue ? 'tbnc' : ['Closed', 'Cancelled'].includes(r.status) ? 'mutedrow' : ''),
    columns: [
      { field: 'oos_code', title: 'Investigation', type: 'link', width: 115, href: (r) => '#/oos/' + r.id },
      { field: 'status', title: 'Status', type: 'readonly', width: 125 },
      { field: 'procedure', title: 'Procedure', type: 'readonly', width: 185 },
      { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => '#/samples/' + r.sample_id },
      { field: 'client_name', title: 'Client', type: 'readonly', width: 160 },
      { field: 'test_name', title: 'Test', type: 'readonly', width: 190 },
      { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 120 },
      { field: 'res', title: 'Result', type: 'readonly', width: 110, compute: (r) => [r.reported, r.unit].filter(Boolean).join(' ') },
      { field: 'spec_text', title: 'Specification', type: 'readonly', width: 120 },
      { field: 'conclusion', title: 'Conclusion', type: 'readonly', width: 170 },
      { field: 'due_date', title: 'Target date', type: 'readonly', width: 105, format: d8, cellClass: (r) => (r.overdue ? 'tbfail' : '') },
      { field: 'responses_waiting', title: 'Client answers', type: 'readonly', width: 105, compute: (r) => (r.responses_waiting ? `${r.responses_waiting} to handle` : ''), cellClass: (r) => (r.responses_waiting ? 'tbwait' : '') },
      { field: 'opened_by_name', title: 'Opened by', type: 'readonly', width: 140 },
      { field: 'opened_at', title: 'Opened', type: 'readonly', width: 145, format: dt },
    ] }) });
}

// ---------------------------------------------------------------- one investigation
export async function page(main, id) {
  const d = await api('/oos/' + id);
  const o = d.oos; const can = d.can; const me = d.me;
  const open = !['Closed', 'Cancelled'].includes(o.status);
  const p1 = o.procedure === PHASE1;
  const sec = (name) => d.items.filter((i) => i.section === name);
  const late = open && o.overdue;
  const mayCancel = open && (can.approve || (o.opened_by === me && can.open));
  main.innerHTML = pageHeader(`${o.oos_code}: ${o.analyte_name} in ${o.sample_code}`, `${esc(o.procedure)} · ${badge(o.status)}${o.conclusion ? ' · <b>' + esc(o.conclusion) + '</b>' : ''}`,
    `${o.report_document_id ? `<a class="btn" target="_blank" id="rep" href="/api/oos/${o.id}/report.pdf${sq()}">Investigation report (PDF)</a>` : ''}
     ${mayCancel ? '<button class="btn ghost" id="cancel">Cancel investigation…</button>' : ''} <a class="btn ghost" href="#/oos">All investigations</a>`, { kind: 'oos', id: o.id })
    + `<div class="oosg"><div>
      <div class="card"><h2 style="font-size:15px;margin:0 0 8px">The result</h2><dl>
        <dt>Sample</dt><dd>${link('#/samples/' + o.sample_id, o.sample_code)}${o.client_sample_id ? ' (' + esc(o.client_sample_id) + ')' : ''}</dd>
        <dt>Client</dt><dd>${esc(o.client_name)}</dd>
        <dt>Test</dt><dd>${esc(o.test_name)}</dd>
        <dt>Analyte</dt><dd>${esc(o.analyte_name)}</dd>
        <dt>Result</dt><dd><b>${esc([o.reported, o.unit].filter(Boolean).join(' '))}</b></dd>
        <dt>Specification</dt><dd>${esc(o.spec_text || '')}</dd>
        <dt>Batch</dt><dd>${o.batch_id ? link('#/testing/batches/' + o.batch_id + '?step=results', o.batch_code) : ''}</dd>
        <dt>GMP</dt><dd>${o.is_gmp ? 'Yes (Full Phase I, QA concludes)' : 'No'}</dd>
        <dt>Opened</dt><dd>${esc(o.opened_by_name)}, ${esc(dt(o.opened_at))}</dd>
        ${o.opened_reason ? `<dt>Why</dt><dd>${esc(o.opened_reason)}</dd>` : ''}
        <dt>Target date</dt><dd class="oosdue ${late ? 'late' : ''}">${esc(d8(o.due_date))}${late ? ' (overdue)' : ''}</dd>
        ${o.client_notified_at ? `<dt>Client told</dt><dd>${esc(dt(o.client_notified_at))} (OOS email with the COA)</dd>` : ''}
        ${o.status === 'Cancelled' ? `<dt>Cancelled</dt><dd>${esc(o.cancelled_name || '')}, ${esc(dt(o.cancelled_at))}: ${esc(o.cancelled_reason || '')}</dd>` : ''}
      </dl></div>
      <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="font-size:15px;margin:0">Automatic data checks</h2>
        ${open && (can.open || can.review) ? '<button class="btn ghost mini" id="rerun">Run again</button>' : ''}</div>
        <div class="help" style="margin:4px 0 8px">${o.auto_checked_at ? 'Run ' + esc(dt(o.auto_checked_at)) + '. ' : ''}Worked out from the records; a Fail needs explaining in the investigation.</div>
        <div id="checks">${(o.auto_checks || []).map((c) => `<div class="oosck ${esc(c.level)}"><span class="lv">${esc(c.level)}</span><b>${esc(c.title)}</b>${esc(c.detail)}</div>`).join('') || '<div class="help">Not run yet.</div>'}</div></div>
    </div><div id="secs"></div></div>`;

  const secs = main.querySelector('#secs');
  const parts = [];
  if (p1) {
    parts.push(section('Analyst', '1. Analyst investigation', o.analyst_by, o.analyst_name, o.analyst_at, o.analyst_answers, o.analyst_comment,
      o.status === 'Open' && can.perform, 'Investigated by', 'analyst', { hypothesis: o.hypothesis }));
    parts.push(section('Supervisor', '2. Supervisor review', o.supervisor_by, o.supervisor_name, o.supervisor_at, o.supervisor_answers, o.supervisor_comment,
      o.status === 'Analyst signed' && can.review && o.analyst_by !== me, 'Reviewed by', 'supervisor',
      { waiting: o.status === 'Open' ? 'Follows the analyst\'s section.' : o.status === 'Analyst signed' && o.analyst_by === me ? 'You signed the analyst section: a supervisor signs this one.' : '' }));
    parts.push(conclusion('3. QA conclusion', o.status === 'Supervisor signed' && can.approve && ![o.analyst_by, o.supervisor_by].includes(me), null,
      o.status === 'Supervisor signed' && [o.analyst_by, o.supervisor_by].includes(me) ? 'You signed a section: QA concludes it independently.' : ['Open', 'Analyst signed'].includes(o.status) ? 'Follows the supervisor\'s section.' : ''));
  } else {
    parts.push(conclusion('Check and Acknowledge', o.status === 'Open' && (can.review || can.approve), sec('Reviewer'), ''));
  }
  parts.push(retestsCard());
  secs.innerHTML = parts.map((x) => x.html).join('');
  parts.forEach((x) => x.wire && x.wire());

  const rr = main.querySelector('#rerun');
  if (rr) rr.onclick = async () => { rr.disabled = true; try { await api(`/oos/${o.id}/checks`, { method: 'POST', body: {} }); toast('Checks run again.'); page(main, id); } catch (e) { toast(e.message, 'err'); rr.disabled = false; } };
  const cb = main.querySelector('#cancel');
  if (cb) cb.onclick = async () => {
    const v = await modal({ title: `Cancel ${o.oos_code}`, okText: 'Next: sign', intro: 'Cancel an investigation opened in error, for example when the sample details or the specification were wrong and are now corrected. It is kept, marked Cancelled.',
      fields: [{ name: 'reason', label: 'Why it is cancelled', type: 'textarea', required: true }] });
    if (!v) return;
    const done = await signDialog({ what: `Cancel ${o.oos_code}`, meaning: 'Cancelled by', needReason: false,
      submit: ({ signature }) => api(`/oos/${o.id}/cancel`, { method: 'POST', body: { reason: v.reason, signature } }) });
    if (done) { toast(`${o.oos_code} cancelled.`); page(main, id); }
  };

  // a checklist section: read only once signed, otherwise a grid (Answer: Yes / No / N/A, Comment; fill down and paste work)
  function checklist(host, items, answers, editable) {
    const rows = items.map((i) => ({ id: i.id, item_text: i.item_text, answer: answers?.[i.id]?.answer || '', comment: answers?.[i.id]?.comment || '' }));
    return new Grid(host, { rows, readOnly: !editable, emptyText: 'No checklist items (QA sets them on "Checklists and target times").',
      columns: [
        { field: 'item_text', title: 'Item', type: 'readonly', width: 560 },
        { field: 'answer', title: 'Answer', type: 'select', options: ['Yes', 'No', 'N/A'], width: 80, cellClass: (r) => (r.answer === 'No' ? 'tbwait' : '') },
        { field: 'comment', title: 'Comment (required for No)', width: 260 },
      ] });
  }
  const collect = (g) => Object.fromEntries(g.rows.map((r) => [r.id, { answer: r.answer || '', comment: r.comment || '' }]));
  const missing = (g) => { const r = g.rows.find((x) => !['Yes', 'No', 'N/A'].includes(x.answer)); if (r) return `Answer every item (Yes, No or N/A): "${r.item_text}"`; const n = g.rows.find((x) => x.answer === 'No' && !String(x.comment || '').trim()); return n ? `Explain the "No" for: "${n.item_text}"` : ''; };

  function section(name, title, by, byName, at, answers, comment, editable, meaning, path, extra = {}) {
    const k = path;
    const signedLine = by ? `<div class="signed">Signed (${esc(meaning)}) by ${esc(byName || '')}, ${esc(dt(at))}</div>` : '';
    const html = `<div class="card oossec"><h2>${esc(title)}</h2>${signedLine}${!by && !editable && extra.waiting ? `<div class="help">${esc(extra.waiting)}</div>` : ''}
      ${by || editable ? `<div id="cl_${k}"></div>
      ${name === 'Analyst' ? `<div class="fl">Hypothesis (what might explain the result; optional)</div>${editable ? `<textarea id="hy_${k}" rows="2"></textarea>` : `<div>${esc(extra.hypothesis || '')}</div>`}` : ''}
      <div class="fl">Comment</div>${editable ? `<textarea id="cm_${k}" rows="3"></textarea>` : `<div>${esc(comment || '')}</div>`}
      ${editable ? `<div class="oosacts"><button class="btn primary" id="sg_${k}">Sign the ${name.toLowerCase()} section</button></div>` : ''}` : ''}</div>`;
    return { html, wire: () => {
      const host = main.querySelector('#cl_' + k); if (!host) return;
      const g = checklist(host, sec(name), answers, editable);
      const bt = main.querySelector('#sg_' + k);
      if (bt) bt.onclick = async () => {
        const m = missing(g); if (m) { toast(m, 'err'); return; }
        const body = { answers: collect(g), comment: main.querySelector('#cm_' + k).value, hypothesis: main.querySelector('#hy_' + k)?.value || null };
        const done = await signDialog({ what: `${o.oos_code}: ${title}`, meaning, needReason: false,
          submit: ({ signature }) => api(`/oos/${o.id}/${path}`, { method: 'POST', body: { ...body, signature } }) });
        if (done) { toast('Section signed.'); page(main, id); }
      };
    } };
  }

  function conclusion(title, editable, reviewerItems, waiting) {
    const done = o.status === 'Closed';
    const html = `<div class="card oossec"><h2>${esc(title)}</h2>
      ${done ? `<div class="signed">Concluded (Approved by) by ${esc(o.concluded_name || '')}, ${esc(dt(o.concluded_at))}</div>` : ''}
      ${!done && !editable ? `<div class="help">${esc(waiting || (open ? (p1 ? 'QA (oos.approve) concludes.' : 'Someone with QC Review rights (testing.review) or QA concludes.') : ''))}</div>` : ''}
      ${reviewerItems && (done || editable) ? '<div id="cl_rev"></div>' : ''}
      ${done ? `<dl style="margin-top:8px"><dt>Conclusion</dt><dd><b>${esc(o.conclusion)}</b></dd>${o.assignable_cause ? `<dt>Assignable cause</dt><dd>${esc(o.assignable_cause)}</dd>` : ''}<dt>Justification</dt><dd>${esc(o.conclusion_comment || '')}</dd></dl>` : ''}
      ${editable ? `<div class="help" style="margin:6px 0">The batch must be approved in QC Review first: the conclusion is about the approved result. Concluding makes the investigation report (PDF), stored with its fingerprint.</div>
        <div class="fl">Conclusion</div><select id="cc_c"><option value=""></option><option>OOS confirmed</option><option>Assignable cause found</option></select>
        <div class="fl">Assignable cause (the documented laboratory error; required for "Assignable cause found")</div><textarea id="cc_a" rows="2"></textarea>
        <div class="fl">Justification</div><textarea id="cc_j" rows="3"></textarea>
        <div class="oosacts"><button class="btn primary" id="cc_go">Conclude and sign…</button></div>` : ''}</div>`;
    return { html, wire: () => {
      let g = null;
      const host = main.querySelector('#cl_rev');
      if (host) g = checklist(host, reviewerItems, o.reviewer_answers, editable);
      const bt = main.querySelector('#cc_go');
      if (bt) bt.onclick = async () => {
        const body = { conclusion: main.querySelector('#cc_c').value, cause: main.querySelector('#cc_a').value, comment: main.querySelector('#cc_j').value, answers: g ? collect(g) : {} };
        if (g) { const m = missing(g); if (m) { toast(m, 'err'); return; } }
        if (!body.conclusion) { toast('Choose the conclusion.', 'err'); return; }
        if (body.conclusion === 'Assignable cause found' && !body.cause.trim()) { toast('Describe the assignable cause.', 'err'); return; }
        if (!body.comment.trim()) { toast('Write the justification.', 'err'); return; }
        const ok = await signDialog({ what: `${o.oos_code}: conclusion "${body.conclusion}"`, meaning: 'Approved by', needReason: false, okText: 'Sign and conclude',
          submit: ({ signature }) => api(`/oos/${o.id}/conclude`, { method: 'POST', body: { ...body, signature } }) });
        if (ok) { toast(`${o.oos_code} concluded: report made.`); page(main, id); }
      };
    } };
  }

  // retests, the client's answers and the retest determination
  function retestsCard() {
    const closed = o.status === 'Closed';
    if (!closed && !d.responses.length && !d.retests.length) return { html: '' };
    const hasRetest = d.retests.some((r) => r.status !== 'Cancelled');
    const clientRetest = d.retests.find((r) => r.source === 'Client OOS Retest' && r.status !== 'Cancelled');
    const canLab = closed && o.conclusion === 'Assignable cause found' && !hasRetest && can.order;
    const canClient = closed && o.conclusion === 'OOS confirmed' && o.client_notified_at && !hasRetest && can.order;
    const canDet = clientRetest && clientRetest.result && !o.retest_determination && can.approve;
    const html = `<div class="card oossec"><h2>Retests and the client</h2>
      ${closed && o.conclusion === 'Assignable cause found' ? '<div class="help">An assignable cause invalidates the result: order the lab investigation retest (a re-prep from the retained sample, not billed). The invalid result is never released.</div>' : ''}
      ${closed && o.conclusion === 'OOS confirmed' ? `<div class="help">The confirmed result is released on the COA; the client is emailed then, with links to answer (retest, retest in duplicate, a new sample, hold or return the retained sample, a call with QA). ${o.client_notified_at ? '' : '<b>Not released yet.</b>'}</div>` : ''}
      ${d.retests.length ? `<div class="fl">Retests</div><div id="rt_g"></div>` : ''}
      ${d.responses.length ? `<div class="fl">The client's answers</div><div id="cr_g"></div>` : ''}
      ${o.retest_determination ? `<div class="signed" style="margin-top:8px">Retest determination: <b>${esc(o.retest_determination)}</b> by ${esc(o.determined_name || '')}, ${esc(dt(o.determined_at))}: ${esc(o.determination_reason || '')}</div>` : ''}
      <div class="oosacts">
        ${canLab ? '<button class="btn primary" id="rt_lab">Order the lab investigation retest…</button>' : ''}
        ${canClient ? '<button class="btn primary" id="rt_cli">Order the client retest…</button>' : ''}
        ${canDet ? '<button class="btn primary" id="rt_det">Record the retest determination…</button>' : ''}
        ${clientRetest && !clientRetest.result && !o.retest_determination ? '<span class="help">QA records the determination (billing) once the retest is approved in QC Review.</span>' : ''}
      </div></div>`;
    return { html, wire: () => {
      const rg = main.querySelector('#rt_g');
      if (rg) new Grid(rg, { readOnly: true, rows: d.retests, columns: [
        { field: 'source', title: 'Retest', type: 'readonly', width: 180 },
        { field: 'retest_replicates', title: 'Replicates', type: 'readonly', width: 85 },
        { field: 'status', title: 'Status', type: 'readonly', width: 110 },
        { field: 'due_date', title: 'Due', type: 'readonly', width: 100, format: d8 },
        { field: 'billing_status', title: 'Billing', type: 'readonly', width: 170 },
        { field: 'result', title: 'Result', type: 'readonly', width: 220 },
      ] });
      const cg = main.querySelector('#cr_g');
      if (cg) new Grid(cg, { readOnly: true, rows: d.responses, columns: [
        { field: 'received_at', title: 'Received', type: 'readonly', width: 145, format: dt },
        { field: 'choice', title: 'Answer', type: 'readonly', width: 170 },
        { field: 'contact_name', title: 'From', type: 'readonly', width: 130 },
        { field: 'note', title: 'Note', type: 'readonly', width: 220 },
        { field: 'handled', title: 'Handled', type: 'readonly', width: 220, compute: (r) => (r.handled_at ? `${r.handled_by_name || ''} ${dt(r.handled_at)}${r.handled_note ? ': ' + r.handled_note : ''}` : 'Not yet'), cellClass: (r) => (r.handled_at ? '' : 'tbwait') },
        { field: 'act', title: '', type: 'button', width: 170, label: (r) => (r.handled_at ? '' : canClient && /^Retest|new sample/i.test(r.choice) ? 'Order the client retest…' : (can.order || can.open) ? 'Mark handled…' : ''),
          onClick: (r) => (r.handled_at ? null : canClient && /^Retest|new sample/i.test(r.choice) ? orderRetest('Client', r) : handle(r)) },
      ] });
      const bl = main.querySelector('#rt_lab'); if (bl) bl.onclick = () => orderRetest('Lab investigation');
      const bc = main.querySelector('#rt_cli'); if (bc) bc.onclick = () => orderRetest('Client');
      const bd = main.querySelector('#rt_det'); if (bd) bd.onclick = determination;
    } };
  }
  async function orderRetest(kind, response) {
    const dflt = response ? (response.choice === 'Retest in duplicate' ? '2' : '1') : '1';
    const v = await modal({ title: `${kind === 'Client' ? 'Client' : 'Lab investigation'} retest of ${o.sample_code}`, okText: 'Next: sign',
      intro: kind === 'Client' ? 'A re-prep from the retained sample, billed by QA\'s determination once its result is approved (Confirmed OOS or Inconclusive: billable; Lab error: not billable). The original result stays on the issued COA; the retest makes a new COA version.'
        : 'A re-prep from the retained sample, not billed. The invalidated results are kept (Superseded) and never released; the retest\'s results take their place on the COA.',
      fields: [{ name: 'replicates', label: 'Replicates', type: 'select', blank: false, value: dflt, options: [{ value: '1', label: 'Single' }, { value: '2', label: 'Duplicate' }, { value: '3', label: 'Triplicate' }] }] });
    if (!v) return;
    const done = await signDialog({ what: `${o.oos_code}: order the ${kind === 'Client' ? 'client' : 'lab investigation'} retest`, meaning: 'Ordered by', needReason: false,
      submit: ({ signature }) => api(`/oos/${o.id}/retest`, { method: 'POST', body: { kind, replicates: v.replicates, response_id: response?.id || null, signature } }) });
    if (done) { toast('Retest ordered: it is in the backlog.'); page(main, id); }
  }
  async function handle(r) {
    const v = await modal({ title: 'Client answer handled', okText: 'Save', intro: `${esc(r.choice)}${r.note ? ': ' + esc(r.note) : ''}`, fields: [{ name: 'note', label: 'What was done', type: 'textarea' }] });
    if (!v) return;
    try { await api(`/oos/responses/${r.id}/handled`, { method: 'POST', body: { note: v.note } }); toast('Marked handled.'); page(main, id); } catch (e) { toast(e.message, 'err'); }
  }
  async function determination() {
    const v = await modal({ title: `${o.oos_code}: retest determination`, okText: 'Next: sign', intro: 'QA\'s determination of the cause once the client retest is approved. It sets the retest\'s billing: Confirmed OOS or Inconclusive are billable, Lab error is not (rush fees included).',
      fields: [{ name: 'determination', label: 'Determination', type: 'select', required: true, options: ['Confirmed OOS', 'Lab error', 'Inconclusive'] },
        { name: 'reason', label: 'Evidence', type: 'textarea', required: true }] });
    if (!v) return;
    const done = await signDialog({ what: `${o.oos_code}: retest determination "${v.determination}"`, meaning: 'Approved by', needReason: false,
      submit: ({ signature }) => api(`/oos/${o.id}/determination`, { method: 'POST', body: { ...v, signature } }) });
    if (done) { toast('Determination recorded.'); page(main, id); }
  }
}

// ---------------------------------------------------------------- QA: checklists and target times
export async function config(main) {
  const d = await api('/oos/config');
  main.innerHTML = pageHeader('OOS checklists and target times', `The questions each investigation answers and how many days it has to close. The wording belongs to QA's OOS SOP. ${d.can_edit ? '' : 'QA keeps them (oos.configure).'}`,
    '<a class="btn ghost" href="#/oos">OOS investigations</a>', { kind: 'oos_config' })
    + '<div class="card"><h2 style="font-size:15px;margin:0 0 6px">Target times</h2><div id="ts"></div></div><div class="card"><h2 style="font-size:15px;margin:0 0 6px">Checklist items</h2><div class="help">Full Phase I has an Analyst and a Supervisor section; Check and Acknowledge a Reviewer section. Set an item Inactive to retire it (investigations keep the answers they gave).</div><div id="ci"></div></div>';
  editableGrid({ el: main.querySelector('#ts'), rows: d.settings, readOnly: !d.can_edit, what: 'the OOS target times',
    columns: [{ field: 'procedure', title: 'Procedure', type: 'readonly', width: 240 }, { field: 'close_within_days', title: 'Close within (calendar days)', type: 'int', min: 1, width: 190, required: true }],
    save: (rows, reason) => api('/oos/config/settings', { method: 'POST', body: { rows, reason } }), afterSave: () => config(main) });
  editableGrid({ el: main.querySelector('#ci'), rows: d.items, allowAdd: d.can_edit, readOnly: !d.can_edit, search: true, what: 'the OOS checklists',
    newRow: () => ({ status: 'Active', procedure: PHASE1, section: 'Analyst', sort_order: 100 }), rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'procedure', title: 'Procedure', type: 'select', options: [PHASE1, 'Check and Acknowledge'], width: 210, required: true, editable: (r, isNew) => isNew },
      { field: 'section', title: 'Section', type: 'select', options: (r) => (r.procedure === 'Check and Acknowledge' ? ['Reviewer'] : ['Analyst', 'Supervisor']), width: 110, required: true },
      { field: 'item_text', title: 'Item', width: 520, required: true },
      { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 100 },
    ],
    save: (rows, reason) => api('/oos/config/items', { method: 'POST', body: { rows, reason } }), afterSave: () => config(main) });
}
