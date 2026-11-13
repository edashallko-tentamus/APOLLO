// What a dashboard widget shows, from the figures the backend worked out (the current app's body() in dashboard.js):
// segments, figures (kpis), a smaller set of figures, lists, stacked bars, tables, tabbed tables, labs side by side and
// the finance update with its line chart.
import { useEffect, useRef, useState } from 'react';
import { Nav } from 'react-bootstrap';

// blue ramp (sequential, light to dark) for ages; categorical slots 1 to 3 for the segments and the finance series
const SEQ = ['#a9c9f2', '#5b9be6', '#1f5fae'];
const CAT = ['#2a78d6', '#eb6834', '#1baf7a'];
const MARGIN = '#7a4fc4';

export const fmtv = (v, f) => {
  if (v === null || v === undefined) return '–';
  if (f === 'money') return '$' + Math.round(Number(v)).toLocaleString('en-US');
  if (f === 'pct') return Number(v).toFixed(1).replace(/\.0$/, '') + ' %';
  if (f === 'score') return String(Math.round(Number(v)));
  if (f === 'dec') return Number(v).toFixed(1);
  if (f === 'dev') return (Number(v) > 0 ? '+' : '') + Number(v).toFixed(1).replace(/\.0$/, '') + ' %';
  return Number(v).toLocaleString('en-US');
};
const monthLabel = (v) => { const m = String(v).match(/^(\d{4})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, 1).toLocaleDateString([], { month: 'short' }) : v; };
const marginOf = (r) => (r.act_rev && r.act_ebitda !== null && r.act_ebitda !== undefined && Number(r.act_rev) ? (100 * Number(r.act_ebitda)) / Number(r.act_rev) : null);
const pctDev = (a, b) => (a === null || a === undefined || b === null || b === undefined || !Number(b) ? null : (100 * (Number(a) - Number(b))) / Math.abs(Number(b)));

function Kpis({ list, cls = '', onDetail }) {
  return (
    <div className={`dk ${cls}`.trim()}>
      {list.map((k, i) => {
        const inner = <><b>{fmtv(k.value, k.fmt)}</b><span>{k.label}</span>{k.sub && <small>{k.sub}</small>}</>;
        if (k.detail) {
          return <div key={i} className={`k ${k.tone || ''}`} role="button" tabIndex={0} title="Show the list"
            onClick={() => onDetail(k.detail)} onKeyDown={(e) => { if (e.key === 'Enter') onDetail(k.detail); }}>{inner}</div>;
        }
        return <a key={i} className={k.tone || undefined} href={k.href || '#/'}>{inner}</a>;
      })}
    </div>
  );
}

// a widget's tabs, top right
function TabBar({ list, on, onPick }) {
  return (
    <Nav variant="pills" className="dtabs" role="tablist">
      {list.map(([k, l]) => <Nav.Link as="button" active={k === on} key={k} type="button" role="tab" aria-selected={k === on} onClick={() => onPick(k)}>{l}</Nav.Link>)}
    </Nav>
  );
}

function DevCell({ v, invert = false }) {
  if (v === null || v === undefined) return <td className="num">–</td>;
  const s = invert ? -v : v;
  return <td className={`num ${s > 0 ? 'up' : s < 0 ? 'down' : ''}`}>{v > 0 ? '+' : ''}{v.toFixed(1).replace(/\.0$/, '')} %</td>;
}

// K-1: columns {t, num, help}; cells {text, href}, {v, f} or {links}; a cell's tone colours it
function KpiTable({ t }) {
  if (!t || !t.rows.length) return <div className="dempty">{(t && t.empty) || 'Nothing to show.'}</div>;
  const cell = (c, col, i) => {
    const cls = [col && col.num ? 'num' : '', c.tone ? 'k-' + c.tone : '', c.f === 'dev' && c.v !== null && c.v !== undefined ? (c.v > 0 ? 'up' : c.v < 0 ? 'down' : '') : ''].filter(Boolean).join(' ');
    let inner;
    if (c.links) inner = c.links.map((l, j) => <span key={j}>{j > 0 && ', '}<a href={l.href}>{l.text}</a></span>);
    else if (c.f) inner = fmtv(c.v, c.f === 'int' ? undefined : c.f);
    else inner = c.href ? <a href={c.href}>{c.text}</a> : (c.text || '');
    return <td key={i} className={cls || undefined} title={c.title || undefined}>{inner}</td>;
  };
  return (
    <table className="dt kt">
      <thead><tr>{t.columns.map((c, i) => <th key={i} className={c.num ? 'num' : undefined} title={c.help || undefined}>{c.t}</th>)}</tr></thead>
      <tbody>{t.rows.map((r, ri) => <tr key={ri}>{r.map((c, i) => cell(c, t.columns[i], i))}</tr>)}</tbody>
    </table>
  );
}

