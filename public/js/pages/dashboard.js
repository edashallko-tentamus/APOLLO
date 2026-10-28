// Dashboards (D-1, migration 037). Home is the dashboard: the widgets of the person's groups at the lab, arranged
// and resized by the person (drag the title bar to move, drag the corner to resize; put away and bring back). The GM
// dashboard covers the GM's labs; the executive dashboard every lab and the finance update. Every number opens its
// page or the list behind it. Live widgets refresh every 5 minutes while it is open; the others on request (0.35.0). Also: Admin > Dashboard widgets (each group's
// widgets) and the finance figures page.
import { api, esc, pageHeader, toast, state, can, money, link, currentSite, askReason, modal } from '../app.js';
import { Grid } from '../grid.js';
import { section, editableGrid } from './common.js';

const css = document.createElement('style');
css.textContent = `
.rlabs { display: flex; flex-direction: column; gap: 4px; }
.dbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: -4px 0 12px; font-size: 13px; color: var(--muted); }
.dbar .sp { flex: 1; } .dbar select { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; }
.dgrid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: 100px; gap: 12px; grid-auto-flow: row dense; }
.dw { background: var(--card); border: 1px solid var(--line); border-radius: 12px; display: flex; flex-direction: column; min-width: 0; position: relative; overflow: hidden; }
.dw.drag-over { outline: 2px dashed var(--green-700); outline-offset: 2px; } .dw.dragging { opacity: .45; }
.dw header { display: flex; align-items: center; gap: 6px; padding: 9px 12px 4px; cursor: grab; user-select: none; }
.dw header h3 { margin: 0; font-size: 13.5px; font-weight: 650; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dw header .cat { font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 10px; padding: 0 7px; }
.dw header button { border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 15px; line-height: 1; padding: 2px 4px; border-radius: 4px; }
.dw header button:hover { background: #F0F3F5; color: var(--ink); }
.dw .dwfoot { font-size: 10.5px; color: var(--muted); padding: 0 22px 4px 12px; text-align: right; opacity: .75; white-space: nowrap; }
.dw .dwfoot .dwref { border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 12px; padding: 0 2px; }
.dw .dwfoot .dwref:hover { color: var(--ink); }
.dw .body { padding: 4px 12px 6px; overflow: auto; flex: 1; min-height: 0; font-size: 13px; }
.dw .rz { position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px; cursor: nwse-resize; background:
  linear-gradient(135deg, transparent 50%, #b7c0c8 50%, #b7c0c8 58%, transparent 58%, transparent 70%, #b7c0c8 70%, #b7c0c8 78%, transparent 78%); }
.dk { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; }
.dk a, .dk div.k { display: block; text-decoration: none; color: var(--ink); border-radius: 8px; padding: 6px 8px; background: #F7F9FA; border: 1px solid transparent; cursor: pointer; }
.dk a:hover, .dk div.k:hover { border-color: var(--line); background: #fff; }
.dk b { display: block; font-size: 22px; font-weight: 700; letter-spacing: -.3px; font-variant-numeric: tabular-nums; }
.dk span { display: block; color: var(--muted); font-size: 12px; line-height: 1.3; } .dk small { display: block; color: var(--muted); font-size: 11.5px; margin-top: 2px; }
.dk .good b { color: #1d6b3f; } .dk .warn b { color: #8a5a00; } .dk .bad b { color: #b42318; }
.dk .good b::after { content: " ✓"; font-size: 14px; } .dk .bad b::after { content: " !"; font-size: 14px; }
.dnote { color: var(--muted); font-size: 11.5px; margin-top: 8px; }
.dlist a { display: flex; justify-content: space-between; padding: 6px 4px; border-bottom: 1px solid #EEF1F3; text-decoration: none; color: var(--ink); }
.dlist a:hover { background: #F7F9FA; } .dlist a b { font-variant-numeric: tabular-nums; } .dlist a.zero { color: var(--muted); } .dlist a.zero b { font-weight: 400; }
.dstack { margin-top: 8px; } .dstack .r { display: grid; grid-template-columns: 120px 1fr 36px; gap: 8px; align-items: center; margin: 5px 0; }
.dstack .r a { color: var(--ink); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dstack .bar { display: flex; gap: 2px; height: 14px; } .dstack .bar i { display: block; height: 100%; border-radius: 0; }
.dstack .bar i:first-child { border-radius: 4px 0 0 4px; } .dstack .bar i:last-child { border-radius: 0 4px 4px 0; } .dstack .bar i:only-child { border-radius: 4px; }
.dstack .n { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
.dleg { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11.5px; color: var(--muted); margin-top: 4px; } .dleg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
.dseg { display: flex; gap: 2px; height: 22px; margin: 10px 0 6px; } .dseg i { display: block; height: 100%; } .dseg i:first-child { border-radius: 4px 0 0 4px; } .dseg i:last-child { border-radius: 0 4px 4px 0; }
.dsegt { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; } .dsegt div { font-size: 12px; color: var(--muted); } .dsegt b { display: block; color: var(--ink); font-size: 18px; font-variant-numeric: tabular-nums; }
.dt { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; } .dt th { text-align: left; color: var(--muted); font-weight: 600; padding: 4px 6px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.dt td { padding: 4px 6px; border-bottom: 1px solid #EEF1F3; white-space: nowrap; } .dt td.num, .dt th.num { text-align: right; font-variant-numeric: tabular-nums; }
.dt tr.tot td { font-weight: 700; border-top: 1px solid var(--line); }
.dchart { display: flex; align-items: flex-end; gap: 10px; height: 120px; padding: 6px 0 0; border-bottom: 1px solid var(--line); margin-top: 6px; }
.dchart .m { flex: 1; display: flex; align-items: flex-end; gap: 2px; height: 100%; position: relative; } .dchart .m i { flex: 1; border-radius: 4px 4px 0 0; min-height: 0; }
.dchart .m em { position: absolute; bottom: -18px; left: 0; right: 0; text-align: center; font-style: normal; font-size: 11px; color: var(--muted); }
.dempty { color: var(--muted); padding: 12px 0; }
.dhidden { border: 1px dashed var(--line); border-radius: 10px; padding: 8px 12px; color: var(--muted); font-size: 13px; }
.dpop { position: absolute; z-index: 30; background: #fff; border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.12); padding: 6px; min-width: 240px; }
.dpop button { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 6px 8px; border-radius: 6px; cursor: pointer; font: inherit; } .dpop button:hover { background: #F0F3F5; }
.ddet { position: fixed; inset: 0; background: rgba(15,25,35,.35); z-index: 60; display: flex; align-items: flex-start; justify-content: center; padding: 50px 16px; }
.ddet .box { background: #fff; border-radius: 12px; width: min(1180px, 100%); max-height: calc(100vh - 100px); overflow: auto; padding: 16px 18px; }
.ddet .box h3 { margin: 0 0 10px; display: flex; justify-content: space-between; gap: 12px; }
@media (max-width: 900px) { .dgrid { grid-template-columns: 1fr; } .dw { grid-column: 1 / -1 !important; } }
/* D-1.1: tabs inside a widget, the smaller secondary figures, the line chart, the deviation cells, the lab tabs */
.dtabs { display: flex; justify-content: flex-end; gap: 4px; margin: 0 0 4px; }
.dtabs button { border: 1px solid var(--line); background: #fff; color: var(--muted); border-radius: 14px; padding: 2px 10px; font: inherit; font-size: 12px; cursor: pointer; }
.dtabs button.on { background: var(--green-700, #1d6b3f); border-color: transparent; color: #fff; }
.dminor { margin-top: 8px; border-top: 1px solid #EEF1F3; padding-top: 6px; }
.dminor .t { font-size: 11.5px; color: var(--muted); margin-bottom: 2px; }
.dk.small { gap: 6px; } .dk.small a, .dk.small div.k { background: none; padding: 2px 6px; } .dk.small b { font-size: 14px; font-weight: 600; color: var(--muted); } .dk.small span { font-size: 11px; }
.dlinebox { width: 100%; min-height: 210px; margin-top: 4px; overflow: hidden; } .dline { display: block; } .dline text { font-size: 11px; fill: var(--muted); } .dline .grid { stroke: #EEF1F3; } .dline .zero { stroke: #b7c0c8; }
.dt td.up { color: #1d6b3f; } .dt td.down { color: #b42318; }
.ftabs { display: flex; gap: 6px; margin: 0 0 10px; } .ftabs button { border: 1px solid var(--line); background: #fff; border-radius: 16px; padding: 4px 14px; font: inherit; cursor: pointer; }
.dt.kt td.k-good { color: #1d6b3f; font-weight: 700; } .dt.kt td.k-warn { color: #8a5a00; font-weight: 700; } .dt.kt td.k-bad { color: #b42318; font-weight: 700; }
.dt.kt td.k-flag { color: #b42318; font-weight: 600; } .dt.kt td { white-space: nowrap; }
.ftabs button.on { background: var(--green-700, #1d6b3f); color: #fff; border-color: transparent; }
`;
document.head.appendChild(css);

