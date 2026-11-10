// One trend chart panel (facts, downloads, views, signals and their reviews), the Trending tabs, and ReviewTrends:
// the QC charts applied to a batch's test, shown in QC Review (exported for the testing area).
import { useState } from 'react';
import { downloadTrend, getReviewTrends, reviewSignal } from '../../api/trending.js';
import { saveBlob } from '../../api/dashboard.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import './trending.css';

export const SOURCES = [
  ['results', 'Results', 'One analyte of one test, from final results'],
  ['qc', 'QC checks', 'Controls, blanks and recoveries of approved batches'],
  ['logbook', 'Logbooks', 'A number recorded in a logbook'],
  ['stability', 'Stability', 'A study\'s pulls over time, per condition'],
  ['counts', 'Events over time', 'OOS, re-preparations, failures, turnaround'],
  ['pareto', 'Pareto', 'What the events are made of'],
];
export const CONTROL = ['results', 'qc', 'logbook', 'counts'];
const OUTCOMES = ['Investigated: no action', 'Action taken', 'Linked to an OOS or deviation', 'Expected (known cause)'];
export const n3 = (v, d = 3) => { if (v === null || v === undefined || Number.isNaN(Number(v))) return ''; const x = Number(v); const a = Math.abs(x); if (a !== 0 && (a >= 1e5 || a < 1e-3)) return x.toExponential(2); return String(Number(x.toPrecision(d + (a >= 100 ? 1 : 0)))); };
export const shown = (p, v) => (v === null || v === undefined ? '' : p.chart === 'p' ? n3(v * 100) + ' %' : n3(v) + (p.unit && p.unit !== 'count' ? ' ' + p.unit : ''));
export const d10 = (t) => (t ? String(t).slice(0, 10) : '');
export const safe = (s) => String(s || 'trend').replace(/:\s*/g, ' - ').replace(/[\\/*?"<>|]/g, '-').slice(0, 90);

const TABS = [['watch', '#/trending', 'Trend watch'], ['build', '#/trending/build', 'Build a chart'], ['charts', '#/trending/charts', 'Saved charts'], ['reports', '#/trending/reports', 'Report packs']];
export function TrendTabs({ on }) {
  return <div className="tabs">{TABS.map(([k, h, t]) => <a key={k} className={`tab ${on === k ? 'on' : ''}`} href={h}>{t}</a>)}</div>;
}

// The backend's chart pictures are SVG markup it draws itself from LIMS numbers (server/trending.js); they are the
// only HTML put into the page here (dangerouslySetInnerHTML), never other data.
const ServerSvg = ({ svg, className = 'svg' }) => <div className={className} dangerouslySetInnerHTML={{ __html: svg || '' }} />;

// ---------------------------------------------------------------- downloads
function svgBlob(svg) { return new Blob([/xmlns=/.test(svg.slice(0, 200)) ? svg : svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')], { type: 'image/svg+xml' }); }
async function svgToPng(svg, name) {
  const img = new Image(); const url = URL.createObjectURL(svgBlob(svg));
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('The picture could not be drawn')); img.src = url; });
  const vb = (svg.match(/viewBox="0 0 (\d+) (\d+)"/) || [0, 1000, 400]).slice(1).map(Number);
  const k = 2; const c = document.createElement('canvas'); c.width = vb[0] * k; c.height = vb[1] * k;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  await new Promise((ok) => c.toBlob((b) => { saveBlob(b, name); ok(); }, 'image/png'));
}
function csvOf(p) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  if (p.bars) return ['Category,Count,Cumulative %', ...p.bars.map((b) => [b.label, b.n, b.cum_pct.toFixed(1)].map(q).join(','))].join('\r\n');
  const sig = (i) => (p.signals || []).filter((s) => s.i === i).map((s) => s.rule).join(' ');
  const yl = q(p.yLabel || 'Value');
  const head = p.chart === 'regression' ? `Point,Months on stability,${yl},Condition` : `Point,${q(p.xLabel || 'Date')},${yl},Detail,Centre line,Signals`;
  const rows = (p.points || []).map((x, i) => (p.chart === 'regression' ? [x.label, n3(x.x, 4), x.v, x.seriesName] : [x.label, d10(x.t), p.chart === 'p' ? x.v * 100 : x.v, x.sub || (x.n ? `${x.d} of ${x.n}` : ''), x.cl ?? '', sig(i)]).map(q).join(','));
  return [head, ...rows].join('\r\n');
}
const panelDef = (p, ctx) => ({ source: p.source, title: p.title, params: { ...(p.params || {}), include_batches: undefined }, rules: ctx.rules, frozen: ctx.frozen || null });

// ---------------------------------------------------------------- one chart panel
function Facts({ p }) {
  const st = p.stats || {};
  if (p.chart === 'pareto') return <><span><b>{p.total}</b> in the period</span>{p.bars.length > 0 && <span>Top: <b>{p.bars[0].label}</b> ({p.bars[0].n})</span>}</>;
  if (p.chart === 'regression') {
    return (p.fits || []).length ? (p.fits || []).map((x, i) => <span key={i}><b>{x.name}</b>: {x.note}{x.slope !== undefined ? ` · slope ${n3(x.slope)} per month · r² ${n3(x.r2, 2)}` : ''}</span>)
      : <span>No pulls with results yet</span>;
  }
  const sig = p.signals || [];
  const toReview = sig.filter((s) => !s.review).length;
  return <>
    <span><b>{(p.points || []).length}</b> points</span>
    {st.cl !== null && st.cl !== undefined && <span>Centre line <b>{shown(p, st.cl)}</b>{st.frozen ? ' (frozen)' : ''}</span>}
    {p.chart === 'i' && st.ucl !== null && st.ucl !== undefined && <span>Limits <b>{n3(st.lcl)}</b> to <b>{n3(st.ucl)}</b></span>}
    {p.chart === 'c' && st.ucl !== undefined && <span>Upper limit <b>{n3(st.ucl)}</b></span>}
    {(p.lsl !== null || p.usl !== null) && <span>{p.limitsLabel || 'Limits'}: <b>{[p.lsl !== null ? '≥ ' + n3(p.lsl) : '', p.usl !== null ? '≤ ' + n3(p.usl) : ''].filter(Boolean).join(' and ')}</b></span>}
    {sig.length ? <span className="trpill bad">{sig.length} signal{sig.length === 1 ? '' : 's'}{toReview ? `, ${toReview} to review` : ''}</span> : <span className="trpill ok">In control</span>}
  </>;
}
function Capability({ p }) {
  const c = p.capability; if (!c || p.chart !== 'i') return null;
  const box = (k, v, good) => (v === undefined || v === null || !Number.isFinite(v) ? null : <div className={good ? 'ok' : 'bad'}><b>{n3(v, 2)}</b>{k}</div>);
  return <>
    <div className="trcap">{box('Cp (spread vs. limits)', c.cp, c.cp >= 1.33)}{box('Cpk (within)', c.cpk, c.cpk >= 1.33)}{box('Ppk (overall)', c.ppk, c.ppk >= 1.33)}
      <div><b>{n3(p.stats.sigmaWithin)}</b>sigma within</div><div><b>{n3(p.stats.sdOverall)}</b>SD overall</div></div>
    <div className="help" style={{ fontSize: 11.5, color: 'var(--muted)' }}>Capability against the {(p.limitsLabel || 'limits').toLowerCase()}: 1.33 or more is capable.{c.note ? ' ' + c.note + '.' : ''}</div>
  </>;
}
function Signals({ p, ctx, onReview }) {
  const sig = p.signals || []; if (!sig.length) return null;
  return (
    <table className="trsig"><thead><tr><th>Point</th><th>Value</th><th>Rule</th><th>What it means</th><th>Review</th></tr></thead>
      <tbody>{sig.map((s, k) => {
        const pt = p.points[s.i] || {};
        return <tr key={k}>
          <td>{pt.href ? <a href={pt.href}>{s.label}</a> : s.label}<div className="cmt">{d10(pt.t)}{pt.sub ? ' · ' + pt.sub : ''}</div></td>
          <td>{shown(p, pt.v)}</td><td className="rule">{s.rule}</td><td>{s.text}</td>
          <td>{s.review ? <><span className="done">{s.review.outcome}</span><div className="cmt">{s.review.comment} ({s.review.reviewed_by_name}, {d10(s.review.reviewed_at)})</div></>
            : ctx.chartId && ctx.canManage ? <button type="button" className="btn" onClick={() => onReview(s)}>Review…</button>
              : <span className="cmt">{ctx.chartId ? 'Not reviewed' : 'Save the chart to review signals'}</span>}</td>
        </tr>;
      })}</tbody></table>
  );
}
const BAR_COLS = [{ field: 'label', title: 'Category', type: 'readonly', width: 320 }, { field: 'n', title: 'Count', type: 'readonly', width: 80 }, { field: 'cum', title: 'Cumulative', type: 'readonly', width: 100 }];
function DataView({ p }) {
  if (p.bars) return <ReadGrid rows={p.bars.map((b, i) => ({ ...b, id: i, cum: b.cum_pct.toFixed(1) + ' %' }))} columns={BAR_COLS} />;
  const rows = (p.points || []).map((x, i) => ({ id: i, label: x.label, href: x.href, when: p.chart === 'regression' ? n3(x.x) + ' mo' : d10(x.t), value: shown(p, x.v), detail: p.chart === 'regression' ? x.seriesName : x.sub || (x.n ? `${x.d} of ${x.n}` : ''),
    sig: (p.signals || []).filter((s) => s.i === i).map((s) => s.rule).join(' ') })).reverse();
  const columns = [
    { field: 'label', title: 'Point', type: rows.some((r) => r.href) ? 'link' : 'readonly', width: 190, href: (r) => r.href || '' },
    { field: 'when', title: p.chart === 'regression' ? 'Months on stability' : p.xLabel || 'Date', type: 'readonly', width: 130 }, { field: 'value', title: p.yLabel || 'Value', type: 'readonly', width: 170 },
    { field: 'detail', title: 'Detail', type: 'readonly', width: 300 }, { field: 'sig', title: 'Signals', type: 'readonly', width: 90 }];
  return <ReadGrid rows={rows} columns={columns} search rowClass={(r) => (r.sig ? 'tbfail' : '')} />;
}

// ctx: { chartId, canManage, reload, multi, from, to, rules, frozen }
export function TrendPanel({ p, ctx = {} }) {
  const { site } = useSession();
  const toast = useToast();
  const dialogs = useDialogs();
  const [view, setView] = useState('chart');
  if (p.error) return <div className="trpanel"><h3 style={{ margin: '0 0 4px', fontSize: 14 }}>{p.title}</h3><div className="trempty">{p.error}</div></div>;
  const ctl = ['i', 'p', 'c'].includes(p.chart);

  async function download(k) {
    const name = safe(p.title);
    try {
      if (k === 'png') await svgToPng(p.svg, name + '.png');
      else if (k === 'svg') saveBlob(svgBlob(p.svg), name + '.svg');
      else if (k === 'csv') saveBlob(new Blob(['﻿' + csvOf(p)], { type: 'text/csv' }), name + '.csv');
      else if (k === 'xlsx') await downloadTrend('/export.xlsx', panelDef(p, ctx), name + '.xlsx', site?.id);
      else if (k === 'pdf') await downloadTrend('/pdf', ctx.chartId && !ctx.multi ? { chart_id: ctx.chartId, from: ctx.from, to: ctx.to } : panelDef(p, ctx), name + '.pdf', site?.id);
      toast(`${name}.${k} downloaded.`);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function review(s) {
    const pt = p.points[s.i] || {};
    const r = await dialogs.form({ title: `Review signal ${s.rule} at ${s.label}`, okText: 'Save review',
      intro: <><b>{s.text}</b><br />{p.title} · {d10(pt.t)} · {shown(p, pt.v)}. The review is kept with the chart; it does not change the record charted.</>,
      fields: [{ name: 'outcome', label: 'Outcome', type: 'select', options: OUTCOMES, required: true },
        { name: 'comment', label: 'What was found', type: 'textarea', required: true, help: 'For example: the probe was moved during cleaning; or OOS-00012 covers it.' }],
      submit: (v) => reviewSignal({ chart_id: ctx.chartId, point_key: s.key, point_label: `${s.label} (${d10(pt.t)})`, rule: s.rule, outcome: v.outcome, comment: v.comment, reason: 'Trend signal reviewed' }) });
    if (r) { toast('Review saved.'); ctx.reload?.(); }
  }
  const views = p.chart === 'i'
    ? [['chart', 'Individuals'], ...(p.mrSvg ? [['mr', 'Moving range']] : []), ...(p.hist ? [['hist', 'Histogram and capability']] : []), ['data', 'Data']]
    : [['chart', 'Chart'], ['data', 'Data']];
  return (
    <div className="trpanel">
      <div className="ph"><div className="facts" style={{ margin: 0 }}><Facts p={p} /></div>
        <div className="dl"><span className="trpill">Download</span>{['png', 'svg', 'csv', 'xlsx', 'pdf'].map((k) => <button key={k} type="button" className="btn ghost" onClick={() => download(k)}>{k === 'xlsx' ? 'Excel' : k.toUpperCase()}</button>)}</div></div>
      <div className="views">{views.map(([k, t]) => <button key={k} type="button" className={view === k ? 'on' : undefined} onClick={() => setView(k)}>{t}</button>)}</div>
      {view === 'chart' && <ServerSvg svg={p.svg} />}
      {view === 'mr' && <><ServerSvg svg={p.mrSvg} /><div className="help" style={{ fontSize: 11.5, color: 'var(--muted)' }}>The moving range is the difference between each point and the one before it; a point above its upper limit is a jump bigger than the process normally makes.</div></>}
      {view === 'hist' && <><ServerSvg svg={p.hist} /><Capability p={p} /></>}
      {view === 'data' && <DataView p={p} />}
      {(ctl || p.chart === 'regression') && <Signals p={p} ctx={ctx} onReview={review} />}
    </div>
  );
}

// Panels with their titles (a chart with one panel each, a drawing, a pack)
export function Panels({ panels, ctx, withTitles = true, margin = '4px 0 6px' }) {
  return panels.map((p, i) => <div key={i}>{withTitles && <h3 style={{ margin }}>{p.title}</h3>}<TrendPanel p={p} ctx={ctx} /></div>);
}

// ---------------------------------------------------------------- QC Review: the QC charts applied to this batch's test
// <ReviewTrends batchId={id} />: nothing when the test has no approved QC chart in QC Review (or the trends cannot load)
export function ReviewTrends({ batchId }) {
  const { data: d } = useApi(() => getReviewTrends(batchId).catch(() => null), [batchId]);
  if (!d || !d.panels || !d.panels.length) return null;
  const flagged = d.panels.reduce((n, p) => n + (p.batch_signals || []).length, 0);
  return <>
    <div className="rvhead"><h3>Trends <small className="tbmuted">{flagged ? <span className="trpill bad">{flagged} signal{flagged === 1 ? '' : 's'} at this batch</span> : 'this batch\'s QC is ringed in blue; no signal at this batch'}</small></h3></div>
    <div className="trrev">{d.panels.map((p, i) => <div key={i}>
      <h4><a href={'#/trending/charts/' + p.chart_id}>{p.chart_code}</a> {p.title}{(p.batch_signals || []).length > 0 && <> · <span className="trpill bad">{p.batch_signals.map((s) => `${s.rule} at ${s.label}`).join('; ')}</span></>}</h4>
      <TrendPanel p={p} ctx={{ chartId: p.chart_id, canManage: false }} />
    </div>)}</div>
  </>;
}