// Labs side by side (D-1.1): Revenue or EBITDA, with the three comparisons and the potential revenue
const NET_HEAD = [['this month'], ['Last month'], ['% vs last month', 'This month to date against last month to the same day'], ['Quarter'],
  ['Last month vs 3-month avg', 'Last month against the average of the last three full months'], ['% vs last quarter', 'This quarter to date against last quarter to the same point'],
  ['Half year'], ['Year to date'], ['Work in progress'], ['Potential revenue', 'Work in progress + revenue this month'], ['Samples this month'], ['Last month'], ['Year to date'],
  ['Average sample (YTD)'], ['On time this month (samples)']];
function NetworkTable({ rows, tab, onTab }) {
  const m = tab === 'ebitda' ? 'ebitda' : 'rev';
  const sum = (f) => rows.reduce((a, r) => a + Number(f(r) || 0), 0);
  const ot = (v) => (v === null ? '–' : `${v.toFixed(1).replace(/\.0$/, '')} %${v >= 90 ? ' ✓' : v < 80 ? ' !' : ''}`);
  const word = m === 'ebitda' ? 'EBITDA' : 'Revenue';
  const cells = (r) => {
    const v = r[m];
    return [fmtv(v.m, 'money'), fmtv(v.p, 'money'), null, fmtv(v.q, 'money'), null, null, fmtv(v.h, 'money'), fmtv(v.y, 'money'), fmtv(r.wip, 'money'), fmtv(r.potential, 'money'),
      fmtv(r.smp_m), fmtv(r.smp_p), fmtv(r.smp_y), fmtv(r.avg_y, 'money'), ot(r.on_time)]
      .map((t, i) => (i === 2 ? <DevCell key={i} v={v.dev_m} /> : i === 4 ? <DevCell key={i} v={v.dev_p3} /> : i === 5 ? <DevCell key={i} v={v.dev_q} /> : <td key={i} className="num">{t}</td>));
  };
  const tot = () => {
    const s = (k) => fmtv(sum((r) => r[m][k]), 'money');
    const avg = sum((r) => r.smp_y) ? rows.reduce((a, r) => a + r.avg_y * r.smp_y, 0) / sum((r) => r.smp_y) : 0;
    return [s('m'), s('p'), '', s('q'), '', '', s('h'), s('y'), fmtv(sum((r) => r.wip), 'money'), fmtv(sum((r) => r.potential), 'money'),
      fmtv(sum((r) => r.smp_m)), fmtv(sum((r) => r.smp_p)), fmtv(sum((r) => r.smp_y)), fmtv(avg, 'money'), ''].map((t, i) => <td key={i} className="num">{t}</td>);
  };
  return <>
    <TabBar list={[['rev', 'Revenue'], ['ebitda', 'EBITDA']]} on={m} onPick={onTab} />
    <table className="dt">
      <thead><tr><th>Lab</th>{NET_HEAD.map(([t, help], i) => <th key={i} className="num" title={help}>{i === 0 ? `${word} ${t}` : t}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => <tr key={i}><td title={r.name}><b>{r.lab}</b></td>{cells(r)}</tr>)}
        {rows.length > 1 && <tr className="tot"><td>All</td>{tot()}</tr>}
      </tbody>
    </table>
  </>;
}

// The line chart, drawn at the box's real width (never a stretched viewBox) and again when the box is resized
function LineChart({ rows, series, word }) {
  const box = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = box.current; if (!el) return undefined;
    const measure = () => { if (el.clientWidth) setW(Math.max(320, Math.floor(el.clientWidth))); };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div className="dlinebox" ref={box}>{w > 0 && <LineSvg rows={rows} series={series} word={word} W0={w} />}</div>;
}

