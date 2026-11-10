// Inventory: the list (as in Alex's mock-up), one page at a time from the server, with Excel export/upload, print and labels
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { listLots, usableLots } from '../../api/inventory.js';
import BulkButtons from '../../components/bulk/BulkButtons.jsx';
import { printTable } from '../../components/bulk/printTable.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import { usePrintLabels } from '../../components/labels/usePrintLabels.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useSession } from '../../session/SessionProvider.jsx';
import { reorderDialog, usageDialog } from './dialogs.jsx';
import { amtCls, closed, d8, expCls, InvTabs, isMixture, NeedLab, qaCls, qty } from './shared.jsx';

const FILTERS = [['active', 'Active'], ['wasted', 'Show wasted'], ['expired', 'Show expired'], ['negative', 'Show negative'],
  ['order', 'On order'], ['qa', 'QA testing'], ['waste', 'Waste to classify']];
const FILTER_NAME = Object.fromEntries(FILTERS);
const PRINT_COLS = [
  { title: 'ID', get: (r) => r.lot_code }, { title: 'Name', get: (r) => r.material }, { title: 'Lot#', get: (r) => (isMixture(r) ? r.lot_code : r.manufacturer_lot) },
  { title: 'Conc.', get: (r) => r.conc_display }, { title: 'Date made', get: (r) => d8(r.date_made) }, { title: 'CAS', get: (r) => r.cas_display },
  { title: 'Vendor', get: (r) => r.supplier_name }, { title: 'Exp date', get: (r) => d8(r.expiration_date) },
  { title: 'Amount', get: (r) => (r.receipt_status === 'Received' ? qty(r.on_hand, r.unit) : '') }, { title: 'Purchase status', get: (r) => (isMixture(r) ? 'In-house' : r.receipt_status) },
  { title: 'QA testing', get: (r) => r.qa_status || '' },
  { title: 'Waste', get: (r) => r.waste_name || '' },
];
const lotHref = (r) => '#/inventory/lots/' + r.id;
const openLot = (r) => { window.location.hash = lotHref(r); };

function columnsFor(reorder) {
  return [
    { field: '_dup', title: '', type: 'button', width: 82, label: 'Duplicate', onClick: (r) => { window.location.hash = '#/inventory/new?from=' + r.id; } },
    { field: '_reo', title: '', type: 'button', width: 74, label: (r) => (isMixture(r) || r.status === 'Cancelled' ? '' : 'Reorder'), onClick: (r) => { if (!isMixture(r)) reorder(r); } },
    { field: 'lot_code', title: 'ID', type: 'link', width: 100, href: lotHref },
    { field: 'material', title: 'Name', type: 'readonly', width: 230 },
    { field: 'lotno', title: 'Lot#', type: 'readonly', width: 110, compute: (r) => (isMixture(r) ? r.lot_code : r.manufacturer_lot || '–') },
    { field: 'conc_display', title: 'Conc.', type: 'readonly', width: 100, format: (v) => v || '–' },
    { field: 'date_made', title: 'Date made', type: 'readonly', width: 95, format: (v) => d8(v) || '–' },
    { field: 'cas_display', title: 'CAS', type: 'readonly', width: 95, format: (v) => v || '–' },
    { field: 'supplier_name', title: 'Vendor', type: 'readonly', width: 150, format: (v) => v || '–' },
    { field: 'expiration_date', title: 'Exp date', type: 'readonly', width: 95, format: (v) => d8(v) || '–', cellClass: expCls },
    { field: 'amount', title: 'Amount', type: 'readonly', width: 90, align: 'right', compute: (r) => (r.receipt_status === 'Received' ? qty(r.on_hand, r.unit) : '–'), cellClass: amtCls },
    { field: 'receipt_status', title: 'Purchase status', type: 'readonly', width: 120, format: (v, r) => (isMixture(r) ? '–' : v) },
    { field: 'qa_status', title: 'QA testing', type: 'readonly', width: 170, format: (v) => v || '', help: 'QA testing before use: the item types your lab tests (Inventory > QA testing), or items sent for it, are tested on a sample with the lot\'s ID and released for every use or for named tests',
      cellClass: (r) => qaCls(r.qa_status) },
    { field: '_pick', title: '☐', type: 'bool', width: 40, help: 'Tick rows to export, print or label only those' },
    // waste classification (0.30.0): how the item is disposed of; "classify from the SDS" still needs a choice
    { field: 'waste_name', title: 'Waste', type: 'readonly', width: 200, format: (v, r) => (v ? (r.waste_review ? 'To classify (see SDS)' : v) : 'None'),
      cellClass: (r) => (!r.waste_name || r.waste_review ? 'cwarn' : ''), help: 'The item\'s waste classification (Admin > Lab setup > Waste classifications): how it is disposed of' },
  ];
}
const mutedClosed = (r) => (closed(r) ? 'mutedrow' : '');

