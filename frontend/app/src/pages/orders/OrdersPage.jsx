// Intake > Lab orders: one page at a time from the server (0.35.0)
import { listOrders } from '../../api/orders.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useMeta } from '../../hooks/useMeta.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { d8 } from './orderFormat.js';
import { openNewOrder } from './newOrder.jsx';

const FILTERS = [['current', 'Current'], ['finished', 'Reported'], ['all', 'All']];
const AUDIT = { kind: 'orders' };
const COLUMNS = [
  { field: 'order_code', title: 'Order', type: 'link', width: 100, href: (r) => '#/orders/' + r.id },
  { field: 'client_name', title: 'Client', type: 'link', width: 190, href: (r) => '#/clients/' + r.client_id },
  { field: 'status', title: 'Status', type: 'readonly', width: 95 },
  { field: 'submission_channel', title: 'Channel', type: 'readonly', width: 80 },
  { field: 'po_number', title: 'PO', type: 'readonly', width: 100 },
  { field: 'logged_count', title: 'Samples logged', type: 'readonly', width: 115, format: (v, r) => `${v} of ${r.sample_count}` },
  { field: 'due_date', title: 'Due', type: 'readonly', width: 110, format: d8 },
  { field: 'rush_pending', title: 'Rush', type: 'readonly', width: 140, format: (v, r) => [v ? `${v} awaiting approval` : '', r.rush_active ? `${r.rush_active} active` : ''].filter(Boolean).join(' · ') },
  { field: 'order_value', title: 'Value', type: 'money', width: 100 },
  { field: 'account_status', title: 'Client', type: 'readonly', width: 85, format: (v) => (v === 'Active' ? '' : v) },
];
const rowClass = (r) => (r.account_status === 'On Hold' ? 'warnrow' : '');
const openRow = (r) => { window.location.hash = '#/orders/' + r.id; };
const openExact = (r) => { window.location.hash = r.sample_id ? '#/samples/' + r.sample_id : '#/orders/' + r.id; };

export default function OrdersPage({ query }) {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const meta = useMeta();
  return <>
    <PageHeader title="Lab orders" audit={AUDIT}
      subtitle={`Orders for ${site ? site.site_code : 'your lab'}. The samples a client orders at one time; tests can only come from the client's accepted quotes. Newest first, 50 at a time; scan or type an order, PO or sample ID and press Enter to open it.`}
      actions={<button type="button" className="btn primary" id="new" onClick={() => openNewOrder(dialogs, toast, { site, meta })}>+ New lab order</button>} />
    <PagedList load={listOrders} query={query} filters={FILTERS} open={openExact}
      placeholder="Search by order, client, PO or contact; scan or type an order, PO or sample ID and press Enter">
      {(rows) => <ReadGrid rows={rows} columns={COLUMNS} rowClass={rowClass} onRowOpen={openRow} emptyText="No orders here." />}
    </PagedList>
  </>;
}