// blue ramp (sequential, light to dark) for ages; categorical slots 1 to 3 for the segments and the finance series
const SEQ = ['#a9c9f2', '#5b9be6', '#1f5fae'];
const CAT = ['#2a78d6', '#eb6834', '#1baf7a'];
const fmtv = (v, f) => {
  if (v === null || v === undefined) return '–';
  if (f === 'money') return '$' + Math.round(Number(v)).toLocaleString('en-US');
  if (f === 'pct') return Number(v).toFixed(1).replace(/\.0$/, '') + ' %';
  if (f === 'score') return String(Math.round(Number(v)));
  if (f === 'dec') return Number(v).toFixed(1);
  if (f === 'dev') return (Number(v) > 0 ? '+' : '') + Number(v).toFixed(1).replace(/\.0$/, '') + ' %';
  return Number(v).toLocaleString('en-US');
};
const d8 = (v) => { if (!v) return ''; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { dateStyle: 'medium' }) : String(v); };
const monthLabel = (v) => { const m = String(v).match(/^(\d{4})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, 1).toLocaleDateString([], { month: 'short' }) : v; };

const BOARDS = {
  home: { title: 'Home', sub: (lab) => `Your dashboard at ${esc(lab)}: the widgets your groups use. Drag a title bar to move a widget, drag its corner to resize it; × puts it away. Numbers open the list behind them.` },
  gm: { title: 'GM dashboard', sub: () => 'Your labs: revenue, work in progress, the month\'s projection, samples and turnaround. Pick one lab or see them together.' },
  executive: { title: 'Executive dashboard', sub: () => 'Every lab side by side, and the weekly finance update against the Budget Forecast and the Monthly Forecast. Not shown to General Managers.' },
};
let timer = null;
// when a widget's figures were worked out: the time today, else the date and time
const fmtAt = (iso) => { const t = new Date(iso); return t.toDateString() === new Date().toDateString() ? t.toLocaleTimeString([], { timeStyle: 'short' }) : t.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
const boardLab = {};
const tabs = {};   // the tab picked in a widget (by widget code), kept while the page refreshes

export const home = (main) => board(main, 'home');
export const gm = (main) => board(main, 'gm');
export const executive = (main) => board(main, 'executive');

async function board(main, key) {
  if (timer) { clearInterval(timer); timer = null; }
  const lab = currentSite();
  const d = await api(`/dashboard/${key}${boardLab[key] ? '?lab=' + boardLab[key] : ''}`);
  main.innerHTML = pageHeader(BOARDS[key].title, BOARDS[key].sub(lab ? `${lab.site_code} (${lab.site_name})` : 'your lab'), '', key === 'home' ? null : { kind: 'dashboard_widgets' })
    + `<div class="dbar">${d.labs.length > 1 ? `<label>Lab <select id="dlab"><option value="">All my labs together</option>${d.labs.map((l) => `<option value="${l.id}" ${boardLab[key] === l.id ? 'selected' : ''}>${esc(l.site_code)}: ${esc(l.site_name)}</option>`).join('')}</select></label>` : ''}
      <span class="sp"></span><span id="dupd"></span>${key === 'home' ? '' : '<button class="btn" id="dreport" title="Download the performance report for a period to Excel">Performance report (Excel)</button>'}<button class="btn" id="drefresh" title="Work out again every widget that is not live">Refresh all</button><button class="btn" id="dadd">Bring back a widget</button><button class="btn ghost" id="dreset">Reset layout</button></div>
      <div class="dgrid" id="dgrid"></div>`;
  const root = main.querySelector('#dgrid');
  let model = arrange(d);
  const save = () => api(`/dashboard/${key}/layout`, { method: 'PUT', body: { layout: model.order.map((w) => ({ code: w.code, w: w.w, h: w.h })), hidden: model.hidden } }).catch((e) => toast(e.message, 'err'));
  const render = () => {
    root.innerHTML = model.order.length ? '' : '<div class="dhidden" style="grid-column: 1 / -1">No widgets here. Your groups have none at this lab, or you put them all away: Bring back a widget, or ask your lab administrator (Admin > Dashboard widgets).</div>';
    for (const w of model.order) root.appendChild(widgetEl(w, key, model, save, render, refreshOne));
    main.querySelector('#dupd').textContent = '';
  };
  // a widget that is not live is worked out again only on request: its own icon, or Refresh all
  const lq = () => (boardLab[key] ? '&lab=' + boardLab[key] : '');
  async function refreshOne(codes, btn) {
    if (btn) btn.disabled = true;
    try {
      const fresh = await api(`/dashboard/${key}?refresh=1&only=${encodeURIComponent(codes.join(','))}${lq()}`);
      for (const w of fresh.widgets) { const m = model.order.find((x) => x.code === w.code); if (m) Object.assign(m, { data: w.data, error: w.error, at: w.at }); }
      render();
    } catch (e) { toast(e.message, 'err'); if (btn) btn.disabled = false; }
  }
  if (main.querySelector('#dreport')) main.querySelector('#dreport').onclick = () => performanceReport(d.labs);
  main.querySelector('#drefresh').onclick = (e) => {
    const codes = model.order.filter((w) => !w.live).map((w) => w.code);
    if (!codes.length) { toast('Every widget here is live: it refreshes every 5 minutes.'); return; }
    refreshOne(codes, e.target).then(() => { const b = main.querySelector('#drefresh'); if (b) b.disabled = false; toast('Refreshed.'); });
  };
  render();
  const sel = main.querySelector('#dlab');
  if (sel) sel.onchange = () => { boardLab[key] = sel.value || ''; board(main, key); };
  main.querySelector('#dreset').onclick = async () => { await api(`/dashboard/${key}/reset`, { method: 'POST', body: {} }); toast('Layout reset to your groups\' defaults.'); board(main, key); };
  main.querySelector('#dadd').onclick = (e) => {
    const hidden = model.all.filter((w) => model.hidden.includes(w.code));
    document.querySelectorAll('.dpop').forEach((p) => p.remove());
    const pop = document.createElement('div'); pop.className = 'dpop';
    pop.innerHTML = hidden.length ? hidden.map((w) => `<button data-c="${esc(w.code)}">${esc(w.title)}</button>`).join('') : '<div class="dempty" style="padding:6px 8px">Every widget is showing.</div>';
    const r = e.target.getBoundingClientRect(); pop.style.top = (window.scrollY + r.bottom + 4) + 'px'; pop.style.left = Math.max(8, window.scrollX + r.right - 260) + 'px';
    document.body.appendChild(pop);
    pop.querySelectorAll('[data-c]').forEach((b) => { b.onclick = async () => { model.hidden = model.hidden.filter((x) => x !== b.dataset.c); pop.remove(); await save(); board(main, key); }; });
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('click', off); } }), 0);
  };
  // live refresh while this page is open and visible
  const hash = location.hash;
  timer = setInterval(async () => {
    if (location.hash !== hash || !document.body.contains(root)) { clearInterval(timer); timer = null; return; }
    if (document.visibilityState !== 'visible' || document.querySelector('.ddet, .modal-bg') || root.querySelector('.dragging')) return;
    try {
      // only the live widgets are asked for again (every 5 minutes, Alex 2026-10-21); the others wait for a refresh
      const codes = model.order.filter((w) => w.live).map((w) => w.code);
      if (!codes.length) return;
      const fresh = await api(`/dashboard/${key}?only=${encodeURIComponent(codes.join(','))}${lq()}`);
      for (const w of fresh.widgets) { const m = model.order.find((x) => x.code === w.code); if (m) Object.assign(m, { data: w.data, error: w.error, at: w.at }); }
      render();
    } catch (_) { /* keep the last numbers */ }
  }, 5 * 60000);
}

