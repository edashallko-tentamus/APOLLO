// Trending and control charts (T-1, migration 043; built without Alex's input on his instruction, 2026-10-17).
// Anything the lab records again and again can be charted: final results (one test and analyte, filtered by client,
// matrix or product), QC checks of approved batches, logbook fields (temperatures, balance errors, inoculum counts),
// stability pulls (regression per condition with the shelf life where the 95 % bound meets the specification), and
// counts of events per week or month (OOS investigations, re-preparations, re-analyses, failed equipment checks,
// chamber excursions, lots rejected, on-time reporting, turnaround), plus Pareto breakdowns.
// Pages: Trend watch (#/trending: every watched chart, latest point and open signals), Build a chart
// (#/trending/build), Saved charts (#/trending/charts and one chart), Report packs (#/trending/reports).
// QC Review shows the QC charts applied to the batch's test with the batch's points ringed (reviewTrends below).
// Downloads: PNG and SVG (drawn here from the chart), CSV, Excel and PDF (built by the server from the definition).
// 0.24.1 (Alex's notes, 2026-10-19): axes name their quantity and unit; a QA reviewable chart waits for QA's signed
// approval (Saved charts "Awaiting QA", QA's to-do widget); an approved QC chart's frozen limits go into the test's Draft
// version ("Use these limits for the test"); Trend watch downloads every saved chart as one PDF.
import { api, esc, pageHeader, toast, state, can, modal, askReason, link, signDialog } from '../app.js';
import { Grid } from '../grid.js';

const css = document.createElement('style');
css.textContent = `
.trbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: -2px 0 12px; }
.trbar .sp { flex: 1; } .trbar label { font-size: 12.5px; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.trbar input, .trbar select { font: inherit; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; }
.trwatch { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.trtile { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.trtile.open { border-color: #e2a39b; box-shadow: inset 4px 0 0 #c0392b; }
.trtile h3 { margin: 0; font-size: 13.5px; font-weight: 650; line-height: 1.3; } .trtile h3 a { color: var(--ink); text-decoration: none; } .trtile h3 a:hover { text-decoration: underline; }
.trtile .code { color: var(--muted); font-size: 11.5px; font-weight: 400; }
.trtile .last { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; color: var(--muted); }
.trtile .last { gap: 8px; } .trtile .last b { font-size: 20px; color: var(--ink); font-variant-numeric: tabular-nums; letter-spacing: -.3px; white-space: nowrap; }
.trtile .of { display: block; color: var(--muted); font-size: 11.5px; font-weight: 400; margin-top: 1px; }
.trpill { display: inline-block; font-size: 11.5px; border-radius: 10px; padding: 1px 8px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.trpill.bad { background: #fde8e6; border-color: #f2b8b1; color: #a02a1d; } .trpill.ok { background: #e9f5ee; border-color: #b9dcc7; color: #1d6b3f; } .trpill.info { background: #eef4fa; border-color: #c4d7ea; color: #2b5d8a; }
.trtile ul { margin: 0; padding-left: 16px; font-size: 12px; color: #7a2d22; } .trtile .err { color: var(--err-ink); font-size: 12px; }
.trbuild { display: grid; grid-template-columns: 310px minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 900px) { .trbuild { grid-template-columns: 1fr; } }
.trform { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; position: sticky; top: 8px; }
.trform h3 { margin: 4px 0 8px; font-size: 13px; } .trform .field { margin-bottom: 9px; } .trform label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 3px; }
.trform select, .trform input[type=text], .trform input[type=date] { width: 100%; font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; box-sizing: border-box; background: #fff; }
.trsrc { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }
.trsrc button { font: inherit; font-size: 12.5px; text-align: left; border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 7px 9px; cursor: pointer; line-height: 1.25; }
.trsrc button small { display: block; color: var(--muted); font-size: 11px; margin-top: 2px; } .trsrc button.on { border-color: var(--green-700); background: #eef6f1; box-shadow: inset 0 0 0 1px var(--green-700); }
.trrules { display: grid; grid-template-columns: 1fr; gap: 3px; font-size: 12px; } .trrules label { display: flex; gap: 6px; align-items: flex-start; color: var(--ink); margin: 0; font-size: 12px; }
.trform .row2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; } .trform .row2 input { min-width: 0; padding: 6px 4px; } .trform .acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.trpanel { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; min-width: 0; }
.trpanel .svg svg { width: 100%; height: auto; display: block; } .trpanel .svg.small svg { max-height: 220px; }
.trpanel .facts { display: flex; gap: 6px 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); margin: 6px 0; } .trpanel .facts b { color: var(--ink); font-weight: 600; }
.trpanel .dl { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; } .trpanel .dl button, .trpanel .dl a { font-size: 12px; padding: 3px 9px; }
.trpanel .ph { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
.trpanel .views { display: flex; gap: 4px; margin: 8px 0 4px; } .trpanel .views button { font: inherit; font-size: 12px; border: 1px solid var(--line); background: #fff; border-radius: 6px; padding: 3px 9px; cursor: pointer; }
.trpanel .views button.on { background: #24313d; color: #fff; border-color: #24313d; }
.trsig { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 6px; } .trsig th { text-align: left; color: var(--muted); font-weight: 600; font-size: 11.5px; padding: 4px 6px; border-bottom: 1px solid var(--line); }
.trsig td { padding: 5px 6px; border-bottom: 1px solid #eef1f3; vertical-align: top; } .trsig .rule { font-weight: 700; color: #a02a1d; } .trsig .done { color: #1d6b3f; }
.trsig .cmt { color: var(--muted); font-size: 12px; } .trempty { color: var(--muted); font-size: 13px; padding: 20px 4px; }
.trcap { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); gap: 6px; margin: 6px 0; } .trcap div { background: #f6f8f9; border-radius: 7px; padding: 6px 8px; font-size: 11.5px; color: var(--muted); }
.trcap b { display: block; font-size: 16px; color: var(--ink); font-variant-numeric: tabular-nums; } .trcap .bad b { color: #a02a1d; } .trcap .ok b { color: #1d6b3f; }
.trfrozen { background: #f3effc; border: 1px solid #d9cdf5; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; margin-bottom: 12px; }
.trqa { background: #f4f7f9; border-color: #dbe3e8; } .trqa.wait { background: #fff6e5; border-color: #f0c36d; } .trqa.ok { background: #eef7f1; border-color: #bfe0cb; }
.trqa .btn { margin-left: 6px; }
.trpacks { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 12px; }
.trpacks button { font: inherit; text-align: left; border: 1px solid var(--line); background: #fff; border-radius: 10px; padding: 10px 12px; cursor: pointer; }
.trpacks button b { display: block; font-size: 13.5px; margin-bottom: 3px; } .trpacks button span { font-size: 12px; color: var(--muted); line-height: 1.35; display: block; }
.trpacks button.on { border-color: var(--green-700); box-shadow: inset 0 0 0 1px var(--green-700); background: #f3f9f5; }
.trrev { margin-top: 6px; } .trrev .trpanel { padding: 8px 10px; } .trrev h4 { margin: 0 0 4px; font-size: 13px; }
`;
document.head.appendChild(css);

