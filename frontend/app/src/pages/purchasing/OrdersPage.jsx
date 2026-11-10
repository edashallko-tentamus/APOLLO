// Purchasing > Purchase orders: approved requests grouped by supplier, 50 at a time.
import { useCallback } from 'react';
import { listOrders } from '../../api/purchasing.js';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import { useSession } from '../../session/SessionProvider.jsx';
import { dt, money, NeedLab, PuTabs } from './shared.jsx';

const AUDIT = { kind: 'purchasing' };
const FILTERS = [['open', 'Open'], ['received', 'Received'], ['all', 'All']];
const openOrder = (r) => { window.location.hash = '#/purchasing/orders/' + r.id; };
const COLUMNS = [
  { field: 'po_code', title: 'Order', type: 'link', width: 120, href: (r) => '#/purchasing/orders/' + r.id },
  { field: 'external_po_number', title: 'Finance PO', type: 'readonly', width: 120 }, { field: 'supplier_name', title: 'Supplier', type: 'readonly', width: 200 },
  { field: 'line_count', title: 'Lines', type: 'readonly', width: 60 }, { field: 'amount', title: 'Amount', type: 'readonly', width: 100, align: 'right', format: money },
  { field: 'receipt_state', title: 'Received', type: 'readonly', width: 120, cellClass: (r) => (r.receipt_state === 'Received' ? 'cok' : r.receipt_state === 'Partly received' ? 'cwarn' : '') },
  { field: 'ordered_at', title: 'Ordered', type: 'readonly', width: 140, format: dt }, { field: 'ordered_by', title: 'By', type: 'readonly', width: 140 }];

export default function OrdersPage({ query }) {
  const { site } = useSession();
  const load = useCallback((params, opts) => listOrders(params, opts), []);
  if (!site) return <NeedLab />;
  return <>
    <PageHeader title={`Purchase orders: ${site.site_code}`} audit={AUDIT}
      subtitle="Approved requests grouped by supplier, with the finance PO number and the supplier's confirmation. Newest first, 50 at a time." />
    <PuTabs />
    <PagedList load={load} query={query} filters={FILTERS} open={openOrder}
      placeholder="Search by order, finance PO, supplier or confirmation; scan or type an order or PO number and press Enter">
      {(rows) => <ReadGrid rows={rows} columns={COLUMNS} emptyText="No orders here." onRowOpen={openOrder} />}
    </PagedList>
  </>;
}