// the person's saved order and sizes, then any widget not placed yet
function arrange(d) {
  const all = d.widgets;
  const byCode = Object.fromEntries(all.map((w) => [w.code, w]));
  const hidden = (d.hidden || []).filter((c) => byCode[c]);
  const order = [];
  for (const l of d.layout || []) { const w = byCode[l.code]; if (w && !hidden.includes(w.code) && !w.hidden) order.push({ ...w, w: l.w, h: l.h }); }
  for (const w of all) if (!w.hidden && !hidden.includes(w.code) && !order.some((o) => o.code === w.code)) order.push({ ...w });
  return { all, order, hidden };
}

function widgetEl(w, key, model, save, render, refreshOne) {
  const el = document.createElement('section');
  el.className = 'dw'; el.dataset.code = w.code;
  el.style.gridColumn = `span ${w.w}`; el.style.gridRow = `span ${w.h}`;
  el.innerHTML = `<header draggable="true" title="Drag to move"><h3 title="${esc(w.description || '')}">${esc(w.title)}</h3><span class="cat">${esc(w.category || '')}</span>
      <button data-x title="Put this widget away" aria-label="Put ${esc(w.title)} away">×</button></header>
    <div class="body"></div>
    <footer class="dwfoot">${w.live ? 'Refreshed every 5 minutes' : `Refreshed ${w.at ? fmtAt(w.at) : ''} <button class="dwref" title="Refresh this widget" aria-label="Refresh ${esc(w.title)}">↻</button>`}</footer>
    <div class="rz" title="Drag to resize"></div>`;
  const rb = el.querySelector('.dwref');
  if (rb) rb.onclick = () => refreshOne([w.code], rb);
  el.querySelector('[data-x]').onclick = async () => { model.hidden.push(w.code); model.order = model.order.filter((x) => x.code !== w.code); render(); await save(); toast(`${w.title} put away: Bring back a widget shows it again.`); };
  // the body, redrawn when one of its tabs (Revenue / EBITDA / Costs) is picked
  const fill = () => {
    const b = el.querySelector('.body');
    b.innerHTML = w.error ? `<div class="dempty">Could not be worked out: ${esc(w.error)}</div>` : body(w);
    b.querySelectorAll('[data-detail]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); detail(key, a.dataset.detail); }; });
    b.querySelectorAll('[data-tab]').forEach((t) => { t.onclick = () => { tabs[w.code] = t.dataset.tab; fill(); }; });
    drawCharts(b);
  };
  fill();
  // move: drag the title bar onto another widget
  const hd = el.querySelector('header');
  hd.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', w.code); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
  hd.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault(); el.classList.remove('drag-over');
    const from = e.dataTransfer.getData('text/plain'); if (!from || from === w.code) return;
    const fi = model.order.findIndex((x) => x.code === from); const moving = model.order.splice(fi, 1)[0];
    const ti = model.order.findIndex((x) => x.code === w.code);
    model.order.splice(fi <= ti ? ti + 1 : ti, 0, moving);
    render(); await save();
  });
  // resize: drag the corner (whole columns and rows)
  el.querySelector('.rz').addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const grid = el.parentElement; const colW = (grid.clientWidth - 11 * 12) / 12 + 12; const rowH = 100 + 12;
    const sx = e.clientX; const sy = e.clientY; const w0 = w.w; const h0 = w.h;
    const move = (ev) => {
      w.w = Math.max(2, Math.min(12, Math.round(w0 + (ev.clientX - sx) / colW)));
      w.h = Math.max(1, Math.min(6, Math.round(h0 + (ev.clientY - sy) / rowH)));
      el.style.gridColumn = `span ${w.w}`; el.style.gridRow = `span ${w.h}`;
    };
    const up = async () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (w.w !== w0 || w.h !== h0) await save(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  return el;
}

function kpis(list, cls = '') {
  return `<div class="dk ${cls}">${list.map((k) => {
    const inner = `<b>${fmtv(k.value, k.fmt)}</b><span>${esc(k.label)}</span>${k.sub ? `<small>${esc(k.sub)}</small>` : ''}`;
    if (k.detail) return `<div class="k ${k.tone || ''}" role="button" tabindex="0" data-detail="${esc(k.detail)}" title="Show the list">${inner}</div>`;
    return `<a class="${k.tone || ''}" href="${esc(k.href || '#/')}">${inner}</a>`;
  }).join('')}</div>`;
}

