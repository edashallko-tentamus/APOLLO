// Testing > Stability studies: the studies (one page at a time) and Pulls due.
import { useCallback } from 'react';
import { listStudies, studiesOverview } from '../../api/stability.js';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import { useApi } from '../../hooks/useApi.js';
import PullsGrid from './PullsGrid.jsx';
import { d8, Failed, iso, Loading } from './shared.jsx';

const FILTERS = [['current', 'Current'], ['finished', 'Finished'], ['all', 'All']];
const COLS = [
  { field: 'study_code', title: 'Study', type: 'link', width: 95, href: (r) => '#/stability/studies/' + r.id },
  { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
  { field: 'product', title: 'Product', type: 'readonly', width: 200 },
  { field: 'status', title: 'Status', type: 'readonly', width: 125 },
  { field: 'conditions', title: 'Conditions', type: 'readonly', width: 220 },
  { field: 'placement_date', title: 'Placed', type: 'readonly', width: 100, format: d8 },
  { field: 'pulls', title: 'Pulls done', type: 'readonly', width: 85, compute: (r) => `${r.pulls_done} of ${r.pulls_total}` },
  { field: 'pulls_to_take', title: 'To take now', type: 'readonly', width: 90 },
  { field: 'next_pull', title: 'Next pull', type: 'readonly', width: 100, format: d8 },
  { field: 'shortfall', title: 'Material short', type: 'readonly', width: 100, cellClass: (r) => (Number(r.shortfall) ? 'tbfail' : '') },
  { field: 'excursions_open', title: 'Excursions to assess', type: 'readonly', width: 140, compute: (r) => (Number(r.excursions_open) || ''), cellClass: (r) => (Number(r.excursions_open) ? 'tbfail' : '') },
  { field: 'last_report_code', title: 'Last report', type: 'readonly', width: 130 },
  { field: 'project_code', title: 'Quote', type: 'link', width: 90, href: (r) => '#/stability/quotes/' + r.project_id },
];
const studyRow = (r) => (r.status === 'Awaiting material' ? 'tbwait' : r.status === 'Cancelled' ? 'mutedrow' : '');
const openStudy = (r) => { window.location.hash = '#/stability/studies/' + r.id; };

export default function StudiesPage({ query }) {
  const { data: d, error, reload } = useApi(() => studiesOverview(), []);
  const tab = new URLSearchParams(query).get('tab') === 'pulls' ? 'pulls' : 'studies';
  const load = useCallback((params, opts) => listStudies(params, opts), []);
  const due = d ? d.pulls.filter((p) => iso(p.scheduled_date) <= iso(d.today)).length : '';
  return <>
    <PageHeader title="Stability studies" audit={{ kind: 'stability_studies' }}
      subtitle={'Each accepted stability quote is a study. Place the material in the chambers when it arrives (the T0 sample is logged in then, if intake has not); each pull gets its lab order on its date, then "Record pull" takes the units out of storage and logs the sample.'}
      actions={<a className="btn ghost" href="#/stability/quotes">Stability quotes</a>} />
    <div className="tabs"><a className={`tab${tab === 'studies' ? ' on' : ''}`} href="#/stability/studies">Studies</a><a className={`tab${tab === 'pulls' ? ' on' : ''}`} href="#/stability/studies?tab=pulls" id="tpulls">Pulls due ({due})</a></div>
    <div className="card">
      {tab === 'studies'
        ? <PagedList load={load} query={query} filters={FILTERS} open={openStudy}
          placeholder="Search by study, client, product, quote or condition; type a study code and press Enter to open it">
          {(rows) => <ReadGrid rows={rows} columns={COLS} rowClass={studyRow} onRowOpen={openStudy} emptyText="No studies here: a stability quote becomes a study when the client accepts it." />}
        </PagedList>
        : error && !d ? <Failed error={error} /> : !d ? <Loading /> : <PullsGrid rows={d.pulls} canManage={d.can_manage} reload={reload} withStudy />}
    </div>
  </>;
}