// the page's grid; the buttons above it read its ticked rows through gridRef
function LotsGrid({ rows, columns, gridRef }) {
  const start = useRef(null);
  if (start.current?.src !== rows) start.current = { src: rows, rows: rows.map((r) => ({ ...r, _pick: false })) };
  const grid = useGrid({ rows: start.current.rows, columns });
  const { reset } = grid;
  useEffect(() => { reset(start.current.rows); }, [rows, reset]); // another page or tab: its rows
  gridRef.current = grid;
  return <DataGrid grid={grid} emptyText="Nothing here." onRowOpen={openLot} rowClass={mutedClosed} />;
}

export default function LotsPage({ query }) {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const printLabels = usePrintLabels();
  const gridRef = useRef(null);
  const filterRef = useRef('active');
  const reloadRef = useRef(() => {});
  const ui = { dialogs, toast };
  const reorder = useCallback((r) => reorderDialog({ dialogs, toast }, r), [dialogs, toast]);
  const columns = useMemo(() => columnsFor(reorder), [reorder]);
  const load = useCallback((params, opts) => listLots(params, opts), []);
  if (!site) return <NeedLab />;

  const g = () => gridRef.current;
  const picked = () => (g() ? g().state.rows.filter((r) => r._pick) : []);
  const shown = () => (g() ? g().view.map((i) => g().state.rows[i]) : []);
  // the menu link always opens on Active
  const q = new URLSearchParams(query);
  const listQuery = FILTER_NAME[q.get('show')] ? query : (q.delete('show'), q.toString());

  return <>
    <PageHeader title={`Inventory: ${site.site_code}`} audit={{ kind: 'inventory' }}
      subtitle={`Every item in ${site.site_name}: chemicals, standards, reagents, media, strains, consumables and in-house mixtures. The newest are shown 50 at a time; search finds any of them, and a scanned or typed ID opens its item.`} />
    <InvTabs />
    <div className="invbar">
      <span className="sp" /><BulkButtons kind="lots" selected={() => picked().map((r) => r.id)} onDone={() => reloadRef.current()} />
      <button type="button" className="btn" onClick={() => { const p = picked(); printTable(`Inventory: ${site.site_code} (${FILTER_NAME[filterRef.current] || 'Active'})`, PRINT_COLS, p.length ? p : shown()); }}>Print</button>
      <a className="btn primary" href="#/inventory/new">+ New Inventory Item</a><a className="btn primary" href="#/inventory/mixture">+ In-house mixture</a>
    </div>
    <div className="invbar"><span className="help">Also:</span>
      {/* usage is recorded against any usable lot, not only those on the page shown */}
      <button type="button" className="btn" onClick={async () => {
        try { if (await usageDialog(ui, (await usableLots()).filter((r) => r.use_eligible))) reloadRef.current(); } catch (e) { toast(e.message, 'err'); }
      }}>Record usage</button>
      <a className="btn" href="#/inventory/receive">Receive many (paste)</a>
      <button type="button" className="btn" title="Barcode labels for the ticked rows (Dymo, 1 x 2 1/8 in.), one per container" onClick={() => {
        const p = picked().length ? picked() : (g() ? g().selectedRows() : []);
        if (!p.length) { toast('Tick the rows (or select them) to print labels for.', 'err'); return; }
        printLabels('lot', p.map((r) => r.id));
      }}>Print labels</button>
    </div>
    <PagedList load={load} query={listQuery} filters={FILTERS} open={openLot}
      placeholder="Search by ID, name, lot#, CAS, vendor or analyte; scan or type an ID and press Enter to open it">
      {(rows, data, reload) => { reloadRef.current = reload; filterRef.current = data.filter; return <LotsGrid rows={rows} columns={columns} gridRef={gridRef} />; }}
    </PagedList>
  </>;
}
