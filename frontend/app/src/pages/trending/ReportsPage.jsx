// Report packs (#/trending/reports): ready-made sets of trend charts, shown here and downloaded as one PDF.
import { useState } from 'react';
import { downloadTrend, getOptions, getPack } from '../../api/trending.js';
import PageHeader from '../../components/PageHeader.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { Panels, TrendTabs, safe } from './TrendPanel.jsx';

const AUDIT = { kind: 'trending' };
const PACKS = [['oos', 'OOS trends', 'Investigations opened, the OOS rate and confirmed OOS per month; by test and by outcome.'],
  ['lab', 'Lab performance', 'Re-preparations and re-analyses per month, on-time reporting, turnaround days; re-preparations by test.'],
  ['equipment', 'Equipment and environment', 'Failed equipment checks and chamber excursions per month, lots rejected by QA testing; failures by equipment and logbook.'],
  ['watched', 'Every watched chart', 'All the charts on Trend watch, with their signals and reviews: a monthly trend review in one PDF.'],
  ['all', 'Every saved chart', 'Every saved chart of the lab with all its panels (each analyte, QC check or instrument), its signals, reviews and QA approval.']];

export default function ReportsPage({ query }) {
  const { site } = useSession();
  const toast = useToast();
  const q = new URLSearchParams(query);
  const pk = q.get('pack') || 'oos'; const from = q.get('from') || ''; const to = q.get('to') || ''; const test = q.get('test') || '';
  const [f, setF] = useState(from); const [t, setT] = useState(to); const [ts, setTs] = useState(test);
  const { data: o } = useApi(() => getOptions(), []);
  const { data: d, error } = useApi(() => getPack(pk, from, to, test), [pk, from, to, test]);
  const withTest = !['watched', 'all', 'equipment'].includes(pk);
  const go = (k) => { window.location.hash = `#/trending/reports?pack=${k}${f ? '&from=' + f : ''}${t ? '&to=' + t : ''}${withTest && ts ? '&test=' + ts : ''}`; };
  const pdf = () => downloadTrend('/pdf', { pack: pk, from: f || null, to: t || null, test_id: (withTest && ts) || null }, safe((PACKS.find((x) => x[0] === pk) || [])[1]) + '.pdf', site?.id)
    .then(() => toast('PDF downloaded.')).catch((e) => toast(e.message, 'err'));
  const testOptions = [{ value: '', label: 'Every test' }, ...(o?.tests || []).map((x) => ({ value: x.id, label: x.test_name }))];

  return <>
    <PageHeader title="Report packs" subtitle="Ready-made sets of trend charts for a management review, a QA meeting or an audit. Show one, then download it as a PDF." audit={AUDIT} />
    <TrendTabs on="reports" />
    <div className="trpacks">{PACKS.map(([k, title, h]) => <button key={k} type="button" className={k === pk ? 'on' : undefined} onClick={() => go(k)}><b>{title}</b><span>{h}</span></button>)}</div>
    <div className="trbar">
      <label>From <input type="date" id="from" value={f} onChange={(e) => setF(e.target.value)} /></label><label>To <input type="date" id="to" value={t} onChange={(e) => setT(e.target.value)} /></label>
      {withTest && <label>Test <SmartSelect id="test" value={ts} options={testOptions} onChange={setTs} /></label>}
      <button type="button" className="btn" id="go" onClick={() => go(pk)}>Show</button><span className="sp" /><button type="button" className="btn primary" id="pdf" onClick={pdf}>Download PDF</button>
    </div>
    <div id="ps">
      {error && !d ? <div className="card err">{error.message}</div>
        : !d ? <div className="card trempty">Drawing…</div>
          : d.panels.length ? <Panels panels={d.panels} ctx={{}} /> : <div className="card trempty">Nothing to chart: no charts are watched yet.</div>}
    </div>
  </>;
}
