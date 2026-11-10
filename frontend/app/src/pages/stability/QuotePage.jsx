// A stability quote (#/stability/quotes/:id): the design (the study facts, conditions, timepoints, tests and the
// condition x timepoint matrix) saved with one "Save design"; the price by year and the problems as saved; Send, Accept,
// Reject (the quote dialogs), New version, and "Amend the study…" once it is a study.
import { useEffect, useMemo, useRef, useState } from 'react';
import { newStabilityVersion, quotePdfUrl, saveDesign, stabilityQuote } from '../../api/stability.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money } from '../../lib/format.js';
import { useUnsavedChanges } from '../../router/useHashRoute.js';
import { decideQuote, sendQuote } from '../quotes/quoteDialogs.js';
import { d8, ext, Failed, iso, Loading, newKey } from './shared.jsx';
import { Button } from 'react-bootstrap';

export default function QuotePage({ params: [pid] }) {
  const { data: d, error, reload } = useApi(() => stabilityQuote(pid), [pid]);
  // every load starts the design again from what was saved
  const stamp = useRef({ d: null, n: 0 });
  if (d && stamp.current.d !== d) stamp.current = { d, n: stamp.current.n + 1 };
  if (error && !d) return <Failed error={error} />;
  if (!d) return <Loading />;
  return <QuoteDesign key={stamp.current.n} d={d} pid={pid} reload={reload} />;
}

const truthy = (v) => v === true || v === 'true';
const isPull = (t) => !t.remove && Number(t.interval_value) > 0 && String(t.label || '').trim() !== '';
const tickKey = (testId, condId, tpKey) => `${testId}|${condId}|${tpKey}`;

