// The order page's Billing card: each test on the order and where its billing stands. Exported for the orders area:
//   <OrderBillingCard orderId={id} />   (draws nothing when the person may not see billing or the order has no tests)
import { orderBilling } from '../../api/billing.js';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money } from '../../lib/format.js';
import { d8 } from './shared.jsx';

const COLUMNS = [
  { field: 'sample_code', title: 'Sample', type: 'readonly', width: 125 },
  { field: 'client_sample_id', title: 'Client sample ID', type: 'readonly', width: 120 },
  { field: 'test_name', title: 'Test', type: 'readonly', width: 210, format: (v, t) => (t.is_retest ? 'Retest: ' : '') + v },
  { field: 'state', title: 'Billing', type: 'readonly', width: 130 },
  { field: 'charge', title: 'Charge', type: 'money', width: 90 },
  { field: 'invoice_code', title: 'Invoice', type: 'link', width: 140, href: (t) => (t.invoice_id ? '#/billing/invoices/' + t.invoice_id : null) },
  { field: 'invoice_date', title: 'Invoiced', type: 'readonly', width: 105, format: d8 },
  { field: 'detail', title: 'Notes', type: 'readonly', width: 260 },
];
const retestRow = (t) => (t.is_retest ? 'blretest' : '');

export default function OrderBillingCard({ orderId }) {
  const { data: d } = useApi(() => orderBilling(orderId).catch(() => null), [orderId]);
  if (!d || !d.allowed || !d.tests.length) return null;
  const sum = (st) => d.tests.filter((t) => st.includes(t.state)).reduce((x, t) => x + Number(t.charge || 0), 0);
  return <Section title="Billing" help="Each test on this order and where its billing stands. Work is invoiced once its COA is issued; an order may be invoiced in parts.">
    <div className="blsum"><div><b>{money(sum(['Invoiced']))}</b><span>invoiced</span></div><div><b>{money(sum(['On a draft', 'Ready to invoice']))}</b><span>ready or on a draft</span></div>
      <div><b>{money(sum(['In the lab', 'Waiting for QA']))}</b><span>still in the lab</span></div><div><b>{money(sum(['Invoiced', 'On a draft', 'Ready to invoice', 'In the lab', 'Waiting for QA']))}</b><span>order total</span></div></div>
    {d.invoices.length > 0 && <p className="help">Invoices: {d.invoices.map((x, k) => <span key={x.id}>{k > 0 && ' · '}<a href={'#/billing/invoices/' + x.id}>{x.code}</a> {x.status === 'Draft' ? `(draft, ${x.claimed_by_name || ''})` : d8(x.invoice_date)} {money(x.total)}{x.catchup ? ' (catch-up)' : ''}</span>)}</p>}
    <ReadGrid rows={d.tests} columns={COLUMNS} rowClass={retestRow} />
  </Section>;
}
