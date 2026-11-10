// OOS investigations: the list (#/oos) and QA's checklists and target times (#/oos/config).
import { useCallback } from 'react';
import { listOos, oosConfig, saveOosItems, saveOosSettings } from '../../api/oos.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import { useApi } from '../../hooks/useApi.js';
import { d8, dt, Failed, Loading, PHASE1 } from './shared.jsx';

const FILTERS = [['open', 'Open'], ['overdue', 'Overdue'], ['closed', 'Closed'], ['all', 'All']];
const COLUMNS = [
  { field: 'oos_code', title: 'Investigation', type: 'link', width: 115, href: (r) => '#/oos/' + r.id },
  { field: 'status', title: 'Status', type: 'readonly', width: 125 },
  { field: 'procedure', title: 'Procedure', type: 'readonly', width: 185 },
  { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => '#/samples/' + r.sample_id },
  { field: 'client_name', title: 'Client', type: 'readonly', width: 160 },
  { field: 'test_name', title: 'Test', type: 'readonly', width: 190 },
  { field: 'analyte_name', title: 'Analyte', type: 'readonly', width: 120 },
  { field: 'res', title: 'Result', type: 'readonly', width: 110, compute: (r) => [r.reported, r.unit].filter(Boolean).join(' ') },
  { field: 'spec_text', title: 'Specification', type: 'readonly', width: 120 },
  { field: 'conclusion', title: 'Conclusion', type: 'readonly', width: 170 },
  { field: 'due_date', title: 'Target date', type: 'readonly', width: 105, format: d8, cellClass: (r) => (r.overdue ? 'tbfail' : '') },
  { field: 'responses_waiting', title: 'Client answers', type: 'readonly', width: 105, compute: (r) => (r.responses_waiting ? `${r.responses_waiting} to handle` : ''), cellClass: (r) => (r.responses_waiting ? 'tbwait' : '') },
  { field: 'opened_by_name', title: 'Opened by', type: 'readonly', width: 140 },
  { field: 'opened_at', title: 'Opened', type: 'readonly', width: 145, format: dt },
];
const listRow = (r) => (r.overdue ? 'tbnc' : ['Closed', 'Cancelled'].includes(r.status) ? 'mutedrow' : '');
const openOne = (r) => { window.location.hash = '#/oos/' + r.id; };

export function OosListPage({ query }) {
  const load = useCallback((params, opts) => listOos(params, opts), []);
  return <>
    <PageHeader title="OOS investigations" audit={{ kind: 'oos_list' }} actions={<a className="btn ghost" href="#/oos/config">Checklists and target times</a>}
      subtitle={'Out-of-specification results under investigation in this lab. An investigation is opened from QC Review or the sample page ("Open OOS…"); GMP samples follow Full Phase I, the others Check and Acknowledge. A result under investigation is held from the COA until it is concluded.'} />
    <div className="card">
      <PagedList load={load} query={query} filters={FILTERS} open={openOne}
        placeholder="Search by investigation, sample, client, test, analyte or batch; type an OOS code and press Enter to open it">
        {(rows) => <ReadGrid rows={rows} columns={COLUMNS} rowClass={listRow} emptyText="No OOS investigations here." />}
      </PagedList>
    </div>
  </>;
}

const SETTING_COLS = [{ field: 'procedure', title: 'Procedure', type: 'readonly', width: 240 }, { field: 'close_within_days', title: 'Close within (calendar days)', type: 'int', min: 1, width: 190, required: true }];
const ITEM_COLS = [
  { field: 'procedure', title: 'Procedure', type: 'select', options: [PHASE1, 'Check and Acknowledge'], width: 210, required: true, editable: (r, isNew) => isNew },
  { field: 'section', title: 'Section', type: 'select', options: (r) => (r.procedure === 'Check and Acknowledge' ? ['Reviewer'] : ['Analyst', 'Supervisor']), width: 110, required: true },
  { field: 'item_text', title: 'Item', width: 520, required: true },
  { field: 'sort_order', title: 'Order', type: 'int', width: 70 },
  { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 100 },
];
const newItem = () => ({ status: 'Active', procedure: PHASE1, section: 'Analyst', sort_order: 100 });
const inactiveRow = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');
const H2 = { fontSize: 15, margin: '0 0 6px' };

export function OosConfigPage() {
  const { data: d, error, reload } = useApi(() => oosConfig(), []);
  return <>
    <PageHeader title="OOS checklists and target times" audit={{ kind: 'oos_config' }} actions={<a className="btn ghost" href="#/oos">OOS investigations</a>}
      subtitle={`The questions each investigation answers and how many days it has to close. The wording belongs to QA's OOS SOP. ${d && !d.can_edit ? 'QA keeps them (oos.configure).' : ''}`} />
    {error && !d ? <Failed error={error} /> : !d ? <Loading /> : <>
      <div className="card"><h2 style={H2}>Target times</h2>
        <EditableGrid rows={d.settings} columns={SETTING_COLS} readOnly={!d.can_edit} what="the OOS target times" save={saveOosSettings} afterSave={reload} /></div>
      <div className="card"><h2 style={H2}>Checklist items</h2>
        <div className="help">Full Phase I has an Analyst and a Supervisor section; Check and Acknowledge a Reviewer section. Set an item Inactive to retire it (investigations keep the answers they gave).</div>
        <EditableGrid rows={d.items} columns={ITEM_COLS} allowAdd={d.can_edit} readOnly={!d.can_edit} search what="the OOS checklists"
          newRow={newItem} rowClass={inactiveRow} save={saveOosItems} afterSave={reload} /></div>
    </>}
  </>;
}
