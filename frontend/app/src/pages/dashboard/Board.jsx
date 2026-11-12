// Dashboards (D-1, migration 037). Home is the dashboard: the widgets of the person's groups at the lab, arranged
// and resized by the person (drag the title bar to move, drag the corner to resize; put away and bring back). The GM
// dashboard covers the GM's labs; the executive dashboard every lab and the finance update. Every number opens its
// page or the list behind it. Live widgets refresh every 5 minutes while it is open; the others on request (0.35.0).
import { useCallback, useEffect, useRef, useState } from 'react';
import { getBoard, getDetail, resetLayout, saveLayout } from '../../api/dashboard.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import DetailDialog from './DetailDialog.jsx';
import { performanceReport } from './PerformanceReport.jsx';
import WidgetBody from './WidgetBody.jsx';
import './dashboard.css';
import { Button, Card } from 'react-bootstrap';

const LIVE_MS = 5 * 60000;
const BOARDS = {
  home: { title: 'Home', sub: (lab) => `Your dashboard at ${lab}: the widgets your groups use. Drag a title bar to move a widget, drag its corner to resize it; × puts it away. Numbers open the list behind them.` },
  gm: { title: 'GM dashboard', sub: () => 'Your labs: revenue, work in progress, the month\'s projection, samples and turnaround. Pick one lab or see them together.' },
  executive: { title: 'Executive dashboard', sub: () => 'Every lab side by side, and the weekly finance update against the Budget Forecast and the Monthly Forecast. Not shown to General Managers.' },
};
const AUDIT = { kind: 'dashboard_widgets' };
// kept while the app is open, as in the current app: the lab picked per board, the tab picked in each widget
const boardLab = {};
const widgetTabs = {};

// when a widget's figures were worked out: the time today, else the date and time
const fmtAt = (iso) => { const t = new Date(iso); return t.toDateString() === new Date().toDateString() ? t.toLocaleTimeString([], { timeStyle: 'short' }) : t.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };

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
const merge = (m, fresh) => ({ ...m, order: m.order.map((x) => { const w = fresh.widgets.find((f) => f.code === x.code); return w ? { ...x, data: w.data, error: w.error, at: w.at } : x; }) });

function Widget({ w, tab, onTab, onDetail, onHide, onRefresh, refreshing, onMove, onResize, dragging }) {
  const el = useRef(null);
  const [size, setSize] = useState(null); // while resizing: { w, h }
  const [over, setOver] = useState(false);
  const [dragged, setDragged] = useState(false);
  const stopResize = useRef(null);
  useEffect(() => () => stopResize.current?.(), []); // the page closed mid-resize: drop the listeners

  const startResize = (e) => {
    e.preventDefault(); e.stopPropagation();
    const grid = el.current.parentElement; const colW = (grid.clientWidth - 11 * 12) / 12 + 12; const rowH = 100 + 12;
    const sx = e.clientX; const sy = e.clientY; const w0 = w.w; const h0 = w.h;
    let cur = { w: w0, h: h0 };
    const move = (ev) => {
      cur = { w: Math.max(2, Math.min(12, Math.round(w0 + (ev.clientX - sx) / colW))), h: Math.max(1, Math.min(6, Math.round(h0 + (ev.clientY - sy) / rowH))) };
      setSize(cur);
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); stopResize.current = null; };
    const up = () => { stop(); setSize(null); if (cur.w !== w0 || cur.h !== h0) onResize(w.code, cur.w, cur.h); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    stopResize.current = stop;
  };
  const sw = size ? size.w : w.w; const sh = size ? size.h : w.h;
  return (
    <section ref={el} className={`dw${over ? ' drag-over' : ''}${dragged ? ' dragging' : ''}`} data-code={w.code} style={{ gridColumn: `span ${sw}`, gridRow: `span ${sh}` }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const from = e.dataTransfer.getData('text/plain'); if (from && from !== w.code) onMove(from, w.code); }}>
      <header draggable="true" title="Drag to move"
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', w.code); e.dataTransfer.effectAllowed = 'move'; setDragged(true); dragging.current = true; }}
        onDragEnd={() => { setDragged(false); dragging.current = false; }}>
        <h3 title={w.description || ''}>{w.title}</h3><span className="cat">{w.category || ''}</span>
        <button type="button" title="Put this widget away" aria-label={`Put ${w.title} away`} onClick={() => onHide(w)}>×</button>
      </header>
      <div className="body"><WidgetBody w={w} tab={tab} onTab={onTab} onDetail={onDetail} /></div>
      <footer className="dwfoot">{w.live ? 'Refreshed every 5 minutes'
        : <>Refreshed {w.at ? fmtAt(w.at) : ''} <button type="button" className="dwref" title="Refresh this widget" aria-label={`Refresh ${w.title}`} disabled={refreshing} onClick={() => onRefresh([w.code])}>↻</button></>}</footer>
      <div className="rz" title="Drag to resize" onPointerDown={startResize} />
    </section>
  );
}