const SOURCES = [
  ['results', 'Results', 'One analyte of one test, from final results'],
  ['qc', 'QC checks', 'Controls, blanks and recoveries of approved batches'],
  ['logbook', 'Logbooks', 'A number recorded in a logbook'],
  ['stability', 'Stability', 'A study\'s pulls over time, per condition'],
  ['counts', 'Events over time', 'OOS, re-preparations, failures, turnaround'],
  ['pareto', 'Pareto', 'What the events are made of'],
];
const CONTROL = ['results', 'qc', 'logbook', 'counts'];
const OUTCOMES = ['Investigated: no action', 'Action taken', 'Linked to an OOS or deviation', 'Expected (known cause)'];
const n3 = (v, d = 3) => { if (v === null || v === undefined || Number.isNaN(Number(v))) return ''; const x = Number(v); const a = Math.abs(x); if (a !== 0 && (a >= 1e5 || a < 1e-3)) return x.toExponential(2); return String(Number(x.toPrecision(d + (a >= 100 ? 1 : 0)))); };
const shown = (p, v) => (v === null || v === undefined ? '' : p.chart === 'p' ? n3(v * 100) + ' %' : n3(v) + (p.unit && p.unit !== 'count' ? ' ' + p.unit : ''));
const d10 = (t) => (t ? String(t).slice(0, 10) : '');
const tabs = (on) => `<div class="tabs">${[['watch', '#/trending', 'Trend watch'], ['build', '#/trending/build', 'Build a chart'], ['charts', '#/trending/charts', 'Saved charts'], ['reports', '#/trending/reports', 'Report packs']]
  .map(([k, h, t]) => `<a class="tab ${on === k ? 'on' : ''}" href="${h}">${t}</a>`).join('')}</div>`;
let OPTS = null; let OPTS_SITE = null;
async function options() { if (!OPTS || OPTS_SITE !== state.site) { OPTS = await api('/trending/options'); OPTS_SITE = state.site; } return OPTS; }

