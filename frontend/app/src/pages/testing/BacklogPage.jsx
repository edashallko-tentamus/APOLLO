// Testing > Backlog: logged tests waiting for a batch, by department then test version. Autobatch, Batch selected rows,
// right-click "Add … to a batch…"; split-off requests waiting for the customer (WD-4).
import { useCallback, useEffect, useMemo } from 'react';
import * as api from '../../api/testing.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { decideSplit } from './actions.jsx';
import { day, TopTabs, useNeedLab } from './shared.jsx';

const AUDIT = { kind: 'batches' };
const COLUMNS = [
  { field: 'priority', title: 'Priority', type: 'readonly', width: 80, cellClass: (r) => (r.priority !== 'Standard' ? 'flag' : '') },
  { field: 'sample_code', title: 'Sample', type: 'link', width: 125, href: (r) => '#/samples/' + r.sample_id },
  { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 130 },
  { field: 'client_name', title: 'Client', type: 'readonly', width: 170 },
  { field: 'matrix', title: 'Matrix', type: 'readonly', width: 100 },
  { field: 'due_date', title: 'Due', type: 'readonly', width: 95, format: day },
  { field: 'kind', title: 'Kind', type: 'readonly', width: 140, compute: (r) => (r.kind === 'Re-prep' ? `Re-prep ×${r.replicates}` : r.is_media ? 'Lot QA testing' : 'New'),
    help: 'A lot QA testing sample (its ID is the inventory lot\'s: media, reagents and other items tested before use) joins a batch without counting toward its size or QC' },
  { field: 'reason', title: 'Re-prep reason', type: 'readonly', width: 200 },
  { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
];
const itemsOf = (sel) => sel.map((r) => ({ requested_test_id: r.requested_test_id, reprep_request_id: r.reprep_request_id || null }));

function Group({ rows, max, canPerform, onMake, onAddTo, toast, dialogs }) {
  const r0 = rows[0];
  const grid = useGrid({ rows, columns: COLUMNS, keyField: 'key', readOnly: true });
  const { reset } = grid;
  useEffect(() => { reset(rows); }, [rows, reset]);
  const auto = async () => {
    const n = rows.length;
    if (await dialogs.confirm('Autobatch', `Make a batch of ${max && n > max ? `the first ${max}` : `all ${n}`} waiting test${n === 1 ? '' : 's'} (in priority order) with the test's QC? It is assigned to you.`, 'Make the batch')) onMake(r0.test_version_id, null);
  };
  const selected = () => {
    const sel = grid.selectedRows();
    if (!sel.length) { toast('Select the rows to batch first (click and drag, or Shift+click).', 'err'); return; }
    onMake(r0.test_version_id, itemsOf(sel));
  };
  // right-click a selection: add it to an open batch of the same test that has not started (Alex, 2026-10-13)
  const menu = canPerform ? (e, sel) => {
    if (!sel.length) return;
    dialogs.menu(e, [{ label: `Add ${sel.length === 1 ? sel[0].sample_code : sel.length + ' selected samples'} to a batch…`, onClick: () => onAddTo(r0.test_version_id, sel) },
      { label: 'Make a batch of the selected rows', onClick: () => onMake(r0.test_version_id, itemsOf(sel)) }]);
  } : undefined;
  return (
    <Section className="tbgroup" title={`${r0.test_code} ${r0.test_name} (v${r0.version_no})`}
      help={`${rows.length} waiting${max ? ` · up to ${max} per batch` : ''}${rows.some((x) => x.kind === 'Re-prep') ? ' · includes re-preps' : ''}`}
      actions={canPerform && <><button type="button" className="btn" data-sel={r0.test_version_id} onClick={selected}>Batch selected rows</button>{' '}
        <button type="button" className="btn primary" data-auto={r0.test_version_id} onClick={auto}>Autobatch</button></>}>
      <div data-v={r0.test_version_id}><DataGrid grid={grid} emptyText="Nothing waiting." onContextMenu={menu} /></div>
    </Section>
  );
}

export default function BacklogPage() {
  const need = useNeedLab();
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error, reload } = useApi((o) => api.getBacklog(o), []);
  const { data: sp, reload: reloadSp } = useApi((o) => api.getSplitRequests(o).catch(() => null), []); // not shown without access

  // department, then test version
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of d?.rows || []) {
      const dk = r.department_code ? `${r.department_code} ${r.department_name}` : 'No department';
      if (!m.has(dk)) m.set(dk, new Map());
      const g = m.get(dk);
      if (!g.has(r.test_version_id)) g.set(r.test_version_id, []);
      g.get(r.test_version_id).push({ ...r, key: r.requested_test_id + ':' + (r.reprep_request_id || '') });
    }
    return [...m.entries()].map(([dk, g]) => [dk, [...g.values()]]);
  }, [d]);

  const make = useCallback(async (vid, items) => {
    try {
      const b = await api.makeBatch(vid, items);
      // to the Batches list (not into the batch), so a supervisor can see the day's batches and assign them (Alex, 2026-10-13)
      toast(`Batch ${b.batch_code} made.`); window.location.hash = '#/testing/batches?show=open&made=' + encodeURIComponent(b.batch_code);
    } catch (e) { toast(e.message, 'err'); }
  }, [toast]);

  // Add backlog items to an open batch of the same test version that has not started (no signature: Alex)
  const addTo = useCallback(async (vid, sel) => {
    try {
      const open = (await api.openBatches(vid)).rows;
      if (!open.length) { toast('No batch of this test is waiting to start: make a new batch instead.', 'err'); return; }
      const r = await dialogs.form({ title: `Add ${sel.length} sample${sel.length === 1 ? '' : 's'} to a batch`, okText: 'Add',
        intro: `${sel.map((x) => x.sample_code || x.client_sample_id).join(', ')}. Only batches with no bench work recorded yet can take more samples; the QC follows the number of samples, and a completed Batching step is opened again to confirm the batch.`,
        fields: [{ name: 'batch_id', label: 'Batch', type: 'select', required: true, value: open[0].id, blank: false,
          options: open.map((b) => ({ value: b.id, label: `${b.batch_code} · ${b.sample_count} sample${Number(b.sample_count) === 1 ? '' : 's'}, ${b.qc_count} QC · ${b.assigned_name} · ${b.status}` })) }] });
      if (!r) return;
      const res = await api.addToBatch(r.batch_id, itemsOf(sel));
      toast(`Added to ${res.batch_code}.`); reload();
    } catch (e) { toast(e.message, 'err'); }
  }, [dialogs, toast, reload]);

  const splitColumns = useMemo(() => [
    { field: 'sample_code', title: 'Sample', type: 'link', width: 130, href: (r) => '#/samples/' + r.sample_id },
    { field: 'client_name', title: 'Client', type: 'readonly', width: 150 },
    { field: 'origin_test_name', title: 'From', type: 'readonly', width: 200 },
    { field: 'finding', title: 'Finding', type: 'readonly', width: 180 },
    { field: 'test_name', title: 'Test to order', type: 'readonly', width: 200 },
    { field: 'status', title: 'Status', type: 'readonly', width: 130 },
    { field: 'order_code', title: 'Order', type: 'link', width: 95, href: (r) => '#/orders/' + r.lab_order_id },
    { field: 'yes', title: '', type: 'button', width: 120, label: (r) => (sp?.can_decide && r.status === 'Awaiting consent' ? 'Consent given…' : ''), onClick: (r) => sp?.can_decide && r.status === 'Awaiting consent' && decideSplit(dialogs, toast, r, 'Consent given', reloadSp) },
    { field: 'no', title: '', type: 'button', width: 90, label: (r) => (sp?.can_decide && r.status === 'Awaiting consent' ? 'Declined…' : ''), onClick: (r) => sp?.can_decide && r.status === 'Awaiting consent' && decideSplit(dialogs, toast, r, 'Declined', reloadSp) },
  ], [sp, dialogs, toast, reloadSp]);

  if (need) return need;
  return <>
    <PageHeader title="Testing" audit={AUDIT}
      subtitle="The backlog: logged tests waiting for a batch, by department. Re-preps come first, then rush, then by due date. Autobatch fills a batch up to the test's maximum and adds its QC; or select rows and batch only those." />
    <TopTabs cur="#/testing" />
    {error && !d ? <div className="card err">{error.message}</div> : !d ? <div className="loading">Loading…</div> : <>
      {!d.rows.length && <div className="card">Nothing is waiting. Tests appear here once their sample is logged (and the test has an approved workflow).</div>}
      {groups.map(([dk, vs]) => <div key={dk}>
        <h2 style={{ margin: '18px 0 8px' }}>{dk}</h2>
        {vs.map((rows) => <Group key={rows[0].test_version_id} rows={rows} max={d.max_samples[rows[0].test_version_id]} canPerform={d.can_perform}
          onMake={make} onAddTo={addTo} toast={toast} dialogs={dialogs} />)}
      </div>)}
    </>}
    {sp?.rows?.length > 0 && (
      <Section title="Split-off requests" help="A sample had a finding and a test was split off (e.g. identification). Record the customer's decision; then order the test on the sample (order page). Ordering closes the request.">
        <ReadGrid rows={sp.rows} columns={splitColumns} />
      </Section>
    )}
  </>;
}