function body(w) {
  const x = w.data || {};
  let h = '';
  if (x.segments) {
    const vals = x.segments.map((s) => s.median || 0); const tot = vals.reduce((a, b) => a + b, 0);
    h += tot ? `<div class="dseg" role="img" aria-label="Median days per segment">${x.segments.map((s, i) => `<i style="flex:${Math.max(vals[i], tot * 0.02)};background:${CAT[i]}" title="${esc(s.label)}: median ${s.median} days"></i>`).join('')}</div>` : '<div class="dempty">No COA was issued in the last 30 days.</div>';
    h += `<div class="dsegt">${x.segments.map((s, i) => `<div><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CAT[i]};margin-right:4px"></i>${esc(s.label)}<b>${s.median === null ? '–' : s.median + ' d'}</b>${s.average === null ? '' : 'average ' + s.average + ' d'}<br><span>${esc(s.help)}</span></div>`).join('')}</div>`;
  }
  if (x.kpis) h += kpis(x.kpis);
  if (x.minor) h += `<div class="dminor"><div class="t">${esc(x.minor.title)}</div>${kpis(x.minor.kpis, 'small')}</div>`;
  if (x.total !== undefined) h += `<div class="dnote">Total work in progress: <b>${fmtv(x.total, 'money')}</b></div>`;
  if (x.list) h += `<div class="dlist">${x.list.map((r) => `<a href="${esc(r.href)}" class="${r.value ? '' : 'zero'}"><span>${esc(r.label)}</span><b>${fmtv(r.value)}</b></a>`).join('')}</div>`;
  if (x.stacks) {
    const max = Math.max(1, ...x.stacks.rows.map((r) => r.values.reduce((a, b) => a + b, 0)));
    h += x.stacks.rows.length ? `<div class="dstack">${x.stacks.rows.map((r) => { const n = r.values.reduce((a, b) => a + b, 0);
      return `<div class="r"><a href="${esc(r.href)}" title="${esc(r.label)}">${esc(r.label)}</a><div class="bar" style="width:${(100 * n) / max}%">${r.values.map((v, i) => (v ? `<i style="flex:${v};background:${SEQ[i]}" title="${esc(x.stacks.legend[i])}: ${v}"></i>` : '')).join('')}</div><span class="n">${n}</span></div>`; }).join('')}</div>
      <div class="dleg">${x.stacks.legend.map((l, i) => `<span><i style="background:${SEQ[i]}"></i>${esc(l)}</span>`).join('')}</div>` : '<div class="dempty">Nothing waits to be batched.</div>';
  }
  if (x.table && x.table.columns.length && typeof x.table.columns[0] === 'object') h += kpiTable(x.table);
  else if (x.table) {
    h += x.table.rows.length ? `<table class="dt"><thead><tr>${x.table.columns.map((c, i) => `<th class="${i === x.table.columns.length - 1 ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${x.table.rows.map((r) => `<tr>${r.map((c) => `<td class="${c.num ? 'num' : ''}">${c.href ? link(c.href, c.text) : esc(c.text)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="dempty">No lot is low or expiring.</div>';
  }
  if (x.tabbed) {
    const on = tabs[w.code] && x.tabbed.tables[tabs[w.code]] ? tabs[w.code] : x.tabbed.tabs[0][0];
    h += tabBar(x.tabbed.tabs, on) + kpiTable(x.tabbed.tables[on]);
  }
  if (x.network) h += networkTable(x.network, tabs[w.code] || 'rev');
  if (x.finance) h += financeBody(x.finance, tabs[w.code] || 'rev');
  if (x.note) h += `<div class="dnote">${esc(x.note)}</div>`;
  return h || '<div class="dempty">Nothing to show.</div>';
}

