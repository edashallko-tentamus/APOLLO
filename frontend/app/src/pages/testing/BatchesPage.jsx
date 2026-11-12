// Testing > Batches, My worklist and the QC Review queue (?show=open|mine|review|all). Every batch ever made comes one
// page at a time (0.35.0). A supervisor assigns several batches at once (Ctrl+click to pick several).
import { useEffect, useRef } from 'react';
import * as api from '../../api/testing.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { day, dt, TopTabs, useNeedLab } from './shared.jsx';
import { Button, Card } from 'react-bootstrap';

const SHOW = { open: 'Open', mine: 'My worklist', review: 'Awaiting review', all: 'All' };
const AUDIT = { kind: 'batches' };
const FILTERS = [['all', 'All'], ['approved', 'Approved'], ['cancelled', 'Cancelled']];
const COLUMNS = [
  { field: 'batch_code', title: 'Batch', type: 'link', width: 105, href: (r) => '#/testing/batches/' + r.id },
  { field: 'test_name', title: 'Test', type: 'link', width: 260, compute: (r) => `${r.test_code} ${r.test_name}`, href: (r) => '#/methods/versions/' + r.test_version_id },
  { field: 'version_no', title: 'Ver.', type: 'readonly', width: 45 },
  { field: 'department_code', title: 'Dept.', type: 'readonly', width: 65 },
  { field: 'status', title: 'Status', type: 'readonly', width: 120 },
  { field: 'assigned_name', title: 'Assigned to', type: 'readonly', width: 150 },
  { field: 'sample_count', title: 'Samples', type: 'readonly', width: 70 },
  { field: 'qc_count', title: 'QC', type: 'readonly', width: 50 },
  { field: 'steps', title: 'Steps done', type: 'readonly', width: 85, compute: (r) => `${r.steps_done} of ${r.steps_total}` },
  { field: 'next_step', title: 'Next step', type: 'readonly', width: 170 },
  { field: 'earliest_due', title: 'Earliest due', type: 'readonly', width: 100, format: day },
  { field: 'created_at', title: 'Made', type: 'readonly', width: 140, format: dt },
];
const openRow = (r) => { window.location.hash = '#/testing/batches/' + r.id; };

function BatchGrid({ rows, made, search, emptyText, gridRef }) {
  const grid = useGrid({ rows, columns: COLUMNS, readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  gridRef.current = grid;
  return <DataGrid grid={grid} search={search} emptyText={emptyText} onRowOpen={openRow} rowClass={(r) => (made && r.batch_code === made ? 'tbmade' : '')} />;
}

export default function BatchesPage({ query }) {
  const need = useNeedLab();
  const dialogs = useDialogs();
  const toast = useToast();
  const q = new URLSearchParams(query);
  const show = SHOW[q.get('show')] ? q.get('show') : 'open';
  const made = q.get('made');
  const { data: d, error, reload } = useApi((o) => api.listBatches(show === 'all' ? 'open' : show, o), [show]);
  const gridRef = useRef(null);

  // a supervisor assigns several batches at once (each assignment is recorded on its batch)
  async function assignSelected() {
    const sel = (gridRef.current?.selectedRows() || []).filter((r) => !['Approved', 'Cancelled'].includes(r.status));
    if (!sel.length) { toast('Select the batches to assign first (click a row; Ctrl+click to add more, Shift+click for a block).', 'err'); return; }
    const r = await dialogs.form({ title: `Assign ${sel.length} batch${sel.length === 1 ? '' : 'es'}`, okText: 'Assign', intro: sel.map((x) => x.batch_code).join(', '),
      fields: [{ name: 'user_id', label: 'Who does them', type: 'select', required: true, options: d.people.map((p) => ({ value: p.id, label: p.full_name })) }] });
    if (!r) return;
    let ok = 0; const failed = [];
    for (const x of sel) {
      try { await api.assignBatch(x.id, r.user_id); ok++; } catch (e) { failed.push(`${x.batch_code}: ${e.message}`); }
    }
    if (ok) toast(`${ok} batch${ok === 1 ? '' : 'es'} assigned.`);
    if (failed.length) toast(failed.join(' | '), 'err');
    reload();
  }

  if (need) return need;
  const emptyText = show === 'mine' ? 'No batches assigned to you.' : 'No batches.';
  return <>
    <PageHeader audit={AUDIT} title={show === 'mine' ? 'My worklist' : show === 'review' ? 'QC Review' : 'Batches'}
      subtitle={show === 'mine' ? 'Batches assigned to you that are not finished, earliest due first.' : show === 'review' ? 'Batches whose bench work is done, waiting for a reviewer (someone who did not perform or witness their steps).' : 'Every batch in this lab: its step progress and who it is assigned to.'} />
    <TopTabs cur={show === 'mine' ? '#/testing/batches?show=mine' : show === 'review' ? '#/testing/batches?show=review' : '#/testing/batches'} />
    {error && !d ? <Card body className="err">{error.message}</Card> : !d ? <div className="loading">Loading…</div> : <>
      <div className="wdbar" style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        {Object.entries(SHOW).map(([k, l]) => <Button key={k} variant={k === show ? 'primary' : 'outline-secondary'} href={`#/testing/batches?show=${k}`}>{l} <small>{d.counts[k] ?? ''}</small></Button>)}
        {d.can_assign && <><span style={{ flex: 1 }} /><span className="help">Select batches (Ctrl+click to pick several), then</span> <Button type="button" variant="outline-secondary" id="massassign" onClick={assignSelected}>Assign selected</Button></>}
      </div>
      {made && <div className="tbnote">Batch <b>{made}</b> made and assigned to you. It is highlighted below; open it to start, or assign it with others.</div>}
      {show === 'all'
        ? <PagedList load={api.listAllBatches} query={query} filterParam="f" filters={FILTERS} open={openRow}
            placeholder="Search by batch, test, analyst or department; scan or type a batch ID and press Enter to open it">
            {(rows) => <BatchGrid rows={rows} made={made} emptyText={emptyText} gridRef={gridRef} />}
          </PagedList>
        : <BatchGrid rows={d.rows} made={made} search emptyText={emptyText} gridRef={gridRef} />}
    </>}
  </>;
}