function QuoteDesign({ d, pid, reload }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const v = d.version; const p = d.project; const g = d.design; const ed = d.editable && d.can_edit;
  const pw = (d.labs.find((l) => l.id === g.plan?.site_id) || {}).stability_pull_window_days ?? 7;
  const cat = useMemo(() => new Map(d.catalog.map((x) => [x.test_id, x])), [d]);
  const total = d.years.reduce((s, y) => s + y.total, 0);
  const statusText = v.status === 'Submitted for Quote' ? 'Submitted' : v.status;

  // ---- the page's state: what "Save design" sends
  const [plan, setPlan] = useState(() => ({ ...(g.plan || {}), planned_placement: iso(g.plan?.planned_placement) }));
  const [conds, setConds] = useState(() => g.conditions.map((c) => c.condition_id));
  const [ticks, setTicks] = useState(() => {
    const s = new Set();
    for (const c of g.cells) if (c.condition_id) { const l = g.lines.find((x) => x.id === c.line_id); if (l) s.add(tickKey(l.test_id, c.condition_id, c.timepoint_id)); }
    return s;
  });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const touch = () => setTouched(true);

  // ---- timepoints
  const tpStart = useMemo(() => g.timepoints.map((t) => ({ _k: t.id, id: t.id, label: t.label, interval_value: t.interval_value, interval_unit: t.interval_unit, days_early: t.days_early, days_late: t.days_late, planned: t.planned_date })), [g]);
  const tpCols = useMemo(() => [
    { field: 'label', title: 'Timepoint', width: 110 },
    { field: 'interval_value', title: 'After', type: 'int', width: 70 },
    { field: 'interval_unit', title: 'Unit', type: 'select', options: ['Months', 'Weeks', 'Days'], width: 90 },
    { field: 'days_early', title: 'Days early', type: 'int', width: 90 },
    { field: 'days_late', title: 'Days late', type: 'int', width: 90 },
    { field: 'planned', title: 'Planned date', type: 'readonly', width: 120, format: d8 },
    { field: 'remove', title: 'Remove', type: 'bool', width: 75 },
  ], []);
  const tpGrid = useGrid({ rows: tpStart, columns: tpCols, keyField: '_k', readOnly: !ed, allowAdd: ed,
    newRow: () => ({ _k: newKey(), label: '', interval_value: '', interval_unit: 'Months', days_early: pw, days_late: pw }) });
  const tps = tpGrid.state.rows;

  // ---- tests
  const lineStart = useMemo(() => g.lines.map((l) => ({ _k: l.id, test_id: l.test_id, final_price: l.final_price, units: l.units || 1, t0: g.cells.some((c) => c.line_id === l.id && c.condition_id === null) })), [g]);
  const testOpts = useMemo(() => d.catalog.map((x) => ({ value: x.test_id, label: `${x.test_name} (${x.test_code})${x.has_effective ? '' : ' · no approved workflow'}` })), [d]);
  const lineRowsRef = useRef(lineStart);
  const lineCols = useMemo(() => {
    const times = (tid) => tps.filter(isPull).reduce((n, t) => n + conds.filter((c) => ticks.has(tickKey(tid, c, t._k))).length, 0)
      + (truthy(lineRowsRef.current.find((l) => l.test_id === tid)?.t0) ? 1 : 0);
    return [
      { field: 'test_id', title: 'Test', type: 'select', options: testOpts, width: 330, editable: (r, isNew) => isNew || !r.test_id },
      { field: 'list', title: 'List price', type: 'readonly', width: 90, compute: (r) => money(cat.get(r.test_id)?.list_price) },
      { field: 'final_price', title: 'Your price', type: 'money', width: 95, help: 'Blank: the list price' },
      { field: 'units', title: 'Material per test', type: 'int', width: 115 },
      { field: 't0', title: 'At T0', type: 'bool', width: 65 },
      { field: 'times', title: 'Times', type: 'readonly', width: 60, compute: (r) => (r.test_id ? times(r.test_id) : '') },
      { field: 'remove', title: 'Remove', type: 'bool', width: 75 },
    ];
  }, [testOpts, cat, tps, conds, ticks]);
  const lineGrid = useGrid({ rows: lineStart, columns: lineCols, keyField: '_k', readOnly: !ed, allowAdd: ed,
    newRow: () => ({ _k: newKey(), test_id: '', final_price: '', units: 1, t0: true }) });
  const lineRows = lineGrid.state.rows;
  lineRowsRef.current = lineRows;

  // ---- the matrix: a row per test and condition, a column per pull timepoint; rebuilt when its shape changes
  const pulls = tps.filter(isPull);
  const lines = lineRows.filter((l) => l.test_id && !truthy(l.remove));
  const condList = d.conditions.filter((c) => conds.includes(c.id));
  const shape = JSON.stringify([lines.map((l) => l.test_id), condList.map((c) => c.id), pulls.map((t) => [t._k, t.label])]);
  const ticksRef = useRef(ticks); ticksRef.current = ticks;
  const mx = useMemo(() => {
    const rows = [];
    for (const l of lines) for (const c of condList) {
      const r = { _k: `${l.test_id}|${c.id}`, test_id: l.test_id, condition_id: c.id, test: cat.get(l.test_id)?.test_name || '', condition: c.condition_name };
      pulls.forEach((t, i) => { r['p' + i] = ticksRef.current.has(tickKey(l.test_id, c.id, t._k)); });
      rows.push(r);
    }
    const columns = [{ field: 'test', title: 'Test', type: 'readonly', width: 230 }, { field: 'condition', title: 'Condition', type: 'readonly', width: 140 },
      ...pulls.map((t, i) => ({ field: 'p' + i, title: t.label, type: 'bool', width: 70 }))];
    return { rows, columns, pulls };
  }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps -- only the shape rebuilds it; ticks are read as they are
  const mxGrid = useGrid({ rows: mx.rows, columns: mx.columns, keyField: '_k', readOnly: !ed });
  const { reset: mxReset } = mxGrid;
  useEffect(() => { mxReset(mx.rows); }, [mx, mxReset]);
  // a tick in the matrix: the ticks follow (rows rebuilt from the ticks give the same set, so no loop)
  useEffect(() => {
    const next = new Set(ticksRef.current);
    for (const r of mxGrid.state.rows) mx.pulls.forEach((t, i) => { const k = tickKey(r.test_id, r.condition_id, t._k); if (truthy(r['p' + i])) next.add(k); else next.delete(k); });
    if (next.size !== ticksRef.current.size || [...next].some((k) => !ticksRef.current.has(k))) { setTicks(next); setTouched(true); }
  }, [mxGrid.state.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- unsaved changes
  const firstRows = useRef({ tp: tpGrid.state.rows, line: lineGrid.state.rows });
  const dirty = touched || tpGrid.state.rows !== firstRows.current.tp || lineGrid.state.rows !== firstRows.current.line;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const savedRef = useRef(false);
  useUnsavedChanges(() => dirtyRef.current && !savedRef.current);

  async function save() {
    if (saving) return;
    if (tpGrid.errorCount || lineGrid.errorCount) { toast('Fix the cells marked in red first (hover a red cell to see why).', 'err'); return; }
    const tpList = tps.filter((t) => !truthy(t.remove) && String(t.label || '').trim());
    const body = {
      plan: { ...plan }, condition_ids: conds,
      timepoints: tpList.map((t) => ({ id: t.id, label: String(t.label).trim(), interval_value: t.interval_value, interval_unit: t.interval_unit, days_early: t.days_early, days_late: t.days_late })),
      lines: lines.map((l) => ({ test_id: l.test_id, final_price: l.final_price, units: l.units, t0: truthy(l.t0) })),
      matrix: [],
    };
    for (const l of lines) for (const c of conds) {
      const labels = tpList.filter((t) => Number(t.interval_value) > 0 && ticks.has(tickKey(l.test_id, c, t._k))).map((t) => String(t.label).trim());
      if (labels.length) body.matrix.push({ test_id: l.test_id, condition_id: c, labels });
    }
    setSaving(true);
    try { await saveDesign(v.id, body); savedRef.current = true; toast('Design saved.'); reload(); } catch (e) { toast(e.message, 'err'); setSaving(false); }
  }

  const contacts = d.contacts.map((x) => ({ id: x.id, name: x.name, email: x.email }));
  const send = async () => {
    if (dirty) { toast('Save the design first.', 'err'); return; }
    const vv = { id: v.id, status: v.status, project_code: p.project_code, sent_to_contact_id: v.sent_to_contact_id, quote_contact_id: p.quote_contact_id };
    if (await sendQuote(dialogs, toast, vv, contacts)) reload();
  };
  const decide = async (decision) => {
    const row = { version_id: v.id, client_id: p.client_id, quote_contact_id: p.quote_contact_id, sent_to_contact_id: v.sent_to_contact_id, project_code: p.project_code };
    if (await decideQuote(dialogs, toast, row, decision)) reload();
  };
  const newVersion = async () => {
    if (d.study) {
      const ok = await dialogs.form({ title: `Amend study ${d.study.study_code}`, okText: 'Start the amendment', fields: [],
        intro: 'An amendment is a new version of this quote: change the design, issue it and send it to the client. Nothing changes in the study until the client accepts it. Pulls already ordered or taken stay as they are.' });
      if (!ok) return;
    }
    try { await newStabilityVersion(p.id); toast(d.study ? 'Amendment started: change the design, then issue and send it.' : 'New version started: change the design, then issue it.'); reload(); } catch (e) { toast(e.message, 'err'); }
  };

  const actions = <>
    <Button variant="light" href={quotePdfUrl(v.id)} {...ext}>Quotation PDF</Button>
    {ed && <> <Button type="button" variant="primary" id="save" disabled={!dirty || saving} onClick={save}>Save design</Button></>}
    {d.can_edit && ['Draft', 'Submitted for Quote', 'Quoted'].includes(v.status) && <> <Button type="button" variant="outline-secondary" id="send" onClick={send}>{v.status === 'Quoted' ? 'Send again…' : 'Issue and send to client…'}</Button></>}
    {d.can_edit && v.status === 'Quoted' && <> <Button type="button" variant="outline-secondary" id="acc" onClick={() => decide('Accepted')}>Accept…</Button><Button type="button" variant="light" id="rej" onClick={() => decide('Rejected')}>Reject…</Button></>}
    {d.can_edit && !d.study && ['Quoted', 'Rejected', 'Expired'].includes(v.status) && <> <Button type="button" variant="light" id="newv" onClick={newVersion}>New version</Button></>}
    {d.can_edit && d.study && d.study.status !== 'Cancelled' && ['Accepted', 'Rejected', 'Expired'].includes(v.status) && <> <Button type="button" variant="light" id="newv" onClick={newVersion}>Amend the study…</Button></>}
  </>;
  const subtitle = <>
    Stability quote for <a href={'#/clients/' + p.client_id}>{p.client_name}</a>{p.quote_contact_name ? ', attn. ' + p.quote_contact_name : ''} · prepared by {p.owner_name || ''} · <Badge status={statusText} />
    {v.sent_at ? ` · sent ${d8(v.sent_at)}${v.sent_to_name ? ' to ' + v.sent_to_name : ''}` : ''}{v.status === 'Accepted' ? ` · accepted by ${v.accepted_by_name || ''}` : ''}
  </>;
  const studyLink = d.study && <a href={'#/stability/studies/' + d.study.id}>{d.study.study_code}</a>;

  const setFact = (k) => (e) => { setPlan((s) => ({ ...s, [k]: e.target.value })); touch(); };
  const fact = (k, label, type = 'text', extra = {}) => (
    <div className="field"><label htmlFor={'pf_' + k}>{label}</label><input id={'pf_' + k} type={type} {...extra} value={plan[k] ?? ''} disabled={!ed} onChange={setFact(k)} /></div>);
  const toggleCond = (id, on) => { setConds((s) => d.conditions.map((c) => c.id).filter((x) => (x === id ? on : s.includes(x)))); touch(); };
  const lab = d.labs.find((l) => l.id === plan.site_id);

  return <>
    <PageHeader title={`${p.project_code}${v.version_no > 1 ? ' v' + v.version_no : ''}: ${p.project_name}`} subtitle={subtitle} actions={actions} audit={{ kind: 'stability_quote', id: p.id }} />
    {d.study && v.id !== d.study.project_version_id && ['Draft', 'Submitted for Quote', 'Quoted'].includes(v.status)
      ? <div className="alert alert-warning stb-amd"><b>Amendment of study {studyLink}</b> (it runs to an earlier version until this one is accepted).
        Change what the client asked for: add timepoints, tests or conditions, or untick what stops. Pulls already ordered or taken do not change, and T0 cannot change.
        When the client accepts, scheduled pulls follow the new design and new ones are scheduled; a new condition is placed in a chamber from the study page.</div>
      : d.study ? <div className="alert alert-warning">Accepted: this quote is study {studyLink} ({d.study.status}{d.study.amendment_no ? `, amendment ${d.study.amendment_no}` : ''}).</div> : null}
    {d.link && v.status === 'Quoted' && <div className="qsent">The client can accept or decline online: <input readOnly value={d.link} /></div>}
    {!ed && !d.study && <div className="alert alert-warning">{v.status === 'Draft' ? 'You can view this quote; quotes.edit is needed to change it.' : 'This version is issued: its design is locked. "New version" starts a changed one.'}</div>}

    <Section title="The study" help="Which lab stores and tests it, the product, and how prices move over the years. A planned placement date puts real dates on the quotation (weekends and holidays moved inside each window).">
      <div className="stb-facts" id="facts">
        <div className="field"><label htmlFor="pf_site_id">Lab</label><input id="pf_site_id" disabled title="The quote's lab: set when the quote is made" value={lab?.site_code || ''} /></div>
        {fact('product', 'Product')}{fact('lot', 'Lot')}{fact('protocol_ref', 'Client protocol')}
        {fact('unit_name', 'Material counted in')}{fact('planned_placement', 'Planned placement', 'date')}
        {fact('escalation_pct', 'Yearly price increase %', 'number', { step: '0.5', min: '0' })}
        {fact('reserve_pct', 'Material reserve % (blank: the lab\'s)', 'number', { step: '1', min: '0' })}
      </div>
    </Section>
    <Section title="Storage conditions" help="The chambers the material is stored in. The ICH set is preset for every lab; your lab adds its own (Admin > Lab setup > Stability chambers).">
      <div className="stb-conds" id="conds">
        {d.conditions.map((c) => { const on = conds.includes(c.id); return (
          <label key={c.id} className={on ? 'on' : ''}><input type="checkbox" data-c={c.id} checked={on} disabled={!ed} onChange={(e) => toggleCond(c.id, e.target.checked)} />
            {' '}{c.condition_name} <small>{c.condition_type}{c.site_id ? '' : ' · ICH'}</small></label>); })}
      </div>
    </Section>
    <Section title="Timepoints" help={`T0 is the baseline, tested when the material is placed. Each later timepoint is a pull, with its window in days early and late (the lab's default is ± ${pw} days; a QA decision). Fill down and paste work as in Excel; tick Remove to drop a row.`}>
      <div id="tps"><DataGrid grid={tpGrid} /></div>
    </Section>
    <Section title="Tests" help="Each test is priced once; the study total counts it at every timepoint where it is ticked. Material per test is what one test uses at one timepoint.">
      <div id="lines"><DataGrid grid={lineGrid} /></div>
    </Section>
    <Section title="Matrix" help="Tick the timepoints each test is pulled at, per condition (tests often differ by timepoint: e.g. accelerated stops at 6 months).">
      <div id="mx"><DataGrid grid={mxGrid} emptyText="Add tests and conditions first." /></div>
    </Section>
    <div className="cols">
      <Section title="Price">
        <div id="price">
          <div className="stb-sum"><span className="big">{money(total)}</span><span className="help">study total{Number(plan.escalation_pct) ? `, ${Number(plan.escalation_pct)}% more each year` : ''} · as saved</span></div>
          {d.years.length > 0 && <table className="stb-years"><tbody><tr><th>Study year</th><th>Tests</th><th>Amount</th></tr>
            {d.years.map((y) => <tr key={y.year}><td>Year {y.year}</td><td>{y.tests}</td><td>{money(y.total)}</td></tr>)}</tbody></table>}
        </div>
      </Section>
      <Section title="Before it can be issued">
        <div id="probs">{d.problems.length ? <ul className="stb-probs">{d.problems.map((x, i) => <li key={i} className={x.severity}>{x.problem}</li>)}</ul> : <div className="help">Nothing: it can be issued.</div>}</div>
      </Section>
    </div>
  </>;
}