function LineSvg({ rows, series, word, W0 }) {
  const H0 = 210; const L = 62; const R = 52; const T = 12; const B = 26;
  const vals = rows.flatMap((r) => series.map(([, k]) => r[k])).filter((v) => v !== null && v !== undefined).map(Number);
  let lo = Math.min(0, ...vals); let hi = Math.max(0, ...vals); if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.08; hi += pad; if (lo < 0) lo -= pad;
  const x = (i) => L + (i * (W0 - L - R)) / Math.max(1, rows.length - 1);
  const y = (v) => T + ((hi - v) * (H0 - T - B)) / (hi - lo);
  const ticks = [0, 1, 2, 3, 4].map((i) => lo + ((hi - lo) * i) / 4);
  const short = (v) => (Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e3 ? '$' + Math.round(v / 1e3) + 'k' : '$' + Math.round(v));
  // the margin on its own scale, on the right; it stops at -100 % so one thin month does not flatten the others
  const mv = rows.map(marginOf);
  const mvals = mv.filter((v) => v !== null);
  let mlo = Math.max(-100, Math.min(0, ...mvals)); let mhi = Math.min(100, Math.max(10, ...mvals)); const mpad = (mhi - mlo) * 0.1; mhi += mpad; if (mlo < 0) mlo -= mpad;
  const ym = (v) => T + ((mhi - Math.max(mlo, Math.min(mhi, v))) * (H0 - T - B)) / (mhi - mlo);
  const mticks = [0, 1, 2, 3, 4].map((i) => mlo + ((mhi - mlo) * i) / 4);
  const f1 = (n) => n.toFixed(1);
  const mpts = rows.map((r, i) => (mv[i] === null ? null : [x(i), ym(mv[i]), r, mv[i]])).filter(Boolean);
  return (
    <svg className="dline" width={W0} height={H0} viewBox={`0 0 ${W0} ${H0}`} role="img" aria-label={`${word} by month: actual, budget forecast and monthly forecast, with the EBITDA margin`}>
      {ticks.map((v, i) => <g key={i}><line className="grid" x1={L} x2={W0 - R} y1={f1(y(v))} y2={f1(y(v))} /><text x={L - 8} y={f1(y(v) + 4)} textAnchor="end">{short(v)}</text></g>)}
      {mticks.map((v, i) => <text key={'m' + i} x={W0 - R + 8} y={f1(ym(v) + 4)} textAnchor="start" style={{ fill: MARGIN }}>{Math.round(v)} %</text>)}
      {lo < 0 && <line className="zero" x1={L} x2={W0 - R} y1={f1(y(0))} y2={f1(y(0))} />}
      {rows.map((r, i) => <text key={'x' + i} x={f1(x(i))} y={H0 - 7} textAnchor="middle">{monthLabel(r.month)}</text>)}
      {series.map(([label, k, dash], si) => {
        const pts = rows.map((r, i) => (r[k] === null || r[k] === undefined ? null : [x(i), y(Number(r[k])), r])).filter(Boolean);
        if (!pts.length) return null;
        return <g key={k}>
          <polyline fill="none" stroke={CAT[si]} strokeWidth="2.2" strokeDasharray={dash || undefined} points={pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ')} />
          {pts.map((p, i) => <circle key={i} cx={f1(p[0])} cy={f1(p[1])} r="3.2" fill={CAT[si]}><title>{`${monthLabel(p[2].month)} ${label} ${word}: ${fmtv(p[2][k], 'money')}`}</title></circle>)}
        </g>;
      })}
      {mpts.length > 0 && <g>
        <polyline fill="none" stroke={MARGIN} strokeWidth="2" points={mpts.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ')} />
        {mpts.map((p, i) => <rect key={i} x={f1(p[0] - 3)} y={f1(p[1] - 3)} width="6" height="6" fill={MARGIN}><title>{`${monthLabel(p[2].month)} EBITDA margin: ${fmtv(p[3], 'pct')}`}</title></rect>)}
      </g>}
    </svg>
  );
}

// The finance update by month (D-1.1): the line chart of Revenue, EBITDA or Costs, then the table
const FIN_COLS = [['LIMS invoiced', 'act_rev', 'money'], ['vs budget', 'act_rev', 'dev', 'bud_rev'], ['Costs', 'act_cost', 'money'], ['vs budget', 'act_cost', 'dev', 'bud_cost', true],
  ['EBITDA', 'act_ebitda', 'money'], ['vs budget', 'act_ebitda', 'dev', 'bud_ebitda'], ['Margin', 'margin', 'pct'],
  ['Budget revenue', 'bud_rev', 'money'], ['Budget EBITDA', 'bud_ebitda', 'money'], ['Forecast revenue', 'fc_rev', 'money'], ['Forecast EBITDA', 'fc_ebitda', 'money'], ['Revenue (books)', 'books_rev', 'money']];
function FinanceBody({ rows, tab, onTab }) {
  const t = ['rev', 'ebitda', 'cost'].includes(tab) ? tab : 'rev';
  const series = [['Actual', 'act_' + t, ''], ['Budget forecast', 'bud_' + t, '6 4'], ['Monthly forecast', 'fc_' + t, '2 3']];
  const word = { rev: 'Revenue', ebitda: 'EBITDA', cost: 'Costs' }[t];
  const hasVals = rows.some((r) => series.some(([, k]) => r[k] !== null && r[k] !== undefined));
  const months = rows.filter((r) => r.act_rev !== null || r.act_cost !== null);
  const sumOf = (list, k) => (list.some((r) => r[k] !== null) ? list.reduce((a, r) => a + (r[k] === null ? 0 : Number(r[k])), 0) : null);
  const ytd = {};
  for (const k of ['act_rev', 'act_cost', 'act_ebitda', 'bud_rev', 'bud_cost', 'bud_ebitda']) ytd[k] = sumOf(months, k);
  const cell = (r, [, k, f, b, inv], i) => {
    if (f === 'dev') return <DevCell key={i} v={pctDev(r[k], r[b])} invert={inv} />;
    if (f === 'pct') { const m = marginOf(r); return <td key={i} className="num">{m === null ? '' : fmtv(m, 'pct')}</td>; }
    return <td key={i} className="num">{r[k] === null || r[k] === undefined ? '' : fmtv(r[k], 'money')}</td>;
  };
  const totCell = ([, k, f, b, inv], i) => {
    if (f === 'dev') return <DevCell key={i} v={pctDev(ytd[k], ytd[b])} invert={inv} />;
    if (f === 'pct') { const m = marginOf(ytd); return <td key={i} className="num">{m === null ? '' : fmtv(m, 'pct')}</td>; }
    return <td key={i} className="num">{fmtv(sumOf(rows, k) || 0, 'money')}</td>;
  };
  return <>
    <TabBar list={[['rev', 'Revenue'], ['ebitda', 'EBITDA'], ['cost', 'Costs']]} on={t} onPick={onTab} />
    {!hasVals ? <div className="dempty">No figures for this year yet (Finance figures page).</div> : <>
      <div className="dleg">
        {series.map(([l, , dash], i) => <span key={l}><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke={CAT[i]} strokeWidth="2.2" strokeDasharray={dash || undefined} /></svg> {l}</span>)}
        <span><svg width="22" height="10" aria-hidden="true"><line x1="0" y1="5" x2="22" y2="5" stroke={MARGIN} strokeWidth="2" /></svg> EBITDA margin % (right scale)</span>
      </div>
      <LineChart rows={rows} series={series} word={word} />
    </>}
    <table className="dt">
      <thead><tr><th>Month</th><th className="num" title="Weeks of the month with costs typed">Weeks in</th>
        {FIN_COLS.map(([c, , f], i) => <th key={i} className="num" title={f === 'dev' ? 'Actual against the Budget Forecast of the month' : f === 'pct' ? 'EBITDA as a % of the LIMS revenue' : undefined}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, ri) => <tr key={ri}><td>{monthLabel(r.month)}</td><td className="num">{r.weeks || ''}</td>{FIN_COLS.map((c, i) => cell(r, c, i))}</tr>)}
        <tr className="tot"><td>Year</td><td />{FIN_COLS.map(totCell)}</tr>
      </tbody>
    </table>
    <div className="dnote">The deviations and the margin for the year compare the months with actual figures against the budget of the same months.</div>
  </>;
}

export default function WidgetBody({ w, tab, onTab, onDetail }) {
  if (w.error) return <div className="dempty">Could not be worked out: {w.error}</div>;
  const x = w.data || {};
  const parts = [];
  if (x.segments) {
    const vals = x.segments.map((s) => s.median || 0); const tot = vals.reduce((a, b) => a + b, 0);
    parts.push(tot
      ? <div key="seg" className="dseg" role="img" aria-label="Median days per segment">{x.segments.map((s, i) => <i key={i} style={{ flex: Math.max(vals[i], tot * 0.02), background: CAT[i] }} title={`${s.label}: median ${s.median} days`} />)}</div>
      : <div key="seg" className="dempty">No COA was issued in the last 30 days.</div>);
    parts.push(<div key="segt" className="dsegt">{x.segments.map((s, i) => (
      <div key={i}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: CAT[i], marginRight: 4 }} />{s.label}
        <b>{s.median === null ? '–' : s.median + ' d'}</b>{s.average === null ? '' : 'average ' + s.average + ' d'}<br /><span>{s.help}</span></div>))}</div>);
  }
  if (x.kpis) parts.push(<Kpis key="k" list={x.kpis} onDetail={onDetail} />);
  if (x.minor) parts.push(<div key="mi" className="dminor"><div className="t">{x.minor.title}</div><Kpis list={x.minor.kpis} cls="small" onDetail={onDetail} /></div>);
  if (x.total !== undefined) parts.push(<div key="tot" className="dnote">Total work in progress: <b>{fmtv(x.total, 'money')}</b></div>);
  if (x.list) parts.push(<div key="l" className="dlist">{x.list.map((r, i) => <a key={i} href={r.href} className={r.value ? undefined : 'zero'}><span>{r.label}</span><b>{fmtv(r.value)}</b></a>)}</div>);
  if (x.stacks) {
    const max = Math.max(1, ...x.stacks.rows.map((r) => r.values.reduce((a, b) => a + b, 0)));
    parts.push(x.stacks.rows.length ? <div key="st">
      <div className="dstack">{x.stacks.rows.map((r, ri) => {
        const n = r.values.reduce((a, b) => a + b, 0);
        return <div key={ri} className="r"><a href={r.href} title={r.label}>{r.label}</a>
          <div className="bar" style={{ width: `${(100 * n) / max}%` }}>{r.values.map((v, i) => (v ? <i key={i} style={{ flex: v, background: SEQ[i] }} title={`${x.stacks.legend[i]}: ${v}`} /> : null))}</div>
          <span className="n">{n}</span></div>;
      })}</div>
      <div className="dleg">{x.stacks.legend.map((l, i) => <span key={i}><i style={{ background: SEQ[i] }} />{l}</span>)}</div>
    </div> : <div key="st" className="dempty">Nothing waits to be batched.</div>);
  }
  if (x.table && x.table.columns.length && typeof x.table.columns[0] === 'object') parts.push(<KpiTable key="kt" t={x.table} />);
  else if (x.table) {
    parts.push(x.table.rows.length ? <table key="t" className="dt"><thead><tr>{x.table.columns.map((c, i) => <th key={i} className={i === x.table.columns.length - 1 ? 'num' : undefined}>{c}</th>)}</tr></thead>
      <tbody>{x.table.rows.map((r, ri) => <tr key={ri}>{r.map((c, i) => <td key={i} className={c.num ? 'num' : undefined}>{c.href ? <a href={c.href}>{c.text}</a> : c.text}</td>)}</tr>)}</tbody></table>
      : <div key="t" className="dempty">No lot is low or expiring.</div>);
  }
  if (x.tabbed) {
    const on = tab && x.tabbed.tables[tab] ? tab : x.tabbed.tabs[0][0];
    parts.push(<div key="tb"><TabBar list={x.tabbed.tabs} on={on} onPick={onTab} /><KpiTable t={x.tabbed.tables[on]} /></div>);
  }
  if (x.network) parts.push(<NetworkTable key="net" rows={x.network} tab={tab || 'rev'} onTab={onTab} />);
  if (x.finance) parts.push(<FinanceBody key="fin" rows={x.finance} tab={tab || 'rev'} onTab={onTab} />);
  if (x.note) parts.push(<div key="note" className="dnote">{x.note}</div>);
  return parts.length ? <>{parts}</> : <div className="dempty">Nothing to show.</div>;
}
