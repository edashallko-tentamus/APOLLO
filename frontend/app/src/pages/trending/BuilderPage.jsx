// Build a chart (#/trending/build; ?chart=<id> changes a saved one, ?d=<definition> opens a shared link): choose what
// to chart, draw it, then download it or save it for the lab.
import { useEffect, useRef, useState } from 'react';
import { buildChart, getChart, getOptions, saveChart } from '../../api/trending.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { CONTROL, Panels, SOURCES, TrendTabs } from './TrendPanel.jsx';
import { Button, Card, Form } from 'react-bootstrap';

const AUDIT = { kind: 'trending' };
const SUB = 'Choose what to chart, draw it, then download it or save it for the lab. Saved charts are watched (Trend watch) and can be frozen to a baseline; QC charts can be shown in QC Review.';
const START = { source: 'logbook', params: {}, rules: ['R1', 'R2', 'R3', 'R4', 'R5', 'LIM'] };

function Sel({ name, label, items, value, blank = '', onChange }) {
  const options = [...(blank !== null ? [{ value: '', label: blank }] : []), ...items.map(([v, t]) => ({ value: String(v), label: t }))];
  return <div className="field"><label htmlFor={'p_' + name}>{label}</label><SmartSelect id={'p_' + name} value={value ?? ''} options={options} onChange={onChange} /></div>;
}

// the title a drawing gets from its choices
function titleOf(o, def) {
  const p = def.params; const t = o.tests.find((x) => x.id === p.test_id); const a = o.analytes.find((x) => x.id === p.analyte_id);
  const lb = o.logbooks.find((x) => x.id === p.logbook_id); const fl = o.fields.find((x) => x.logbook_id === p.logbook_id && x.field_key === p.field_key);
  const eq = o.equipment.find((x) => x.id === p.equipment_id); const st = o.studies.find((x) => x.id === p.study_id);
  switch (def.source) {
    case 'results': return [t && t.test_name, a && a.analyte_name, p.matrix, p.product].filter(Boolean).join(': ');
    case 'qc': return [t && t.test_name, p.qc_type && p.qc_type !== '*' ? `${p.qc_type} ${p.limit_type || ''}`.trim() : 'QC', a && a.analyte_name].filter(Boolean).join(': ');
    case 'logbook': return [fl && fl.label, eq ? eq.equipment_name : lb && lb.logbook_name].filter(Boolean).join(': ');
    case 'stability': return [st && st.study_code, a && a.analyte_name].filter(Boolean).join(': ');
    case 'counts': return ((o.metrics.find((x) => x.key === p.metric) || {}).title || '') + ` per ${(p.period || 'Month').toLowerCase()}` + (t ? ` (${t.test_name})` : '');
    default: return (o.pareto.find((x) => x.key === p.metric) || {}).title || 'Pareto';
  }
}

