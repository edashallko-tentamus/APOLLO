// Trend watch (#/trending): every watched chart, its latest point and the signals nobody has reviewed yet.
import { useState } from 'react';
import { downloadTrend, getWatch } from '../../api/trending.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { TrendTabs, d10, n3 } from './TrendPanel.jsx';

const AUDIT = { kind: 'trending' };
const SUB = 'Every chart on watch, its latest point and the signals nobody has reviewed yet. A signal is a pattern that is unlikely by chance (a point beyond 3 sigma, a run on one side, a steady climb): open the chart to see it and record what was found.';

function Spark({ r }) {
  const v = (r.spark || []).filter((x) => x !== null);
  if (v.length < 2) return <svg viewBox="0 0 280 54" width="100%" height="54" />;
  const all = [...v, r.ucl, r.lcl, r.cl].filter((x) => x !== null && x !== undefined && Number.isFinite(Number(x))).map(Number);
  let lo = Math.min(...all); let hi = Math.max(...all); if (lo === hi) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.08;
  const X = (i) => 4 + (i * 272) / (v.length - 1); const Y = (y) => 50 - ((y - lo + pad) * 46) / (hi - lo + 2 * pad);
  const hl = (y, c, dash) => (y === null || y === undefined ? null : <line x1="4" x2="276" y1={Y(Number(y)).toFixed(1)} y2={Y(Number(y)).toFixed(1)} stroke={c} strokeWidth="1" strokeDasharray={dash ? '3 3' : undefined} />);
  return (
    <svg viewBox="0 0 280 54" width="100%" height="54" aria-hidden="true">{hl(r.ucl, '#b45309', 1)}{hl(r.lcl, '#b45309', 1)}{hl(r.cl, '#1f7a52')}
      <polyline fill="none" stroke="#34495e" strokeWidth="1.5" points={v.map((y, i) => `${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')} />
      <circle cx={X(v.length - 1).toFixed(1)} cy={Y(v[v.length - 1]).toFixed(1)} r="3" fill={r.open ? '#c0392b' : '#34495e'} /></svg>
  );
}

function Tile({ r }) {
  const last = r.last ? (r.chart === 'p' ? n3(r.last.v * 100) + ' %' : n3(r.last.v) + (r.unit && r.unit !== 'count' ? ' ' + r.unit : '')) : '';
  // a chart with a panel each: the panel (the equipment, analyte or QC check) is the heading, the chart under it
  const part = r.title && r.title.startsWith(r.chart_name + ': ') ? r.title.slice(r.chart_name.length + 2) : null;
  return (
    <div className={`trtile ${r.open ? 'open' : ''}`}>
      <h3><a href={`#/trending/charts/${r.chart_id}`}>{part || r.title || r.chart_name}</a>
        <span className="of">{part ? r.chart_name + ' · ' : ''}{r.chart_code}</span></h3>
      {r.error ? <div className="err">{r.error}</div> : <>
        <Spark r={r} />
        <div className="last"><span>{r.last ? `Latest ${r.last.label}${r.last.t ? ', ' + d10(r.last.t) : ''}` : r.n ? `${r.n} bars` : 'No points yet'}</span><b>{last}</b></div>
        <div>{!r.n ? <span className="trpill">No data yet</span> : r.open ? <span className="trpill bad">{r.open} signal{r.open === 1 ? '' : 's'} to review</span>
          : r.signals ? <span className="trpill ok">{r.signals} signal{r.signals === 1 ? '' : 's'}, all reviewed</span> : <span className="trpill ok">In control</span>}
          {r.frozen && <> <span className="trpill info">Limits frozen</span></>}{r.show_in_review && <> <span className="trpill info">In QC Review</span></>}
          {r.qa_status === 'Awaiting QA' ? <> <span className="trpill bad">Awaiting QA</span></> : r.qa_status === 'Approved' ? <> <span className="trpill ok">QA approved</span></> : null}</div>
        {r.recent.length > 0 && <ul>{r.recent.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </>}
    </div>
  );
}

export default function WatchPage({ query }) {
  const { site } = useSession();
  const toast = useToast();
  const { data: d, error } = useApi((o) => getWatch(o), []);
  const [making, setMaking] = useState(false);
  const only = new URLSearchParams(query).get('show') === 'open';
  const header = <><PageHeader title="Trending" subtitle={SUB} audit={AUDIT} /><TrendTabs on="watch" /></>;
  if (error && !d) return <>{header}<div className="card err">{error.message}</div></>;
  if (!d) return <>{header}<div className="loading">Loading…</div></>;
  const rows = d.rows.filter((r) => !only || r.open).sort((a, b) => (b.open > 0) - (a.open > 0) || a.chart_code.localeCompare(b.chart_code));
  const open = d.rows.filter((r) => r.open).length;
  async function all() {
    setMaking(true);
    try { await downloadTrend('/pdf', { pack: 'all' }, 'All saved charts.pdf', site?.id); toast('PDF downloaded: every saved chart.'); } catch (x) { toast(x.message, 'err'); } finally { setMaking(false); }
  }
  return <>
    {header}
    <div className="trbar"><span className={`trpill ${open ? 'bad' : 'ok'}`}>{open ? `${open} chart${open === 1 ? '' : 's'} with signals to review` : 'Nothing to review'}</span><span className="sp" />
      <label><input type="checkbox" id="onlyopen" checked={only} onChange={(e) => { window.location.hash = e.target.checked ? '#/trending?show=open' : '#/trending'; }} /> Only charts with signals to review</label>
      <button type="button" className="btn primary" id="dlall" disabled={making} onClick={all} title="Every saved chart of the lab, each with all its panels (every analyte, QC check or piece of equipment), in one PDF">{making ? 'Making the PDF…' : 'Download all (PDF)'}</button></div>
    {!rows.length ? <div className="card trempty">{d.rows.length ? 'No watched chart has a signal to review.' : 'No charts on watch yet. Build a chart (a fridge temperature, a QC recovery, OOS per month), save it, and it is watched here.'}</div>
      : <div className="trwatch" id="w">{rows.map((r, i) => <Tile key={i} r={r} />)}</div>}
  </>;
}