// K-1 (0.37.0): a table whose columns are {t, num, help} and whose cells are {text, href} (text), {v, f} (a number,
// formatted like the figures), or {links: [{text, href}]}; a cell's tone ('good', 'warn', 'bad', 'flag') colours it
function kpiTable(t) {
  if (!t || !t.rows.length) return `<div class="dempty">${esc((t && t.empty) || 'Nothing to show.')}</div>`;
  const cell = (c, col) => {
    const cls = [col && col.num ? 'num' : '', c.tone ? 'k-' + c.tone : '', c.f === 'dev' && c.v !== null && c.v !== undefined ? (c.v > 0 ? 'up' : c.v < 0 ? 'down' : '') : ''].filter(Boolean).join(' ');
    const title = c.title ? ` title="${esc(c.title)}"` : '';
    let inner;
    if (c.links) inner = c.links.map((l) => link(l.href, l.text)).join(', ');
    else if (c.f) inner = esc(fmtv(c.v, c.f === 'int' ? undefined : c.f));
    else inner = c.href ? link(c.href, c.text) : esc(c.text || '');
    return `<td class="${cls}"${title}>${inner}</td>`;
  };
  return `<table class="dt kt"><thead><tr>${t.columns.map((c) => `<th class="${c.num ? 'num' : ''}"${c.help ? ` title="${esc(c.help)}"` : ''}>${esc(c.t)}</th>`).join('')}</tr></thead>
    <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => cell(c, t.columns[i])).join('')}</tr>`).join('')}</tbody></table>`;
}

// a widget's tabs, top right (the picked one is kept in tabs[code])
const tabBar = (list, on) => `<div class="dtabs" role="tablist">${list.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" class="${k === on ? 'on' : ''}" aria-selected="${k === on}">${esc(l)}</button>`).join('')}</div>`;
const devCell = (v, invert = false) => (v === null || v === undefined ? '<td class="num">–</td>' : `<td class="num ${(invert ? -v : v) > 0 ? 'up' : (invert ? -v : v) < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${v.toFixed(1).replace(/\.0$/, '')} %</td>`);

// Labs side by side (D-1.1): Revenue or EBITDA, with the three comparisons and the potential revenue
function networkTable(rows, tab) {
  const m = tab === 'ebitda' ? 'ebitda' : 'rev';
  const sum = (f) => rows.reduce((a, r) => a + Number(f(r) || 0), 0);
  const ot = (v) => (v === null ? '–' : `${v.toFixed(1).replace(/\.0$/, '')} %${v >= 90 ? ' ✓' : v < 80 ? ' !' : ''}`);
  const word = m === 'ebitda' ? 'EBITDA' : 'Revenue';
  const head = [[`${word} this month`], ['Last month'], ['% vs last month', 'This month to date against last month to the same day'], ['Quarter'],
    ['Last month vs 3-month avg', 'Last month against the average of the last three full months'], ['% vs last quarter', 'This quarter to date against last quarter to the same point'],
    ['Half year'], ['Year to date'], ['Work in progress'], ['Potential revenue', 'Work in progress + revenue this month'], ['Samples this month'], ['Last month'], ['Year to date'],
    ['Average sample (YTD)'], ['On time this month (samples)']];
  const cells = (r) => {
    const v = r[m];
    return [fmtv(v.m, 'money'), fmtv(v.p, 'money'), null, fmtv(v.q, 'money'), null, null, fmtv(v.h, 'money'), fmtv(v.y, 'money'), fmtv(r.wip, 'money'), fmtv(r.potential, 'money'),
      fmtv(r.smp_m), fmtv(r.smp_p), fmtv(r.smp_y), fmtv(r.avg_y, 'money'), ot(r.on_time)]
      .map((t, i) => (i === 2 ? devCell(v.dev_m) : i === 4 ? devCell(v.dev_p3) : i === 5 ? devCell(v.dev_q) : `<td class="num">${t}</td>`)).join('');
  };
  const tot = () => {
    const s = (k) => fmtv(sum((r) => r[m][k]), 'money');
    const avg = sum((r) => r.smp_y) ? rows.reduce((a, r) => a + r.avg_y * r.smp_y, 0) / sum((r) => r.smp_y) : 0;
    return [s('m'), s('p'), '', s('q'), '', '', s('h'), s('y'), fmtv(sum((r) => r.wip), 'money'), fmtv(sum((r) => r.potential), 'money'),
      fmtv(sum((r) => r.smp_m)), fmtv(sum((r) => r.smp_p)), fmtv(sum((r) => r.smp_y)), fmtv(avg, 'money'), ''].map((t) => `<td class="num">${t}</td>`).join('');
  };
  return tabBar([['rev', 'Revenue'], ['ebitda', 'EBITDA']], m) + `<table class="dt"><thead><tr><th>Lab</th>${head.map(([t, help]) => `<th class="num"${help ? ` title="${esc(help)}"` : ''}>${esc(t)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr><td title="${esc(r.name)}"><b>${esc(r.lab)}</b></td>${cells(r)}</tr>`).join('')}
    ${rows.length > 1 ? `<tr class="tot"><td>All</td>${tot()}</tr>` : ''}</tbody></table>`;
}

// The finance update by month (D-1.1): a line chart of Revenue, EBITDA or Costs (actual, budget forecast, monthly
// forecast), then the table: LIMS invoiced first, the books' revenue last
function financeBody(rows, tab) {
  const t = ['rev', 'ebitda', 'cost'].includes(tab) ? tab : 'rev';
  const series = [['Actual', 'act_' + t, ''], ['Budget forecast', 'bud_' + t, '6 4'], ['Monthly forecast', 'fc_' + t, '2 3']];
  const word = { rev: 'Revenue', ebitda: 'EBITDA', cost: 'Costs' }[t];
  const vals = rows.flatMap((r) => series.map(([, k]) => r[k])).filter((v) => v !== null && v !== undefined).map(Number);
  // the chart is drawn once the widget is on the page, at its real width (drawCharts), so text is never stretched
  const id = 'c' + (++chartSeq);
  charts[id] = { rows, series, word };
  const chart = !vals.length ? '<div class="dempty">No figures for this year yet (Finance figures page).</div>'
    : `<div class="dleg">${series.map(([l, , dash], i) => `<span><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="${CAT[i]}" stroke-width="2.2" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg> ${esc(l)}</span>`).join('')}
        <span><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke="${MARGIN}" stroke-width="2"/></svg> EBITDA margin % (right scale)</span></div>
      <div class="dlinebox" data-chart="${id}"></div>`;
  // the deviation from the budget forecast (costs: above budget is shown as bad)
  const months = rows.filter((r) => r.act_rev !== null || r.act_cost !== null);
  const sumOf = (list, k) => (list.some((r) => r[k] !== null) ? list.reduce((a, r) => a + (r[k] === null ? 0 : Number(r[k])), 0) : null);
  const cols = [['LIMS invoiced', 'act_rev', 'money'], ['vs budget', 'act_rev', 'dev', 'bud_rev'], ['Costs', 'act_cost', 'money'], ['vs budget', 'act_cost', 'dev', 'bud_cost', true],
    ['EBITDA', 'act_ebitda', 'money'], ['vs budget', 'act_ebitda', 'dev', 'bud_ebitda'], ['Margin', 'margin', 'pct'],
    ['Budget revenue', 'bud_rev', 'money'], ['Budget EBITDA', 'bud_ebitda', 'money'], ['Forecast revenue', 'fc_rev', 'money'], ['Forecast EBITDA', 'fc_ebitda', 'money'], ['Revenue (books)', 'books_rev', 'money']];
  const cell = (r, [, k, f, b, inv]) => {
    if (f === 'dev') return devCell(pctDev(r[k], r[b]), inv);
    if (f === 'pct') { const m = marginOf(r); return `<td class="num">${m === null ? '' : fmtv(m, 'pct')}</td>`; }
    return `<td class="num">${r[k] === null || r[k] === undefined ? '' : fmtv(r[k], 'money')}</td>`;
  };
  // the year: actuals to date against the budget of the same months
  const ytd = {};
  for (const k of ['act_rev', 'act_cost', 'act_ebitda']) ytd[k] = sumOf(months, k);
  for (const k of ['bud_rev', 'bud_cost', 'bud_ebitda']) ytd[k] = sumOf(months, k);
  const totCell = ([, k, f, b, inv]) => {
    if (f === 'dev') return devCell(pctDev(ytd[k], ytd[b]), inv);
    if (f === 'pct') { const m = marginOf(ytd); return `<td class="num">${m === null ? '' : fmtv(m, 'pct')}</td>`; }
    return `<td class="num">${fmtv(sumOf(rows, k) || 0, 'money')}</td>`;
  };
  return tabBar([['rev', 'Revenue'], ['ebitda', 'EBITDA'], ['cost', 'Costs']], t) + chart
    + `<table class="dt"><thead><tr><th>Month</th><th class="num" title="Weeks of the month with costs typed">Weeks in</th>${cols.map(([c, , f]) => `<th class="num"${f === 'dev' ? ' title="Actual against the Budget Forecast of the month"' : f === 'pct' ? ' title="EBITDA as a % of the LIMS revenue"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(monthLabel(r.month))}</td><td class="num">${r.weeks || ''}</td>${cols.map((c) => cell(r, c)).join('')}</tr>`).join('')}
    <tr class="tot"><td>Year</td><td></td>${cols.map(totCell).join('')}</tr></tbody></table>
    <div class="dnote">The deviations and the margin for the year compare the months with actual figures against the budget of the same months.</div>`;
}
const MARGIN = '#7a4fc4';
const marginOf = (r) => (r.act_rev && r.act_ebitda !== null && r.act_ebitda !== undefined && Number(r.act_rev) ? (100 * Number(r.act_ebitda)) / Number(r.act_rev) : null);
const pctDev = (a, b) => (a === null || a === undefined || b === null || b === undefined || !Number(b) ? null : (100 * (Number(a) - Number(b))) / Math.abs(Number(b)));
let chartSeq = 0;
const charts = {};
// Draw the line charts inside a widget body at the box's real size (no stretching), and again when it is resized
function drawCharts(root) {
  root.querySelectorAll('.dlinebox').forEach((box) => {
    const m = charts[box.dataset.chart]; if (!m) return;
    // not on the page yet (width 0): the observer draws it as soon as it is laid out
    const draw = () => { if (!box.clientWidth) return; const w = Math.max(320, Math.floor(box.clientWidth)); if (box.dataset.w === String(w)) return; box.dataset.w = String(w); box.innerHTML = lineSvg(m, w); };
    draw();
    if (!window.ResizeObserver) requestAnimationFrame(draw);
    if (window.ResizeObserver && !box._ro) { box._ro = new ResizeObserver(() => draw()); box._ro.observe(box); }
  });
}
function lineSvg({ rows, series, word }, W0) {
  const H0 = 210; const L = 62; const R = 52; const T = 12; const B = 26;
  const vals = rows.flatMap((r) => series.map(([, k]) => r[k])).filter((v) => v !== null && v !== undefined).map(Number);
  let lo = Math.min(0, ...vals); let hi = Math.max(0, ...vals); if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.08; hi += pad; if (lo < 0) lo -= pad;
  const x = (i) => L + (i * (W0 - L - R)) / Math.max(1, rows.length - 1);
  const y = (v) => T + ((hi - v) * (H0 - T - B)) / (hi - lo);
  const ticks = [0, 1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 4);
  const short = (v) => (Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? '$' + Math.round(v / 1e3) + 'k' : '$' + Math.round(v));
  // the margin on its own scale, on the right
  const mv = rows.map(marginOf);
  const mvals = mv.filter((v) => v !== null);
  // the scale stops at -100 %: a month with very little revenue would flatten every other month (its point sits on the
  // bottom edge; hovering shows the real margin)
  let mlo = Math.max(-100, Math.min(0, ...mvals)); let mhi = Math.min(100, Math.max(10, ...mvals)); const mpad = (mhi - mlo) * 0.1; mhi += mpad; if (mlo < 0) mlo -= mpad;
  const ym = (v) => T + ((mhi - Math.max(mlo, Math.min(mhi, v))) * (H0 - T - B)) / (mhi - mlo);
  const mticks = [0, 1, 2, 3, 4].map((i) => mlo + ((mhi - mlo) * i) / 4);
  const lines = series.map(([label, k, dash], si) => {
    const pts = rows.map((r, i) => (r[k] === null || r[k] === undefined ? null : [x(i), y(Number(r[k])), r])).filter(Boolean);
    if (!pts.length) return '';
    return `<polyline fill="none" stroke="${CAT[si]}" stroke-width="2.2" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>`
      + pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="${CAT[si]}"><title>${esc(monthLabel(p[2].month))} ${esc(label)} ${esc(word)}: ${fmtv(p[2][k], 'money')}</title></circle>`).join('');
  }).join('');
  const mpts = rows.map((r, i) => (mv[i] === null ? null : [x(i), ym(mv[i]), r, mv[i]])).filter(Boolean);
  const mline = mpts.length ? `<polyline fill="none" stroke="${MARGIN}" stroke-width="2" points="${mpts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>`
    + mpts.map((p) => `<rect x="${(p[0] - 3).toFixed(1)}" y="${(p[1] - 3).toFixed(1)}" width="6" height="6" fill="${MARGIN}"><title>${esc(monthLabel(p[2].month))} EBITDA margin: ${fmtv(p[3], 'pct')}</title></rect>`).join('') : '';
  return `<svg class="dline" width="${W0}" height="${H0}" viewBox="0 0 ${W0} ${H0}" role="img" aria-label="${esc(word)} by month: actual, budget forecast and monthly forecast, with the EBITDA margin">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W0 - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${short(v)}</text>`).join('')}
    ${mticks.map((v) => `<text x="${W0 - R + 8}" y="${(ym(v) + 4).toFixed(1)}" text-anchor="start" style="fill:${MARGIN}">${Math.round(v)} %</text>`).join('')}
    ${lo < 0 ? `<line class="zero" x1="${L}" x2="${W0 - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>` : ''}
    ${rows.map((r, i) => `<text x="${x(i).toFixed(1)}" y="${H0 - 7}" text-anchor="middle">${esc(monthLabel(r.month))}</text>`).join('')}${lines}${mline}</svg>`;
}

// the list behind a number
async function detail(key, k) {
  let d;
  try { d = await api(`/dashboard/${key}/detail?k=${encodeURIComponent(k)}${boardLab[key] ? '&lab=' + boardLab[key] : ''}`); } catch (e) { toast(e.message, 'err'); return; }
  const ov = document.createElement('div'); ov.className = 'ddet';
  ov.innerHTML = `<div class="box" role="dialog" aria-label="${esc(d.title)}"><h3><span>${esc(d.title)} <small class="help">${d.rows.length} row${d.rows.length === 1 ? '' : 's'}</small></span><button class="btn" data-x>Close</button></h3><div id="ddg"></div></div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('[data-x]').onclick = close; ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  const keys = d.rows.length ? Object.keys(d.rows[0]).filter((c) => !(c === 'id' || c.endsWith('_id'))) : [];
  const titleOf = (c) => ({ sample_code: 'Sample', client_sample_id: 'Client sample ID', order_code: 'Order', client_name: 'Client', test_name: 'Test', due_date: 'Due', reported_on: 'Reported',
    days_late: 'Days late', hold_days: 'Days on hold', login_days: 'Login TAT (d)', lab_days: 'Lab TAT (d)', qa_days: 'QA TAT (d)', on_time: 'On time', invoice_number: 'Number',
    invoice_date: 'Date', kind: 'Kind', total: 'Total', catchup: 'Catch-up', value: 'Value', wip_state: 'Stage', rush: 'Rush', logged_at: 'Logged', submitted_at: 'Submitted',
    lot_code: 'Lot', item_name: 'Item' }[c] || c.replace(/_/g, ' '));
  const href = { sample_code: (r) => r.sample_id && '#/samples/' + r.sample_id, order_code: (r) => r.lab_order_id && '#/orders/' + r.lab_order_id, invoice_number: (r) => '#/billing/invoices/' + r.id };
  const columns = keys.map((c) => ({ field: c, title: titleOf(c), width: c === 'test_name' || c === 'client_name' ? 200 : 120,
    type: href[c] ? 'link' : ['value', 'total'].includes(c) ? 'money' : 'readonly', href: href[c],
    format: href[c] || ['value', 'total'].includes(c) ? undefined : (v) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : /date|_on$/.test(c) ? d8(v) : /_at$/.test(c) && v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : v ?? '') }));
  new Grid(ov.querySelector('#ddg'), { readOnly: true, search: true, rows: d.rows, columns, emptyText: 'Nothing here.' });
  ov.querySelectorAll('a[href^="#/"]').forEach((a) => a.addEventListener('click', close));
  ov.querySelector('#ddg').addEventListener('click', (e) => { if (e.target.closest('a[href^="#/"]')) close(); });
}