function Builder({ o, editing, shared }) {
  const { can } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const [def, setDef] = useState(() => (editing
    ? { source: editing.source, params: { ...editing.params }, rules: String(editing.rules).replace(/[{}]/g, '').split(',').filter(Boolean) }
    : shared ? { ...START, ...shared } : START));
  const [out, setOut] = useState({ state: 'idle' });
  const runId = useRef(0);
  const p = def.params; const s = def.source;

  const setParam = (k, v) => setDef((d) => {
    const params = { ...d.params, [k]: v || undefined };
    if (k === 'test_id') { delete params.analyte_id; delete params.qc_type; delete params.limit_type; }
    if (k === 'logbook_id') { delete params.field_key; delete params.equipment_id; }
    if (k === 'study_id') delete params.analyte_id;
    return { ...d, params };
  });
  const setQc = (v) => setDef((d) => {
    const params = { ...d.params };
    if (v === '*') { params.qc_type = '*'; delete params.limit_type; } else if (v) { const [a, b] = v.split('|'); params.qc_type = a; params.limit_type = b; } else { delete params.qc_type; delete params.limit_type; }
    return { ...d, params };
  });
  const setRule = (k, on) => setDef((d) => ({ ...d, rules: on ? [...d.rules.filter((x) => x !== k), k] : d.rules.filter((x) => x !== k) }));

  async function run(d = def) {
    const id = ++runId.current;
    setOut({ state: 'drawing' });
    try {
      const r = await buildChart({ source: d.source, title: titleOf(o, d), params: d.params, rules: d.rules });
      if (id === runId.current) setOut({ state: 'done', panels: r.panels });
    } catch (e) { if (id === runId.current) setOut({ state: 'error', error: e.message }); }
  }
  useEffect(() => { if (editing || shared) run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once: a saved chart or a shared link draws at once

  async function copyLink() {
    const url = `${window.location.origin}${window.location.pathname}#/trending/build?d=${encodeURIComponent(JSON.stringify({ source: def.source, params: def.params, rules: def.rules }))}`;
    try { await navigator.clipboard.writeText(url); toast('Link copied: it opens this chart in the builder.'); } catch { toast('The link could not be copied here.', 'err'); }
  }
  async function save() {
    const isQc = def.source === 'qc';
    const r = await dialogs.form({ title: editing ? `Save ${editing.chart_code}` : 'Save the chart', intro: 'Saved charts belong to the lab: anyone with trending.view can open them.', fields: [
      { name: 'chart_name', label: 'Name', required: true, value: editing ? editing.chart_name : titleOf(o, def) },
      { name: 'description', label: 'What it is for', type: 'textarea', value: editing ? editing.description || '' : '' },
      { name: 'watch', label: 'Trend watch', type: 'checkbox', cbLabel: 'Watch it (on the Trending page with its signals)', value: editing ? editing.watch : true },
      ...(isQc ? [{ name: 'show_in_review', label: 'QC Review', type: 'checkbox', cbLabel: 'Show it in QC Review of this test\'s batches, with the batch\'s points ringed (once QA has approved it)', value: editing ? editing.show_in_review : true }] : []),
      { name: 'qa_review', label: 'QA review', type: 'checkbox', cbLabel: 'QA reviewable: QA approves the chart and its limits before it counts (always on for a chart in QC Review)', value: editing ? editing.qa_review : isQc },
    ] });
    if (!r) return;
    let reason = null; if (editing) { reason = await dialogs.reason(`trend chart ${editing.chart_code}`); if (!reason) return; }
    try {
      const params = { ...def.params }; delete params.from; delete params.to;
      const res = await saveChart({ id: editing ? editing.id : undefined, chart_name: r.chart_name, description: r.description, source: def.source, params, rules: def.rules, watch: r.watch,
        show_in_review: isQc && !!r.show_in_review, qa_review: !!r.qa_review || (isQc && !!r.show_in_review), reason });
      toast(editing ? `${editing.chart_code} saved.` : `${res.chart_code} saved.`);
      window.location.hash = '#/trending/charts/' + (editing ? editing.id : res.id);
    } catch (e) { toast(e.message, 'err'); }
  }

  const testsWith = (ids) => o.tests.filter((t) => ids.has(t.id)).map((t) => [t.id, t.test_name]);
  let fields = null;
  if (s === 'results') {
    fields = <>
      <Sel name="test_id" label="Test" items={testsWith(new Set(o.analytes.map((a) => a.test_id)))} value={p.test_id} blank="Choose a test" onChange={(v) => setParam('test_id', v)} />
      <Sel name="analyte_id" label="Analyte" items={[['*', 'Each analyte (one chart each)'], ...o.analytes.filter((a) => a.test_id === p.test_id).map((a) => [a.id, a.analyte_name + (a.unit ? ` (${a.unit})` : '')])]} value={p.analyte_id} blank="Choose an analyte" onChange={(v) => setParam('analyte_id', v)} />
      <Sel name="client_id" label="Client" items={o.clients.map((c) => [c.id, c.name])} value={p.client_id} blank="Every client" onChange={(v) => setParam('client_id', v)} />
      <Sel name="matrix" label="Matrix" items={o.matrices.map((m) => [m, m])} value={p.matrix} blank="Every matrix" onChange={(v) => setParam('matrix', v)} />
      <div className="field"><label htmlFor="p_product">Product contains</label><Form.Control type="text" id="p_product" value={p.product || ''} onChange={(e) => setParam('product', e.target.value)} /></div>
    </>;
  } else if (s === 'qc') {
    const types = o.qcTypes.filter((q) => q.test_id === p.test_id);
    const qv = p.qc_type === '*' ? '*' : p.qc_type ? `${p.qc_type}|${p.limit_type || ''}` : '';
    fields = <>
      <Sel name="test_id" label="Test" items={testsWith(new Set(o.qcTypes.map((q) => q.test_id)))} value={p.test_id} blank="Choose a test" onChange={(v) => setParam('test_id', v)} />
      <Sel name="qc" label="QC check" items={[['*', 'Each QC check (one chart each)'], ...types.map((q) => [`${q.qc_type}|${q.limit_type}`, `${q.qc_type}: ${q.limit_type}`])]} value={qv} blank="Choose a QC check" onChange={setQc} />
      <Sel name="analyte_id" label="Analyte" items={[['*', 'Each analyte (one chart each)'], ...o.analytes.filter((a) => a.test_id === p.test_id).map((a) => [a.id, a.analyte_name])]} value={p.analyte_id} blank="Every analyte together" onChange={(v) => setParam('analyte_id', v)} />
    </>;
  } else if (s === 'logbook') {
    const eq = o.equipment.filter((e) => e.logbook_id === p.logbook_id);
    fields = <>
      <Sel name="logbook_id" label="Logbook" items={o.logbooks.map((l) => [l.id, `${l.logbook_code} ${l.logbook_name}`])} value={p.logbook_id} blank="Choose a logbook" onChange={(v) => setParam('logbook_id', v)} />
      <Sel name="field_key" label="Field" items={o.fields.filter((x) => x.logbook_id === p.logbook_id).map((x) => [x.field_key, x.label + (x.unit ? ` (${x.unit})` : '')])} value={p.field_key} blank="Choose a field" onChange={(v) => setParam('field_key', v)} />
      {eq.length > 0 && <Sel name="equipment_id" label="Equipment" items={[['*', 'Each piece of equipment (one chart each)'], ...eq.map((e) => [e.id, `${e.equipment_code} ${e.equipment_name}`])]} value={p.equipment_id} blank="All together" onChange={(v) => setParam('equipment_id', v)} />}
    </>;
  } else if (s === 'stability') {
    fields = <>
      <Sel name="study_id" label="Study" items={o.studies.map((x) => [x.id, `${x.study_code} ${x.product || ''}`])} value={p.study_id} blank="Choose a study" onChange={(v) => setParam('study_id', v)} />
      <Sel name="analyte_id" label="Analyte" items={o.studyAnalytes.filter((a) => a.study_id === p.study_id).map((a) => [a.id, a.analyte_name])} value={p.analyte_id} blank="Choose an analyte" onChange={(v) => setParam('analyte_id', v)} />
    </>;
  } else if (s === 'counts') {
    const m = o.metrics.find((x) => x.key === p.metric);
    fields = <>
      <Sel name="metric" label="What to count" items={o.metrics.map((x) => [x.key, x.title])} value={p.metric} blank="Choose" onChange={(v) => setParam('metric', v)} />
      <Sel name="period" label="Per" items={[['Month', 'Month'], ['Week', 'Week']]} value={p.period || 'Month'} blank={null} onChange={(v) => setParam('period', v)} />
      {m && m.test && <Sel name="test_id" label="Test" items={o.tests.map((t) => [t.id, t.test_name])} value={p.test_id} blank="Every test" onChange={(v) => setParam('test_id', v)} />}
    </>;
  } else {
    fields = <Sel name="metric" label="Break down" items={o.pareto.map((x) => [x.key, x.title])} value={p.metric} blank="Choose" onChange={(v) => setParam('metric', v)} />;
  }
  const lockSource = editing && editing.frozen_cl !== null;

  return <>
    <PageHeader title={editing ? `Change ${editing.chart_code} ${editing.chart_name}` : 'Build a chart'} subtitle={SUB} audit={AUDIT} />
    <TrendTabs on="build" />
    <div className="trbuild">
      <div className="trform" id="f">
        <h3 style={{ marginTop: 0 }}>What to chart</h3>
        <div className="trsrc">{SOURCES.map(([k, t, h]) => (
          <button key={k} type="button" className={s === k ? 'on' : undefined} disabled={lockSource && k !== s} title={lockSource && k !== s ? 'Recalculate the frozen limits before charting something else' : undefined}
            onClick={() => { if (k !== def.source) setDef((d) => ({ ...d, source: k, params: {} })); }}>{t}<small>{h}</small></button>))}</div>
        {fields}
        <div className="row2">
          <div className="field"><label htmlFor="p_from">From</label><Form.Control type="date" id="p_from" value={p.from || ''} onChange={(e) => setParam('from', e.target.value)} /></div>
          <div className="field"><label htmlFor="p_to">To</label><Form.Control type="date" id="p_to" value={p.to || ''} onChange={(e) => setParam('to', e.target.value)} /></div>
        </div>
        {CONTROL.includes(s) && <><h3>Signal rules</h3><div className="trrules">
          {Object.entries(o.rules).filter(([k]) => k !== 'LIM' || s !== 'counts').map(([k, t]) => (
            <label key={k}><Form.Check.Input type="checkbox" checked={def.rules.includes(k)} onChange={(e) => setRule(k, e.target.checked)} /> <span><b>{k}</b> {t}</span></label>))}
        </div></>}
        <div className="acts">
          <Button type="button" variant="primary" id="draw" onClick={() => run()}>Draw</Button>
          {can('trending.manage') && <Button type="button" variant="outline-secondary" id="save" onClick={save}>{editing ? 'Save changes' : 'Save chart…'}</Button>}
          <Button type="button" variant="light" id="copy" onClick={copyLink}>Copy link</Button>
        </div>
      </div>
      <div id="out">
        {out.state === 'idle' && <Card body className="trempty">Choose what to chart on the left, then Draw.</Card>}
        {out.state === 'drawing' && <Card body className="trempty">Drawing…</Card>}
        {out.state === 'error' && <Card body className="err">{out.error}</Card>}
        {out.state === 'done' && (out.panels.length ? <Panels panels={out.panels} ctx={{ rules: def.rules }} margin="2px 0 6px" />
          : <Card body className="trempty">Nothing to chart: no analytes or QC checks for this choice.</Card>)}
      </div>
    </div>
  </>;
}

export default function BuilderPage({ query }) {
  const q = new URLSearchParams(query);
  const cid = q.get('chart');
  let shared = null;
  if (!cid && q.get('d')) { try { shared = JSON.parse(q.get('d')); } catch { /* a bad link: start empty */ } }
  const { data, error } = useApi(async (o) => ({ o: await getOptions(o), editing: cid ? (await getChart(cid, '', '', o)).chart : null }), [cid]);
  if (error && !data) return <><PageHeader title="Build a chart" audit={AUDIT} /><TrendTabs on="build" /><Card body className="err">{error.message}</Card></>;
  if (!data) return <><PageHeader title="Build a chart" audit={AUDIT} /><TrendTabs on="build" /><div className="loading">Loading…</div></>;
  return <Builder key={cid || query} o={data.o} editing={data.editing} shared={shared} />;
}