// ---------------------------------------------------------------- downloads
const safe = (s) => String(s || 'trend').replace(/:\s*/g, ' - ').replace(/[\\/*?"<>|]/g, '-').slice(0, 90);
function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
async function postDownload(path, body, name) {
  const res = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-site-id': state.site || '' }, body: JSON.stringify(body) });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'The download failed'); }
  save(await res.blob(), name);
}
function svgBlob(svg) { return new Blob([/xmlns=/.test(svg.slice(0, 200)) ? svg : svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')], { type: 'image/svg+xml' }); }
async function svgToPng(svg, name) {
  const img = new Image(); const url = URL.createObjectURL(svgBlob(svg));
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('The picture could not be drawn')); img.src = url; });
  const vb = (svg.match(/viewBox="0 0 (\d+) (\d+)"/) || [0, 1000, 400]).slice(1).map(Number);
  const k = 2; const c = document.createElement('canvas'); c.width = vb[0] * k; c.height = vb[1] * k;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  c.toBlob((b) => save(b, name), 'image/png');
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
const panelDef = (p, extra = {}) => ({ source: p.source, title: p.title, params: { ...(p.params || {}), include_batches: undefined }, rules: extra.rules, frozen: extra.frozen || null });
function wireDownloads(el, p, ctx) {
  el.querySelectorAll('[data-dl]').forEach((b) => { b.onclick = async () => {
    const k = b.dataset.dl; const name = safe(p.title);
    try {
      if (k === 'png') await svgToPng(p.svg, name + '.png');
      else if (k === 'svg') save(svgBlob(p.svg), name + '.svg');
      else if (k === 'csv') save(new Blob(['﻿' + csvOf(p)], { type: 'text/csv' }), name + '.csv');
      else if (k === 'xlsx') await postDownload('/trending/export.xlsx', panelDef(p, ctx), name + '.xlsx');
      else if (k === 'pdf') await postDownload('/trending/pdf', ctx.chartId && !ctx.multi ? { chart_id: ctx.chartId, from: ctx.from, to: ctx.to } : { ...panelDef(p, ctx), params: { ...(p.params || {}), include_batches: undefined } }, name + '.pdf');
      toast(`${name}.${k} downloaded.`);
    } catch (e) { toast(e.message, 'err'); }
  }; });
}

// ---------------------------------------------------------------- one chart panel
function factsOf(p) {
  const st = p.stats || {}; const f = [];
  if (p.chart === 'pareto') return `<span><b>${p.total}</b> in the period</span>${p.bars.length ? `<span>Top: <b>${esc(p.bars[0].label)}</b> (${p.bars[0].n})</span>` : ''}`;
  if (p.chart === 'regression') return (p.fits || []).map((x) => `<span><b>${esc(x.name)}</b>: ${esc(x.note)}${x.slope !== undefined ? ` · slope ${n3(x.slope)} per month · r² ${n3(x.r2, 2)}` : ''}</span>`).join('') || '<span>No pulls with results yet</span>';
  f.push(`<span><b>${(p.points || []).length}</b> points</span>`);
  if (st.cl !== null && st.cl !== undefined) f.push(`<span>Centre line <b>${shown(p, st.cl)}</b>${st.frozen ? ' (frozen)' : ''}</span>`);
  if (p.chart === 'i' && st.ucl !== null && st.ucl !== undefined) f.push(`<span>Limits <b>${n3(st.lcl)}</b> to <b>${n3(st.ucl)}</b></span>`);
  if (p.chart === 'c' && st.ucl !== undefined) f.push(`<span>Upper limit <b>${n3(st.ucl)}</b></span>`);
  if (p.lsl !== null || p.usl !== null) f.push(`<span>${esc(p.limitsLabel || 'Limits')}: <b>${[p.lsl !== null ? '≥ ' + n3(p.lsl) : '', p.usl !== null ? '≤ ' + n3(p.usl) : ''].filter(Boolean).join(' and ')}</b></span>`);
  const sig = p.signals || [];
  f.push(sig.length ? `<span class="trpill bad">${sig.length} signal${sig.length === 1 ? '' : 's'}${sig.some((s) => !s.review) ? `, ${sig.filter((s) => !s.review).length} to review` : ''}</span>` : '<span class="trpill ok">In control</span>');
  return f.join('');
}
function capHtml(p) {
  const c = p.capability; if (!c || p.chart !== 'i') return '';
  const box = (k, v, good) => (v === undefined || v === null || !Number.isFinite(v) ? '' : `<div class="${good === null ? '' : good ? 'ok' : 'bad'}"><b>${n3(v, 2)}</b>${k}</div>`);
  return `<div class="trcap">${box('Cp (spread vs. limits)', c.cp, c.cp >= 1.33)}${box('Cpk (within)', c.cpk, c.cpk >= 1.33)}${box('Ppk (overall)', c.ppk, c.ppk >= 1.33)}
    <div><b>${n3(p.stats.sigmaWithin)}</b>sigma within</div><div><b>${n3(p.stats.sdOverall)}</b>SD overall</div></div>
    <div class="help" style="font-size:11.5px;color:var(--muted)">Capability against the ${esc((p.limitsLabel || 'limits').toLowerCase())}: 1.33 or more is capable.${c.note ? ' ' + esc(c.note) + '.' : ''}</div>`;
}
function signalsHtml(p, ctx) {
  const sig = p.signals || []; if (!sig.length) return '';
  return `<table class="trsig"><thead><tr><th>Point</th><th>Value</th><th>Rule</th><th>What it means</th><th>Review</th></tr></thead><tbody>${sig.map((s, k) => {
    const pt = p.points[s.i] || {};
    return `<tr><td>${pt.href ? link(pt.href, s.label) : esc(s.label)}<div class="cmt">${esc(d10(pt.t))}${pt.sub ? ' · ' + esc(pt.sub) : ''}</div></td><td>${esc(shown(p, pt.v))}</td><td class="rule">${esc(s.rule)}</td><td>${esc(s.text)}</td>
      <td>${s.review ? `<span class="done">${esc(s.review.outcome)}</span><div class="cmt">${esc(s.review.comment)} (${esc(s.review.reviewed_by_name)}, ${esc(d10(s.review.reviewed_at))})</div>`
        : ctx.chartId && ctx.canManage ? `<button class="btn" data-rev="${k}">Review…</button>` : `<span class="cmt">${ctx.chartId ? 'Not reviewed' : 'Save the chart to review signals'}</span>`}</td></tr>`;
  }).join('')}</tbody></table>`;
}
function renderPanel(host, p, ctx = {}) {
  const el = document.createElement('div'); el.className = 'trpanel';
  if (p.error) { el.innerHTML = `<h3 style="margin:0 0 4px;font-size:14px">${esc(p.title)}</h3><div class="trempty">${esc(p.error)}</div>`; host.appendChild(el); return el; }
  const ctl = ['i', 'p', 'c'].includes(p.chart);
  el.innerHTML = `<div class="ph"><div class="facts" style="margin:0">${factsOf(p)}</div>
      <div class="dl"><span class="trpill">Download</span>${['png', 'svg', 'csv', 'xlsx', 'pdf'].map((k) => `<button class="btn ghost" data-dl="${k}">${k === 'xlsx' ? 'Excel' : k.toUpperCase()}</button>`).join('')}</div></div>
    ${p.chart === 'i' ? `<div class="views"><button data-v="chart" class="on">Individuals</button>${p.mrSvg ? '<button data-v="mr">Moving range</button>' : ''}${p.hist ? '<button data-v="hist">Histogram and capability</button>' : ''}<button data-v="data">Data</button></div>`
      : `<div class="views"><button data-v="chart" class="on">Chart</button><button data-v="data">Data</button></div>`}
    <div class="vw" data-w="chart"><div class="svg">${p.svg || ''}</div></div>
    ${p.mrSvg ? `<div class="vw" data-w="mr" hidden><div class="svg">${p.mrSvg}</div><div class="help" style="font-size:11.5px;color:var(--muted)">The moving range is the difference between each point and the one before it; a point above its upper limit is a jump bigger than the process normally makes.</div></div>` : ''}
    ${p.hist ? `<div class="vw" data-w="hist" hidden><div class="svg">${p.hist}</div>${capHtml(p)}</div>` : ''}
    <div class="vw" data-w="data" hidden><div class="dg"></div></div>
    ${ctl || p.chart === 'regression' ? signalsHtml(p, ctx) : ''}`;
  host.appendChild(el);
  el.querySelectorAll('.views button').forEach((b) => { b.onclick = () => {
    el.querySelectorAll('.views button').forEach((x) => x.classList.toggle('on', x === b));
    el.querySelectorAll('.vw').forEach((w) => { w.hidden = w.dataset.w !== b.dataset.v; });
    if (b.dataset.v === 'data' && !el._grid) el._grid = dataGrid(el.querySelector('.dg'), p);
  }; });
  wireDownloads(el, p, ctx);
  el.querySelectorAll('[data-rev]').forEach((b) => { b.onclick = () => reviewSignal(p, p.signals[Number(b.dataset.rev)], ctx); });
  return el;
}
function dataGrid(g, p) {
  if (p.bars) return new Grid(g, { readOnly: true, rows: p.bars.map((b, i) => ({ ...b, id: i, cum: b.cum_pct.toFixed(1) + ' %' })), columns: [
    { field: 'label', title: 'Category', type: 'readonly', width: 320 }, { field: 'n', title: 'Count', type: 'readonly', width: 80 }, { field: 'cum', title: 'Cumulative', type: 'readonly', width: 100 }] });
  const rows = (p.points || []).map((x, i) => ({ id: i, label: x.label, href: x.href, when: p.chart === 'regression' ? n3(x.x) + ' mo' : d10(x.t), value: shown(p, x.v), detail: p.chart === 'regression' ? x.seriesName : x.sub || (x.n ? `${x.d} of ${x.n}` : ''),
    sig: (p.signals || []).filter((s) => s.i === i).map((s) => s.rule).join(' ') }));
  return new Grid(g, { readOnly: true, search: true, rows: rows.reverse(), rowClass: (r) => (r.sig ? 'tbfail' : ''), columns: [
    { field: 'label', title: 'Point', type: rows.some((r) => r.href) ? 'link' : 'readonly', width: 190, href: (r) => r.href || '' },
    { field: 'when', title: p.chart === 'regression' ? 'Months on stability' : p.xLabel || 'Date', type: 'readonly', width: 130 }, { field: 'value', title: p.yLabel || 'Value', type: 'readonly', width: 170 },
    { field: 'detail', title: 'Detail', type: 'readonly', width: 300 }, { field: 'sig', title: 'Signals', type: 'readonly', width: 90 }] });
}
async function reviewSignal(p, s, ctx) {
  const pt = p.points[s.i] || {};
  const r = await modal({ title: `Review signal ${s.rule} at ${s.label}`, intro: `<b>${esc(s.text)}</b><br>${esc(p.title)} · ${esc(d10(pt.t))} · ${esc(shown(p, pt.v))}. The review is kept with the chart; it does not change the record charted.`,
    fields: [{ name: 'outcome', label: 'Outcome', type: 'select', options: OUTCOMES, required: true }, { name: 'comment', label: 'What was found', type: 'textarea', required: true, help: 'For example: the probe was moved during cleaning; or OOS-00012 covers it.' }], okText: 'Save review' });
  if (!r) return;
  try { await api('/trending/signals/review', { method: 'POST', body: { chart_id: ctx.chartId, point_key: s.key, point_label: `${s.label} (${d10(pt.t)})`, rule: s.rule, outcome: r.outcome, comment: r.comment, reason: 'Trend signal reviewed' } });
    toast('Review saved.'); ctx.reload && ctx.reload(); } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------- Trend watch
function spark(r) {
  const v = (r.spark || []).filter((x) => x !== null); if (v.length < 2) return '<svg viewBox="0 0 280 54" width="100%" height="54"></svg>';
  const all = [...v, r.ucl, r.lcl, r.cl].filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x))).map(Number);
  let lo = Math.min(...all); let hi = Math.max(...all); if (lo === hi) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.08;
  const X = (i) => 4 + (i * 272) / (v.length - 1); const Y = (y) => 50 - ((y - lo + pad) * 46) / (hi - lo + 2 * pad);
  const hl = (y, c, dash) => (y === null || y === undefined ? '' : `<line x1="4" x2="276" y1="${Y(Number(y)).toFixed(1)}" y2="${Y(Number(y)).toFixed(1)}" stroke="${c}" stroke-width="1" ${dash ? 'stroke-dasharray="3 3"' : ''}/>`);
  return `<svg viewBox="0 0 280 54" width="100%" height="54" aria-hidden="true">${hl(r.ucl, '#b45309', 1)}${hl(r.lcl, '#b45309', 1)}${hl(r.cl, '#1f7a52')}
    <polyline fill="none" stroke="#34495e" stroke-width="1.5" points="${v.map((y, i) => `${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}"/>
    <circle cx="${X(v.length - 1).toFixed(1)}" cy="${Y(v[v.length - 1]).toFixed(1)}" r="3" fill="${r.open ? '#c0392b' : '#34495e'}"/></svg>`;
}
export async function watch(main) {
  const d = await api('/trending/watch');
  const only = state.query.get('show') === 'open';
  const rows = d.rows.filter((r) => !only || r.open).sort((a, b) => (b.open > 0) - (a.open > 0) || a.chart_code.localeCompare(b.chart_code));
  const open = d.rows.filter((r) => r.open).length;
  main.innerHTML = pageHeader('Trending', 'Every chart on watch, its latest point and the signals nobody has reviewed yet. A signal is a pattern that is unlikely by chance (a point beyond 3 sigma, a run on one side, a steady climb): open the chart to see it and record what was found.',
    '', { kind: 'trending' })
    + tabs('watch')
    + `<div class="trbar"><span class="trpill ${open ? 'bad' : 'ok'}">${open ? `${open} chart${open === 1 ? '' : 's'} with signals to review` : 'Nothing to review'}</span><span class="sp"></span>
       <label><input type="checkbox" id="onlyopen" ${only ? 'checked' : ''}> Only charts with signals to review</label>
       <button class="btn primary" id="dlall" title="Every saved chart of the lab, each with all its panels (every analyte, QC check or piece of equipment), in one PDF">Download all (PDF)</button></div>
     <div class="trwatch" id="w"></div>`;
  main.querySelector('#onlyopen').onchange = (e) => { location.hash = e.target.checked ? '#/trending?show=open' : '#/trending'; };
  main.querySelector('#dlall').onclick = (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Making the PDF…';
    postDownload('/trending/pdf', { pack: 'all' }, 'All saved charts.pdf').then(() => toast('PDF downloaded: every saved chart.')).catch((x) => toast(x.message, 'err'))
      .finally(() => { b.disabled = false; b.textContent = 'Download all (PDF)'; }); };
  const w = main.querySelector('#w');
  if (!rows.length) { w.outerHTML = `<div class="card trempty">${d.rows.length ? 'No watched chart has a signal to review.' : 'No charts on watch yet. Build a chart (a fridge temperature, a QC recovery, OOS per month), save it, and it is watched here.'}</div>`; return; }
  w.innerHTML = rows.map((r) => {
    const last = r.last ? (r.chart === 'p' ? n3(r.last.v * 100) + ' %' : n3(r.last.v) + (r.unit && r.unit !== 'count' ? ' ' + esc(r.unit) : '')) : '';
    // a chart with a panel each: the panel (the equipment, analyte or QC check) is the heading, the chart under it
    const part = r.title && r.title.startsWith(r.chart_name + ': ') ? r.title.slice(r.chart_name.length + 2) : null;
    return `<div class="trtile ${r.open ? 'open' : ''}"><h3><a href="#/trending/charts/${r.chart_id}">${esc(part || r.title || r.chart_name)}</a>
      <span class="of">${part ? esc(r.chart_name) + ' · ' : ''}${esc(r.chart_code)}</span></h3>
      ${r.error ? `<div class="err">${esc(r.error)}</div>` : `${spark(r)}<div class="last"><span>${r.last ? `Latest ${esc(r.last.label)}${r.last.t ? ', ' + esc(d10(r.last.t)) : ''}` : r.n ? `${r.n} bars` : 'No points yet'}</span><b>${last}</b></div>
      <div>${!r.n ? '<span class="trpill">No data yet</span>' : r.open ? `<span class="trpill bad">${r.open} signal${r.open === 1 ? '' : 's'} to review</span>` : r.signals ? `<span class="trpill ok">${r.signals} signal${r.signals === 1 ? '' : 's'}, all reviewed</span>` : '<span class="trpill ok">In control</span>'}
        ${r.frozen ? ' <span class="trpill info">Limits frozen</span>' : ''}${r.show_in_review ? ' <span class="trpill info">In QC Review</span>' : ''}
        ${r.qa_status === 'Awaiting QA' ? ' <span class="trpill bad">Awaiting QA</span>' : r.qa_status === 'Approved' ? ' <span class="trpill ok">QA approved</span>' : ''}</div>
      ${r.recent.length ? `<ul>${r.recent.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`}</div>`;
  }).join('');
}

// ---------------------------------------------------------------- saved charts
export async function charts(main) {
  const d = await api('/trending/charts');
  const qaOnly = state.query.get('show') === 'qa';
  const waiting = d.rows.filter((r) => r.status === 'Active' && r.qa_status === 'Awaiting QA').length;
  main.innerHTML = pageHeader('Saved charts', 'Charts saved for the lab. Watched charts are on Trend watch; QC charts can also be shown in QC Review of the test\'s batches. A QA reviewable chart counts once QA has approved it and its limits.',
    d.can_manage ? '<a class="btn primary" href="#/trending/build">Build a chart</a>' : '', { kind: 'trending' }) + tabs('charts')
    + `<div class="trbar"><span class="trpill ${waiting ? 'bad' : 'ok'}">${waiting ? `${waiting} chart${waiting === 1 ? '' : 's'} awaiting QA approval` : 'No chart awaiting QA'}</span><span class="sp"></span>
       <label><input type="checkbox" id="qaonly" ${qaOnly ? 'checked' : ''}> Only charts awaiting QA</label></div>`
    + '<div class="card"><div id="g"></div></div>';
  main.querySelector('#qaonly').onchange = (e) => { location.hash = e.target.checked ? '#/trending/charts?show=qa' : '#/trending/charts'; };
  const srcName = Object.fromEntries(SOURCES.map(([k, t]) => [k, t]));
  const rows = qaOnly ? d.rows.filter((r) => r.status === 'Active' && r.qa_status === 'Awaiting QA') : d.rows;
  new Grid(main.querySelector('#g'), { readOnly: true, search: true, rows, emptyText: qaOnly ? 'No chart is waiting for QA.' : 'No saved charts yet.', rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''), columns: [
    { field: 'chart_code', title: 'Chart', type: 'link', width: 90, href: (r) => '#/trending/charts/' + r.id },
    { field: 'chart_name', title: 'Name', type: 'readonly', width: 300 },
    { field: 'src', title: 'Charts', type: 'readonly', width: 140, compute: (r) => srcName[r.source] || r.source },
    { field: 'w', title: 'Watched', type: 'readonly', width: 80, compute: (r) => (r.watch ? 'Yes' : '') },
    { field: 'q', title: 'In QC Review', type: 'readonly', width: 100, compute: (r) => (r.show_in_review ? 'Yes' : '') },
    { field: 'f', title: 'Limits', type: 'readonly', width: 90, compute: (r) => (r.frozen ? 'Frozen' : 'From the data') },
    { field: 'qa', title: 'QA', type: 'readonly', width: 110, compute: (r) => (r.qa_review ? r.qa_status : 'Not required'), cellClass: (r) => (r.qa_status === 'Awaiting QA' && r.status === 'Active' ? 'cwarn' : r.qa_status === 'Approved' ? 'cok' : '') },
    { field: 'description', title: 'Description', type: 'readonly', width: 300 },
    { field: 'created_by_name', title: 'Made by', type: 'readonly', width: 130 },
    { field: 'status', title: 'Status', type: 'readonly', width: 80, compute: (r) => (r.status === 'Inactive' ? 'Retired' : 'Active') },
  ] });
}
export async function chart(main, id) {
  const from = state.query.get('from') || ''; const to = state.query.get('to') || '';
  const d = await api(`/trending/charts/${id}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const ch = d.chart; const multi = d.panels.length > 1; const ctl = CONTROL.includes(ch.source);
  const retired = ch.status === 'Inactive';
  main.innerHTML = pageHeader(`${ch.chart_code} ${ch.chart_name}`, `${esc(ch.description || '')}${ch.description ? '<br>' : ''}Made by ${esc(ch.created_by_name)}. ${retired ? '<b>Retired.</b> ' : ''}${ch.watch ? 'On Trend watch. ' : ''}${ch.show_in_review ? 'Shown in QC Review of this test\'s batches.' : ''}`,
    `${d.can_manage && !retired ? `<a class="btn" href="#/trending/build?chart=${ch.id}">Change</a>${ctl && !multi ? (ch.frozen_cl !== null ? '<button class="btn" id="unfz">Recalculate limits…</button>' : '<button class="btn" id="fz">Freeze limits…</button>') : ''}<button class="btn ghost" id="ret">Retire…</button>` : ''}
     <button class="btn ghost" id="pdf">PDF of the chart</button>`, { kind: 'trend_chart', id: ch.id })
    + tabs('charts')
    + qaBanner(ch, d)
    + (ch.frozen_cl !== null ? `<div class="trfrozen"><b>Limits frozen</b> by ${esc(ch.frozen_by_name || '')} on ${esc(d10(ch.frozen_at))}: centre line ${n3(ch.frozen_cl)}${Number(ch.frozen_sigma) ? `, sigma ${n3(ch.frozen_sigma)}` : ''}, from ${ch.frozen_n} points${ch.frozen_from || ch.frozen_to ? ` between ${esc(d10(ch.frozen_from) || 'the start')} and ${esc(d10(ch.frozen_to) || 'then')}` : ''}. New points are judged against this baseline.</div>` : '')
    + `<div class="trbar"><label>From <input type="date" id="from" value="${esc(from)}"></label><label>To <input type="date" id="to" value="${esc(to)}"></label><button class="btn" id="go">Show</button>
       <span class="sp"></span><span class="help" style="font-size:12px;color:var(--muted)">Default: the last 12 months.</span></div><div id="ps"></div>`;
  const ps = main.querySelector('#ps');
  const reload = () => chart(main, id);
  for (const p of d.panels) {
    if (multi) { const h = document.createElement('h3'); h.style.margin = '6px 0 6px'; h.textContent = p.title; ps.appendChild(h); }
    renderPanel(ps, p, { chartId: ch.id, canManage: d.can_manage && !retired, reload, multi, from, to, rules: ch.rules, frozen: ch.frozen_cl !== null ? { cl: ch.frozen_cl, sigma: ch.frozen_sigma } : null });
  }
  main.querySelector('#go').onclick = () => { const f = main.querySelector('#from').value; const t = main.querySelector('#to').value; location.hash = `#/trending/charts/${id}${f || t ? `?from=${f}&to=${t}` : ''}`; };
  main.querySelector('#pdf').onclick = () => postDownload('/trending/pdf', { chart_id: ch.id, from, to }, safe(`${ch.chart_code} ${ch.chart_name}`) + '.pdf').then(() => toast('PDF downloaded.')).catch((e) => toast(e.message, 'err'));
  const fz = main.querySelector('#fz');
  if (fz) fz.onclick = async () => {
    const r = await modal({ title: 'Freeze the control limits', intro: 'The centre line and sigma are worked out from a baseline period when the process was stable, then kept: new points are judged against them instead of moving the limits with every point. Pick the baseline (at least 20 points for individuals, 6 periods for counts).',
      fields: [{ name: 'from', label: 'Baseline from', type: 'date', value: from }, { name: 'to', label: 'Baseline to', type: 'date', value: to }], okText: 'Next' });
    if (!r) return; const reason = await askReason(`the control limits of ${ch.chart_code}`); if (!reason) return;
    try { const out = await api(`/trending/charts/${ch.id}/freeze`, { method: 'POST', body: { from: r.from || null, to: r.to || null, reason } }); toast(`Limits frozen: centre line ${n3(out.cl)} from ${out.n} points.`); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const uf = main.querySelector('#unfz');
  if (uf) uf.onclick = async () => { const reason = await askReason(`the control limits of ${ch.chart_code} (back to limits from the data)`); if (!reason) return;
    try { await api(`/trending/charts/${ch.id}/unfreeze`, { method: 'POST', body: { reason } }); toast('The limits are worked out from the data again.'); reload(); } catch (e) { toast(e.message, 'err'); } };
  // QA's signed approval of the chart and its limits
  const qa = main.querySelector('#qaok');
  if (qa) qa.onclick = () => signDialog({ what: `${ch.chart_code} ${ch.chart_name}: the chart, its rules and its ${ch.frozen_cl !== null ? 'frozen ' : ''}limits`, meaning: 'Approved by', needReason: false,
    submit: ({ signature }) => api(`/trending/charts/${ch.id}/approve`, { method: 'POST', body: { signature } }) })
    .then((ok) => { if (ok) { toast(`${ch.chart_code} approved.`); reload(); } });
  // the approved, frozen limits of a QC chart into the test's Draft version (then approved as any version)
  const ap = main.querySelector('#apply');
  if (ap) ap.onclick = () => { const l = d.limits_for_test;
    signDialog({ title: 'Use these limits for the test', what: `${ch.chart_code}: ${l.qc_type} ${l.limit_type} limits ${n3(l.lcl)} to ${n3(l.ucl)} into the test's Draft version`, meaning: 'Changed by', needReason: true,
      defaultReason: `Control limits from trend chart ${ch.chart_code}`,
      submit: ({ signature, reason }) => api(`/trending/charts/${ch.id}/apply-limits`, { method: 'POST', body: { signature, reason } }) })
      .then((r) => { if (r && r.version_id) { toast(`Limits written into version ${r.version_no}${r.created ? ' (a new Draft)' : ''}: approve it in the designer.`); location.hash = `#/methods/versions/${r.version_id}?tab=workflow`; } }); };
  const rt = main.querySelector('#ret');
  if (rt) rt.onclick = async () => { const reason = await askReason(`${ch.chart_code} (retired: off Trend watch and QC Review; its reviews are kept)`); if (!reason) return;
    try { await api(`/trending/charts/${ch.id}/retire`, { method: 'POST', body: { reason } }); toast(`${ch.chart_code} retired.`); location.hash = '#/trending/charts'; } catch (e) { toast(e.message, 'err'); } };
}

// The chart's QA state, and the actions on it: QA's approval, the limits into the test
function qaBanner(ch, d) {
  const retired = ch.status === 'Inactive';
  let h = '';
  if (ch.qa_review) {
    if (ch.qa_status === 'Approved') h = `<div class="trfrozen trqa ok"><b>Approved by QA</b>: ${esc(ch.qa_approved_by_name || '')} on ${esc(d10(ch.qa_approved_at))} (electronic signature). A change to what it charts, its rules or its limits sends it back to QA.</div>`;
    else h = `<div class="trfrozen trqa wait"><b>Awaiting QA approval.</b> This chart is QA reviewable: it counts${ch.show_in_review ? ' (and appears in QC Review)' : ''} once QA has approved it and its limits. Someone with trending.approve who did not make or change it approves it.
      ${d.can_approve && !retired ? ' <button class="btn primary" id="qaok">Approve chart and limits…</button>' : ''}</div>`;
  }
  const l = d.limits_for_test;
  if (l) {
    const applied = ch.applied_version_id ? ` Last carried into ${link(`#/methods/versions/${ch.applied_version_id}`, `version ${ch.applied_version_no}`)} (${esc(ch.applied_version_status || '')}) by ${esc(ch.applied_by_name || '')} on ${esc(d10(ch.applied_at))}.` : '';
    h += l.problem ? `<div class="trfrozen trqa"><b>QC limits for the test</b>: ${esc(l.problem)}.${applied}</div>`
      : `<div class="trfrozen trqa"><b>QC limits for the test</b>: ${esc(l.qc_type)} ${esc(l.limit_type)} ${n3(l.lcl)} to ${n3(l.ucl)} (centre line ± 3 sigma, frozen, approved by QA).${applied}
        ${d.can_design && !retired ? ' <button class="btn" id="apply">Use these limits for the test…</button>' : ''}<div class="help" style="font-size:11.5px;color:var(--muted)">They go into the test's Draft version (a new one from the effective version if there is none), signed with a reason; the version is then approved in the designer as usual.</div></div>`;
  }
  return h;
}

// ---------------------------------------------------------------- build a chart
export async function builder(main) {
  const o = await options();
  let editing = null; let def = { source: 'logbook', params: {}, rules: ['R1', 'R2', 'R3', 'R4', 'R5', 'LIM'] };
  const cid = state.query.get('chart');
  if (cid) { const c = await api('/trending/charts/' + cid); editing = c.chart; def = { source: editing.source, params: { ...editing.params }, rules: String(editing.rules).replace(/[{}]/g, '').split(',').filter(Boolean) }; }
  else if (state.query.get('d')) { try { def = { ...def, ...JSON.parse(state.query.get('d')) }; } catch (_) { /* a bad link: start empty */ } }
  main.innerHTML = pageHeader(editing ? `Change ${editing.chart_code} ${editing.chart_name}` : 'Build a chart', 'Choose what to chart, draw it, then download it or save it for the lab. Saved charts are watched (Trend watch) and can be frozen to a baseline; QC charts can be shown in QC Review.', '', { kind: 'trending' })
    + tabs('build') + '<div class="trbuild"><div class="trform" id="f"></div><div id="out"><div class="card trempty">Choose what to chart on the left, then Draw.</div></div></div>';
  const f = main.querySelector('#f'); const out = main.querySelector('#out');
  const opt = (v, t, sel) => `<option value="${esc(v)}" ${String(sel ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`;
  const sel = (name, label, items, value, blank = '') => `<div class="field"><label for="p_${name}">${label}</label><select id="p_${name}" data-p="${name}">${blank !== null ? opt('', blank, value) : ''}${items.map(([v, t]) => opt(v, t, value)).join('')}</select></div>`;
  const draw = () => {
    const p = def.params; const s = def.source;
    const testsWith = (ids) => o.tests.filter((t) => ids.has(t.id)).map((t) => [t.id, t.test_name]);
    let fields = '';
    if (s === 'results') {
      fields = sel('test_id', 'Test', testsWith(new Set(o.analytes.map((a) => a.test_id))), p.test_id, 'Choose a test')
        + sel('analyte_id', 'Analyte', [['*', 'Each analyte (one chart each)'], ...o.analytes.filter((a) => a.test_id === p.test_id).map((a) => [a.id, a.analyte_name + (a.unit ? ` (${a.unit})` : '')])], p.analyte_id, 'Choose an analyte')
        + sel('client_id', 'Client', o.clients.map((c) => [c.id, c.name]), p.client_id, 'Every client') + sel('matrix', 'Matrix', o.matrices.map((m) => [m, m]), p.matrix, 'Every matrix')
        + `<div class="field"><label for="p_product">Product contains</label><input type="text" id="p_product" data-p="product" value="${esc(p.product || '')}"></div>`;
    } else if (s === 'qc') {
      const types = o.qcTypes.filter((q) => q.test_id === p.test_id);
      const qv = p.qc_type === '*' ? '*' : p.qc_type ? `${p.qc_type}|${p.limit_type || ''}` : '';
      fields = sel('test_id', 'Test', testsWith(new Set(o.qcTypes.map((q) => q.test_id))), p.test_id, 'Choose a test')
        + `<div class="field"><label for="p_qc">QC check</label><select id="p_qc">${opt('', 'Choose a QC check', qv)}${opt('*', 'Each QC check (one chart each)', qv)}${types.map((q) => opt(`${q.qc_type}|${q.limit_type}`, `${q.qc_type}: ${q.limit_type}`, qv)).join('')}</select></div>`
        + sel('analyte_id', 'Analyte', [['*', 'Each analyte (one chart each)'], ...o.analytes.filter((a) => a.test_id === p.test_id).map((a) => [a.id, a.analyte_name])], p.analyte_id, 'Every analyte together');
    } else if (s === 'logbook') {
      fields = sel('logbook_id', 'Logbook', o.logbooks.map((l) => [l.id, `${l.logbook_code} ${l.logbook_name}`]), p.logbook_id, 'Choose a logbook')
        + sel('field_key', 'Field', o.fields.filter((x) => x.logbook_id === p.logbook_id).map((x) => [x.field_key, x.label + (x.unit ? ` (${x.unit})` : '')]), p.field_key, 'Choose a field');
      const eq = o.equipment.filter((e) => e.logbook_id === p.logbook_id);
      if (eq.length) fields += sel('equipment_id', 'Equipment', [['*', 'Each piece of equipment (one chart each)'], ...eq.map((e) => [e.id, `${e.equipment_code} ${e.equipment_name}`])], p.equipment_id, 'All together');
    } else if (s === 'stability') {
      fields = sel('study_id', 'Study', o.studies.map((x) => [x.id, `${x.study_code} ${x.product || ''}`]), p.study_id, 'Choose a study')
        + sel('analyte_id', 'Analyte', o.studyAnalytes.filter((a) => a.study_id === p.study_id).map((a) => [a.id, a.analyte_name]), p.analyte_id, 'Choose an analyte');
    } else if (s === 'counts') {
      const m = o.metrics.find((x) => x.key === p.metric);
      fields = sel('metric', 'What to count', o.metrics.map((x) => [x.key, x.title]), p.metric, 'Choose')
        + sel('period', 'Per', [['Month', 'Month'], ['Week', 'Week']], p.period || 'Month', null)
        + (m && m.test ? sel('test_id', 'Test', o.tests.map((t) => [t.id, t.test_name]), p.test_id, 'Every test') : '');
    } else {
      fields = sel('metric', 'Break down', o.pareto.map((x) => [x.key, x.title]), p.metric, 'Choose');
    }
    const rules = CONTROL.includes(s) ? `<h3>Signal rules</h3><div class="trrules">${Object.entries(o.rules).filter(([k]) => k !== 'LIM' || !['counts'].includes(s))
      .map(([k, t]) => `<label><input type="checkbox" data-rule="${k}" ${def.rules.includes(k) ? 'checked' : ''}> <span><b>${k}</b> ${esc(t)}</span></label>`).join('')}</div>` : '';
    f.innerHTML = `<h3 style="margin-top:0">What to chart</h3><div class="trsrc">${SOURCES.map(([k, t, h]) => `<button data-src="${k}" class="${s === k ? 'on' : ''}" ${editing && editing.frozen_cl !== null && k !== s ? 'disabled title="Recalculate the frozen limits before charting something else"' : ''}>${t}<small>${h}</small></button>`).join('')}</div>
      ${fields}
      <div class="row2"><div class="field"><label for="p_from">From</label><input type="date" id="p_from" data-p="from" value="${esc(p.from || '')}"></div><div class="field"><label for="p_to">To</label><input type="date" id="p_to" data-p="to" value="${esc(p.to || '')}"></div></div>
      ${rules}
      <div class="acts"><button class="btn primary" id="draw">Draw</button>${can('trending.manage') ? `<button class="btn" id="save">${editing ? 'Save changes' : 'Save chart…'}</button>` : ''}<button class="btn ghost" id="copy">Copy link</button></div>`;
    f.querySelectorAll('[data-src]').forEach((b) => { b.onclick = () => { if (b.dataset.src !== def.source) { def.source = b.dataset.src; def.params = {}; draw(); } }; });
    f.querySelectorAll('[data-p]').forEach((el) => { el.onchange = () => {
      const k = el.dataset.p; def.params[k] = el.value || undefined;
      if (k === 'test_id') { delete def.params.analyte_id; delete def.params.qc_type; delete def.params.limit_type; }
      if (k === 'logbook_id') { delete def.params.field_key; delete def.params.equipment_id; }
      if (k === 'study_id') delete def.params.analyte_id;
      if (['test_id', 'logbook_id', 'study_id', 'metric'].includes(k)) draw();
    }; });
    const qc = f.querySelector('#p_qc');
    if (qc) qc.onchange = () => { if (qc.value === '*') { def.params.qc_type = '*'; delete def.params.limit_type; } else if (qc.value) { const [a, b] = qc.value.split('|'); def.params.qc_type = a; def.params.limit_type = b; } else { delete def.params.qc_type; delete def.params.limit_type; } };
    f.querySelectorAll('[data-rule]').forEach((c) => { c.onchange = () => { def.rules = [...f.querySelectorAll('[data-rule]:checked')].map((x) => x.dataset.rule); }; });
    f.querySelector('#draw').onclick = () => run();
    f.querySelector('#copy').onclick = async () => { const url = `${location.origin}${location.pathname}#/trending/build?d=${encodeURIComponent(JSON.stringify({ source: def.source, params: def.params, rules: def.rules }))}`;
      try { await navigator.clipboard.writeText(url); toast('Link copied: it opens this chart in the builder.'); } catch (_) { toast('The link could not be copied here.', 'err'); } };
    const sv = f.querySelector('#save'); if (sv) sv.onclick = () => saveChart();
  };
  const run = async () => {
    out.innerHTML = '<div class="card trempty">Drawing…</div>';
    try {
      const r = await api('/trending/build', { method: 'POST', body: { source: def.source, title: titleOf(), params: def.params, rules: def.rules } });
      out.innerHTML = '';
      for (const p of r.panels) { const h = document.createElement('h3'); h.style.margin = '2px 0 6px'; h.textContent = p.title; out.appendChild(h); renderPanel(out, p, { rules: def.rules }); }
      if (!r.panels.length) out.innerHTML = '<div class="card trempty">Nothing to chart: no analytes or QC checks for this choice.</div>';
    } catch (e) { out.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  };
  const titleOf = () => {
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
  };
  const saveChart = async () => {
    const isQc = def.source === 'qc';
    const r = await modal({ title: editing ? `Save ${editing.chart_code}` : 'Save the chart', intro: 'Saved charts belong to the lab: anyone with trending.view can open them.', fields: [
      { name: 'chart_name', label: 'Name', required: true, value: editing ? editing.chart_name : titleOf() },
      { name: 'description', label: 'What it is for', type: 'textarea', value: editing ? editing.description || '' : '' },
      { name: 'watch', label: 'Trend watch', type: 'checkbox', cbLabel: 'Watch it (on the Trending page with its signals)', value: editing ? editing.watch : true },
      ...(isQc ? [{ name: 'show_in_review', label: 'QC Review', type: 'checkbox', cbLabel: 'Show it in QC Review of this test\'s batches, with the batch\'s points ringed (once QA has approved it)', value: editing ? editing.show_in_review : true }] : []),
      { name: 'qa_review', label: 'QA review', type: 'checkbox', cbLabel: 'QA reviewable: QA approves the chart and its limits before it counts (always on for a chart in QC Review)', value: editing ? editing.qa_review : isQc },
    ] });
    if (!r) return;
    let reason = null; if (editing) { reason = await askReason(`trend chart ${editing.chart_code}`); if (!reason) return; }
    try {
      const params = { ...def.params }; delete params.from; delete params.to;
      const res = await api('/trending/charts', { method: 'POST', body: { id: editing ? editing.id : undefined, chart_name: r.chart_name, description: r.description, source: def.source, params, rules: def.rules, watch: r.watch, show_in_review: isQc && !!r.show_in_review, qa_review: !!r.qa_review || (isQc && !!r.show_in_review), reason } });
      toast(editing ? `${editing.chart_code} saved.` : `${res.chart_code} saved.`); OPTS = null; location.hash = '#/trending/charts/' + (editing ? editing.id : res.id);
    } catch (e) { toast(e.message, 'err'); }
  };
  draw();
  if (editing || state.query.get('d')) run();
}

