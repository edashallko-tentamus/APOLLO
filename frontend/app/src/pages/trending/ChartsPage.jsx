// Saved charts (#/trending/charts): the lab's charts, watched or shown in QC Review, and their QA state.
import { listCharts } from '../../api/trending.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { SOURCES, TrendTabs } from './TrendPanel.jsx';
import { Button, Card, Form } from 'react-bootstrap';

const AUDIT = { kind: 'trending' };
const SUB = 'Charts saved for the lab. Watched charts are on Trend watch; QC charts can also be shown in QC Review of the test\'s batches. A QA reviewable chart counts once QA has approved it and its limits.';
const SRC_NAME = Object.fromEntries(SOURCES.map(([k, t]) => [k, t]));
const COLUMNS = [
  { field: 'chart_code', title: 'Chart', type: 'link', width: 90, href: (r) => '#/trending/charts/' + r.id },
  { field: 'chart_name', title: 'Name', type: 'readonly', width: 300 },
  { field: 'src', title: 'Charts', type: 'readonly', width: 140, compute: (r) => SRC_NAME[r.source] || r.source },
  { field: 'w', title: 'Watched', type: 'readonly', width: 80, compute: (r) => (r.watch ? 'Yes' : '') },
  { field: 'q', title: 'In QC Review', type: 'readonly', width: 100, compute: (r) => (r.show_in_review ? 'Yes' : '') },
  { field: 'f', title: 'Limits', type: 'readonly', width: 90, compute: (r) => (r.frozen ? 'Frozen' : 'From the data') },
  { field: 'qa', title: 'QA', type: 'readonly', width: 110, compute: (r) => (r.qa_review ? r.qa_status : 'Not required'), cellClass: (r) => (r.qa_status === 'Awaiting QA' && r.status === 'Active' ? 'cwarn' : r.qa_status === 'Approved' ? 'cok' : '') },
  { field: 'description', title: 'Description', type: 'readonly', width: 300 },
  { field: 'created_by_name', title: 'Made by', type: 'readonly', width: 130 },
  { field: 'status', title: 'Status', type: 'readonly', width: 80, compute: (r) => (r.status === 'Inactive' ? 'Retired' : 'Active') },
];
const rowClass = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');
const waits = (r) => r.status === 'Active' && r.qa_status === 'Awaiting QA';

export default function ChartsPage({ query }) {
  const { data: d, error } = useApi((o) => listCharts(o), []);
  const qaOnly = new URLSearchParams(query).get('show') === 'qa';
  const header = <><PageHeader title="Saved charts" subtitle={SUB} audit={AUDIT} actions={d?.can_manage && <Button variant="primary" href="#/trending/build">Build a chart</Button>} /><TrendTabs on="charts" /></>;
  if (error && !d) return <>{header}<Card body className="err">{error.message}</Card></>;
  if (!d) return <>{header}<div className="loading">Loading…</div></>;
  const waiting = d.rows.filter(waits).length;
  const rows = qaOnly ? d.rows.filter(waits) : d.rows;
  return <>
    {header}
    <div className="trbar"><span className={`trpill ${waiting ? 'bad' : 'ok'}`}>{waiting ? `${waiting} chart${waiting === 1 ? '' : 's'} awaiting QA approval` : 'No chart awaiting QA'}</span><span className="sp" />
      <label><Form.Check.Input type="checkbox" id="qaonly" checked={qaOnly} onChange={(e) => { window.location.hash = e.target.checked ? '#/trending/charts?show=qa' : '#/trending/charts'; }} /> Only charts awaiting QA</label></div>
    <Card body><ReadGrid rows={rows} columns={COLUMNS} search rowClass={rowClass} emptyText={qaOnly ? 'No chart is waiting for QA.' : 'No saved charts yet.'} /></Card>
  </>;
}