export default function Board({ boardKey: key }) {
  const { site } = useSession();
  const siteId = site?.id;
  const dialogs = useDialogs();
  const toast = useToast();
  const [lab, setLabState] = useState(boardLab[key] || '');
  const { data, error, reload } = useApi(() => getBoard(key, { lab }), [key, lab]);
  const [model, setModel] = useState(null);
  const [tabs, setTabs] = useState(() => ({ ...widgetTabs }));
  const [busy, setBusy] = useState(null); // codes being refreshed (null: none)
  const dragging = useRef(false);
  const modelRef = useRef(model); modelRef.current = model;

  useEffect(() => { if (data) setModel(arrange(data)); }, [data]);

  const setLab = (v) => { boardLab[key] = v || ''; setLabState(v || ''); };
  const persist = useCallback((m) => saveLayout(key, m.order.map((w) => ({ code: w.code, w: w.w, h: w.h })), m.hidden).catch((e) => toast(e.message, 'err')), [key, toast]);
  const change = (fn) => { const m = fn(modelRef.current); setModel(m); persist(m); };

  // a widget that is not live is worked out again only on request: its own icon, or Refresh all
  const refresh = useCallback(async (codes) => {
    setBusy(codes);
    try {
      const fresh = await getBoard(key, { lab, only: codes, refresh: true });
      setModel((m) => merge(m, fresh));
      return true;
    } catch (e) { toast(e.message, 'err'); return false; } finally { setBusy(null); }
  }, [key, lab, toast]);

  // live widgets are asked for again every 5 minutes while the page is open and visible
  useEffect(() => {
    const t = setInterval(async () => {
      const m = modelRef.current;
      if (!m || document.visibilityState !== 'visible' || document.querySelector('.ddet, .modal') || dragging.current) return;
      const codes = m.order.filter((w) => w.live).map((w) => w.code);
      if (!codes.length) return;
      try { const fresh = await getBoard(key, { lab, only: codes }); setModel((cur) => cur && merge(cur, fresh)); } catch { /* keep the last numbers */ }
    }, LIVE_MS);
    return () => clearInterval(t);
  }, [key, lab]);

  async function detail(k) {
    let d;
    try { d = await getDetail(key, k, lab); } catch (e) { toast(e.message, 'err'); return; }
    dialogs.open((done) => <DetailDialog d={d} onClose={() => done(null)} />);
  }
  async function refreshAll() {
    const codes = model.order.filter((w) => !w.live).map((w) => w.code);
    if (!codes.length) { toast('Every widget here is live: it refreshes every 5 minutes.'); return; }
    if (await refresh(codes)) toast('Refreshed.');
  }
  async function reset() {
    try { await resetLayout(key); toast('Layout reset to your groups\' defaults.'); reload(); } catch (e) { toast(e.message, 'err'); }
  }
  function bringBack(e) {
    const hidden = model.all.filter((w) => model.hidden.includes(w.code));
    dialogs.menu(e, hidden.length
      ? hidden.map((w) => ({ label: w.title, onClick: async () => { const m = modelRef.current; await persist({ ...m, hidden: m.hidden.filter((x) => x !== w.code) }); reload(); } }))
      : [{ label: 'Every widget is showing.', disabled: true, onClick: () => {} }]);
  }
  const hide = (w) => {
    change((m) => ({ ...m, hidden: [...m.hidden, w.code], order: m.order.filter((x) => x.code !== w.code) }));
    toast(`${w.title} put away: Bring back a widget shows it again.`);
  };
  const move = (from, to) => change((m) => {
    const order = [...m.order];
    const fi = order.findIndex((x) => x.code === from); const moving = order.splice(fi, 1)[0];
    const ti = order.findIndex((x) => x.code === to);
    order.splice(fi <= ti ? ti + 1 : ti, 0, moving);
    return { ...m, order };
  });
  const resize = (code, w, h) => change((m) => ({ ...m, order: m.order.map((x) => (x.code === code ? { ...x, w, h } : x)) }));
  const pickTab = (code, t) => { widgetTabs[code] = t; setTabs((s) => ({ ...s, [code]: t })); };

  const b = BOARDS[key];
  const labText = site ? `${site.site_code} (${site.site_name})` : 'your lab';
  const header = <PageHeader title={b.title} subtitle={b.sub(labText)} audit={key === 'home' ? null : AUDIT} />;
  if (error && !data) return <>{header}<Card body className="err">{error.message}</Card></>;
  if (!data || !model) return <>{header}<div className="loading">Loading…</div></>;

  const labOptions = [{ value: '', label: 'All my labs together' }, ...data.labs.map((l) => ({ value: l.id, label: `${l.site_code}: ${l.site_name}` }))];
  return <>
    {header}
    <div className="dbar">
      {data.labs.length > 1 && <label>Lab <SmartSelect id="dlab" value={lab} options={labOptions} onChange={setLab} /></label>}
      <span className="sp" />
      {key !== 'home' && <Button type="button" variant="outline-secondary" id="dreport" title="Download the performance report for a period to Excel"
        onClick={() => performanceReport({ dialogs, toast, labs: data.labs, siteId })}>Performance report (Excel)</Button>}
      <Button type="button" variant="outline-secondary" id="drefresh" title="Work out again every widget that is not live" disabled={!!busy} onClick={refreshAll}>Refresh all</Button>
      <Button type="button" variant="outline-secondary" id="dadd" onClick={bringBack}>Bring back a widget</Button>
      <Button type="button" variant="light" id="dreset" onClick={reset}>Reset layout</Button>
    </div>
    <div className="dgrid" id="dgrid">
      {!model.order.length && <div className="dhidden" style={{ gridColumn: '1 / -1' }}>No widgets here. Your groups have none at this lab, or you put them all away: Bring back a widget, or ask your lab administrator (Admin &gt; Dashboard widgets).</div>}
      {model.order.map((w) => (
        <Widget key={w.code} w={w} tab={tabs[w.code]} onTab={(t) => pickTab(w.code, t)} onDetail={detail} onHide={hide}
          onRefresh={refresh} refreshing={!!busy?.includes(w.code)} onMove={move} onResize={resize} dragging={dragging} />
      ))}
    </div>
  </>;
}

export const HomeBoard = () => <Board boardKey="home" />;
export const GmBoard = () => <Board boardKey="gm" />;
export const ExecutiveBoard = () => <Board boardKey="executive" />;