// ---------------------------------------------------------------- Admin > Dashboard widgets
export async function widgetsAdmin(main) {
  const d = await api('/admin/dashboard-widgets');
  const on = new Set(d.on.map((x) => `${x.group_id}|${x.widget_code}`));
  const rows = d.widgets.map((w) => { const r = { id: w.code, title: w.title, category: w.category, description: w.description };
    for (const g of d.groups) r['g_' + g.id] = on.has(`${g.id}|${w.code}`); return r; });
  main.innerHTML = pageHeader('Dashboard widgets', 'The widgets each group sees on Home at this lab. A person in several groups gets all of their widgets, then arranges and resizes their own. Widgets that need a permission (revenue, quotes) show only to people who hold it. Tick or untick, fill down with Ctrl+D, then save with a reason.', '', { kind: 'dashboard_widgets' })
    + (d.can_edit ? '' : '<div class="card warn">Changing a group\'s widgets needs admin.groups in this lab.</div>') + '<div class="card"><div id="g"></div></div>';
  editableGrid({ el: main.querySelector('#g'), rows, readOnly: !d.can_edit, what: 'the groups\' dashboard widgets', columns: [
    { field: 'title', title: 'Widget', type: 'readonly', width: 200 }, { field: 'category', title: 'Area', type: 'readonly', width: 100 },
    ...d.groups.map((g) => ({ field: 'g_' + g.id, title: g.site_id ? g.group_name : `${g.group_name} (all labs)`, type: 'bool', width: 105 })),
    { field: 'description', title: 'What it shows', type: 'readonly', width: 420 }],
    save: (changes, reason) => api('/admin/dashboard-widgets', { method: 'POST', body: { reason, rows: changes.flatMap((ch) => Object.keys(ch).filter((k) => k.startsWith('g_'))
      .map((k) => ({ group_id: k.slice(2), widget_code: ch.id, on: !!ch[k] }))) } }),
    afterSave: () => widgetsAdmin(main) });
}