// ---------------------------------------------------------------- report packs
const PACKS = [['oos', 'OOS trends', 'Investigations opened, the OOS rate and confirmed OOS per month; by test and by outcome.'],
  ['lab', 'Lab performance', 'Re-preparations and re-analyses per month, on-time reporting, turnaround days; re-preparations by test.'],
  ['equipment', 'Equipment and environment', 'Failed equipment checks and chamber excursions per month, lots rejected by QA testing; failures by equipment and logbook.'],
  ['watched', 'Every watched chart', 'All the charts on Trend watch, with their signals and reviews: a monthly trend review in one PDF.'],
  ['all', 'Every saved chart', 'Every saved chart of the lab with all its panels (each analyte, QC check or instrument), its signals, reviews and QA approval.']];
export async function reports(main) {
  const pk = state.query.get('pack') || 'oos'; const from = state.query.get('from') || ''; const to = state.query.get('to') || ''; const test = state.query.get('test') || '';
  const o = await options();
  main.innerHTML = pageHeader('Report packs', 'Ready-made sets of trend charts for a management review, a QA meeting or an audit. Show one, then download it as a PDF.', '', { kind: 'trending' }) + tabs('reports')
    + `<div class="trpacks">${PACKS.map(([k, t, h]) => `<button data-pk="${k}" class="${k === pk ? 'on' : ''}"><b>${t}</b><span>${h}</span></button>`).join('')}</div>
     <div class="trbar"><label>From <input type="date" id="from" value="${esc(from)}"></label><label>To <input type="date" id="to" value="${esc(to)}"></label>
       ${!['watched', 'all', 'equipment'].includes(pk) ? `<label>Test <select id="test"><option value="">Every test</option>${o.tests.map((t) => `<option value="${t.id}" ${t.id === test ? 'selected' : ''}>${esc(t.test_name)}</option>`).join('')}</select></label>` : ''}
       <button class="btn" id="go">Show</button><span class="sp"></span><button class="btn primary" id="pdf">Download PDF</button></div><div id="ps"><div class="card trempty">Drawing…</div></div>`;
  const q = () => { const f = main.querySelector('#from').value; const t = main.querySelector('#to').value; const ts = main.querySelector('#test'); return { f, t, ts: ts ? ts.value : '' }; };
  const go = (k) => { const x = q(); location.hash = `#/trending/reports?pack=${k}${x.f ? '&from=' + x.f : ''}${x.t ? '&to=' + x.t : ''}${x.ts ? '&test=' + x.ts : ''}`; };
  main.querySelectorAll('[data-pk]').forEach((b) => { b.onclick = () => go(b.dataset.pk); });
  main.querySelector('#go').onclick = () => go(pk);
  main.querySelector('#pdf').onclick = () => { const x = q(); postDownload('/trending/pdf', { pack: pk, from: x.f || null, to: x.t || null, test_id: x.ts || null }, safe((PACKS.find((p) => p[0] === pk) || [])[1]) + '.pdf').then(() => toast('PDF downloaded.')).catch((e) => toast(e.message, 'err')); };
  const d = await api(`/trending/packs/${pk}?from=${from}&to=${to}&test_id=${test}`);
  const ps = main.querySelector('#ps'); ps.innerHTML = d.panels.length ? '' : '<div class="card trempty">Nothing to chart: no charts are watched yet.</div>';
  for (const p of d.panels) { const h = document.createElement('h3'); h.style.margin = '4px 0 6px'; h.textContent = p.title; ps.appendChild(h); renderPanel(ps, p, {}); }
}