// ---------------------------------------------------------------- the finance figures
let financeYear = new Date().getFullYear();
let financeLab = null;   // the lab tab picked (D-1.1: one lab at a time, for faster entry)
export async function finance(main) {
  const d = await api('/finance?year=' + financeYear);
  const codes = d.labs.map((l) => l.site_code);
  if (!codes.includes(financeLab)) financeLab = codes[0];
  const lab = d.labs.find((l) => l.site_code === financeLab);
  main.innerHTML = pageHeader('Finance figures', 'The weekly finance update for each lab and the Budget Forecast and Monthly Forecast for each month. The week\'s revenue comes from the LIMS (invoices issued that week) and cannot be typed: type the costs, and the revenue from the books if you want to compare. Paste from Excel and fill down with Ctrl+D. The executive dashboard compares them by month, with EBITDA = LIMS revenue less costs.', '', { kind: 'finance' })
    + `<div class="dbar">Year <select id="fy">${[0, 1, 2].map((i) => new Date().getFullYear() - 1 + i).map((y) => `<option ${y === financeYear ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    <div class="ftabs" role="tablist">${d.labs.map((l) => `<button type="button" role="tab" data-lab="${esc(l.site_code)}" class="${l.site_code === financeLab ? 'on' : ''}" aria-selected="${l.site_code === financeLab}" title="${esc(l.site_name)}">${esc(l.site_code)}</button>`).join('')}</div>
    <div class="card">${section(`Weekly update: ${lab ? lab.site_name : ''}`, 'One row per week (the date the week ends). Revenue (LIMS) is worked out from the invoices and locked. Costs should exclude depreciation, amortization, interest and tax, so that revenue less costs is EBITDA: to confirm with finance.')}<div id="wg"></div></div>
    <div class="card">${section(`Forecasts: ${lab ? lab.site_name : ''}`, 'Budget forecast (set for the year) and Monthly forecast (updated as the year goes), per month (YYYY-MM). Download them to Excel for every lab you type for, edit, and upload the file: you see every change before it is saved.',
      '<button class="btn" id="plandl">Download Excel</button> <button class="btn" id="planul">Upload Excel</button>')}<div id="pg"></div></div>
    <div class="card">${section('Performance report', 'Everything for a period in one Excel file: a Summary for the General Manager or executive (headline by lab, by month, top clients, quality and timeliness), then the LIMS data behind it on separate tabs, with the LIMS column names.',
      '<button class="btn primary" id="fdreport">Performance report (Excel)</button>')}</div>`;
  main.querySelector('#fy').onchange = (e) => { financeYear = Number(e.target.value); finance(main); };
  main.querySelectorAll('[data-lab]').forEach((b) => { b.onclick = () => { financeLab = b.dataset.lab; finance(main); }; });
  const full = (grid, changes) => changes.map((ch) => (ch.id ? { ...grid.rows.find((r) => r.id === ch.id), ...ch } : { site_code: financeLab, ...ch }));
  const wg = editableGrid({ el: main.querySelector('#wg'), rows: d.weeks.filter((w) => w.site_code === financeLab), allowAdd: true, what: 'the weekly finance update', needReason: true, newRow: () => ({ site_code: financeLab }), columns: [
    { field: 'week_ending', title: 'Week ending', type: 'date', width: 120, editable: (r, isNew) => isNew },
    { field: 'lims_revenue', title: 'Revenue (LIMS)', type: 'readonly', width: 130, format: (v) => (v === null || v === undefined || v === '' ? 'after saving' : fmtv(v, 'money')) },
    { field: 'costs', title: 'Costs', type: 'money', width: 120 },
    { field: 'ebitda', title: 'EBITDA', type: 'money', width: 120, compute: (r) => (r.lims_revenue === undefined || r.lims_revenue === null || r.lims_revenue === '' ? null : Number(r.lims_revenue) - Number(r.costs || 0)) },
    { field: 'books_revenue', title: 'Revenue (books)', type: 'money', width: 130 },
    { field: 'note', title: 'Note', width: 300 }],
    save: (changes, reason) => api('/finance/weeks', { method: 'POST', body: { reason, rows: full(wg, changes) } }), afterSave: () => finance(main) });
  const pg = editableGrid({ el: main.querySelector('#pg'), rows: d.plans.filter((p) => p.site_code === financeLab), allowAdd: true, what: 'the forecasts', newRow: () => ({ site_code: financeLab, plan: 'Budget forecast' }), columns: [
    { field: 'month', title: 'Month', width: 100, editable: (r, isNew) => isNew },
    { field: 'plan', title: 'Plan', type: 'select', options: ['Budget forecast', 'Monthly forecast'], width: 150, editable: (r, isNew) => isNew },
    { field: 'revenue', title: 'Revenue', type: 'money', width: 120 }, { field: 'costs', title: 'Costs', type: 'money', width: 120 },
    { field: 'ebitda', title: 'EBITDA', type: 'money', width: 120, compute: (r) => (r.revenue === undefined || r.revenue === null || r.revenue === '' ? null : Number(r.revenue || 0) - Number(r.costs || 0)) }],
    save: (changes, reason) => api('/finance/plans', { method: 'POST', body: { reason, rows: full(pg, changes) } }), afterSave: () => finance(main) });
  main.querySelector('#plandl').onclick = () => downloadForecasts();
  main.querySelector('#fdreport').onclick = () => performanceReport(d.labs);
  main.querySelector('#planul').onclick = () => uploadForecasts(() => finance(main));
}

// The performance report (0.35.0): a period, the labs, then the Excel file (Summary plus the raw data tabs)
export async function performanceReport(labs) {
  const t = new Date(); const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const several = labs.length > 1;
  const v = await modal({ title: 'Performance report (Excel)', okText: 'Download',
    intro: 'Choose the period. The file has a Summary (headline by lab, by month, top clients, quality and timeliness) and the data behind it on separate tabs, with the LIMS column names.',
    fields: [{ name: 'from', label: 'From', type: 'date', value: ymd(new Date(t.getFullYear(), 0, 1)), required: true }, { name: 'to', label: 'To', type: 'date', value: ymd(t), required: true }],
    after: several ? `<div class="field"><label>Labs</label><div class="rlabs">${labs.map((l) => `<label class="cb"><input type="checkbox" data-rlab="${esc(l.site_code)}" checked> ${esc(l.site_code)}: ${esc(l.site_name)}</label>`).join('')}</div></div>` : '',
    collect: (m) => (several ? { labs: [...m.querySelectorAll('[data-rlab]:checked')].map((x) => x.dataset.rlab) } : {}) });
  if (!v) return;
  if (v.from > v.to) { toast('From must be on or before To.', 'err'); return; }
  if (several && !(v.labs || []).length) { toast('Tick at least one lab.', 'err'); return; }
  const qs = new URLSearchParams({ from: v.from, to: v.to }); if (several) qs.set('labs', v.labs.join(','));
  toast('Making the report…');
  try {
    const res = await fetch('/api/finance/report.xlsx?' + qs, { headers: { 'x-site-id': state.site || '' } });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'The download failed'); }
    const cd = res.headers.get('Content-Disposition') || ''; const name = (cd.match(/filename="([^"]+)"/) || [])[1] || `Performance ${v.from} to ${v.to}.xlsx`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('Performance report downloaded.');
  } catch (e) { toast(e.message, 'err'); }
}

// The forecasts to and from Excel (D-1.1)
async function downloadForecasts() {
  try {
    const res = await fetch(`/api/finance/plans.xlsx?year=${financeYear}`, { headers: { 'x-site-id': state.site || '' } });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'The download failed'); }
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `Forecasts ${financeYear}.xlsx`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast(`Forecasts ${financeYear} downloaded.`);
  } catch (e) { toast(e.message, 'err'); }
}
function uploadForecasts(done) {
  const m = document.createElement('div'); m.className = 'modal-bg';
  m.innerHTML = `<div class="modal xwide"><h3>Upload forecasts from Excel</h3>
    <p class="intro">Download the forecasts first, change the Revenue and Costs (or add rows: Lab, Month YYYY-MM, Plan), save the file and upload it here. You see every change before anything is saved.</p>
    <div class="field"><input type="file" id="planf" accept=".xlsx,.csv"></div><div id="plansum"></div><div id="plang"></div><div class="merr"></div>
    <div class="mbtns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok disabled>Save changes</button></div></div>`;
  document.body.appendChild(m);
  let grid = null; let rows = [];
  const close = () => { if (grid) grid.destroy(); m.remove(); };
  m.querySelector('[data-x]').onclick = close; m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  const ok = m.querySelector('[data-ok]'); const err = m.querySelector('.merr');
  m.querySelector('#planf').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    err.textContent = ''; ok.disabled = true;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()); let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const p = await api('/finance/plans/preview', { method: 'POST', body: { file_name: file.name, content_base64: btoa(bin) } });
      rows = p.rows;
      const n = (a) => rows.filter((r) => r.action === a).length;
      const errors = n('Error'); const todo = n('Create') + n('Update');
      m.querySelector('#plansum').innerHTML = `<div class="bulksum"><span><b>${rows.length}</b> rows read</span><span class="c-new"><b>${n('Create')}</b> to add</span><span class="c-upd"><b>${n('Update')}</b> to change</span><span><b>${n('No change')}</b> unchanged</span><span class="${errors ? 'c-err' : ''}"><b>${errors}</b> with errors</span></div>
        ${errors ? '<p class="bad">Fix the rows with errors in Excel and upload the file again. Nothing has been saved.</p>' : ''}`;
      const shown = rows.filter((r) => r.action !== 'No change').map((r) => ({ ...r, id: r.row,
        what: r.errors.length ? r.errors.join(' · ') : r.was ? `Revenue ${fmtv(r.was.revenue, 'money')} → ${fmtv(r.revenue, 'money')} · Costs ${fmtv(r.was.costs, 'money')} → ${fmtv(r.costs, 'money')}` : `Revenue ${fmtv(r.revenue, 'money')} · Costs ${fmtv(r.costs, 'money')}` }));
      if (grid) grid.destroy();
      grid = new Grid(m.querySelector('#plang'), { readOnly: true, rows: shown, emptyText: 'Nothing to change: the file matches what is stored.', rowClass: (r) => (r.action === 'Error' ? 'errrow' : ''),
        columns: [{ field: 'row', title: 'Row', type: 'readonly', width: 55 }, { field: 'site_code', title: 'Lab', type: 'readonly', width: 60 }, { field: 'month', title: 'Month', type: 'readonly', width: 80 },
          { field: 'plan', title: 'Plan', type: 'readonly', width: 140 }, { field: 'action', title: 'Action', type: 'readonly', width: 80 }, { field: 'what', title: 'Changes or errors', type: 'readonly', width: 520 }] });
      ok.disabled = errors > 0 || todo === 0; ok.textContent = ok.disabled ? 'Save changes' : `Save ${todo} row${todo === 1 ? '' : 's'}`;
    } catch (ex) { m.querySelector('#plansum').innerHTML = ''; err.textContent = ex.message; }
  };
  ok.onclick = async () => {
    const reason = await askReason('the forecasts uploaded from Excel'); if (!reason) return;
    try {
      const todo = rows.filter((r) => r.action === 'Create' || r.action === 'Update').map((r) => ({ site_code: r.site_code, month: r.month, plan: r.plan, revenue: r.revenue, costs: r.costs }));
      await api('/finance/plans', { method: 'POST', body: { reason, rows: todo } });
      toast(`${todo.length} forecast row${todo.length === 1 ? '' : 's'} saved.`); close(); if (done) done();
    } catch (ex) { err.textContent = ex.message + ' Nothing was saved.'; }
  };
}

export const canSeeGm = () => can('dashboard.gm');
export { money };