// ---------------------------------------------------------------- QC Review: the QC charts applied to this batch's test
export async function reviewTrends(host, batchId) {
  if (!host) return;
  let d; try { d = await api('/trending/review/' + batchId); } catch (_) { return; }
  if (!d.panels || !d.panels.length) { host.innerHTML = ''; return; }
  const flagged = d.panels.reduce((n, p) => n + (p.batch_signals || []).length, 0);
  host.innerHTML = `<div class="rvhead"><h3>Trends <small class="tbmuted">${flagged ? `<span class="trpill bad">${flagged} signal${flagged === 1 ? '' : 's'} at this batch</span>` : 'this batch\'s QC is ringed in blue; no signal at this batch'}</small></h3></div><div class="trrev"></div>`;
  const box = host.querySelector('.trrev');
  for (const p of d.panels) {
    const h = document.createElement('h4'); h.innerHTML = `${link('#/trending/charts/' + p.chart_id, p.chart_code)} ${esc(p.title)}${(p.batch_signals || []).length ? ` · <span class="trpill bad">${p.batch_signals.map((s) => `${s.rule} at ${esc(s.label)}`).join('; ')}</span>` : ''}`;
    box.appendChild(h); renderPanel(box, p, { chartId: p.chart_id, canManage: false });
  }
}
