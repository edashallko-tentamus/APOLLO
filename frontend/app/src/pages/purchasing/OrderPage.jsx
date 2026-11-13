// One purchase order: the finance PO number, the supplier and its lines; change the PO number or confirmation, print.
import { useState } from 'react';
import { getOrder, purchasingMe, updateOrder } from '../../api/purchasing.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { dt, Failed, Kv, lineColsWithout, Loading, signed } from './shared.jsx';
import { Button, Card } from 'react-bootstrap';

const COLUMNS = lineColsWithout('po_code');

export default function OrderPage({ params }) {
  const id = params[0];
  const dialogs = useDialogs();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useApi(() => Promise.all([getOrder(id), purchasingMe()]), [id]);
  if (error && !data) return <Failed error={error} />;
  if (!data) return <Loading />;
  const [d, me] = data;
  const o = d.order;

  const edit = async () => {
    setBusy(true);
    try {
      const v = await dialogs.form({ title: `Change ${o.po_code}`, okText: 'Next: sign', fields: [{ name: 'external_po_number', label: 'Finance PO number', value: o.external_po_number || '' },
        { name: 'confirmation_number', label: "Supplier's confirmation", value: o.confirmation_number || '' }, { name: 'notes', label: 'Notes', value: o.notes || '' }] });
      if (!v) return;
      const ok = await signed(dialogs, { what: `Changes to ${o.po_code}`, meaning: 'Changed by', needReason: true }, (reason, signature) => updateOrder(o.id, v, reason, signature));
      if (ok) { toast('Saved and signed.'); reload(); }
    } finally { setBusy(false); }
  };

  return <>
    <div className="eyebrow">{o.site_code} · {o.supplier_name}</div>
    <PageHeader title={`Purchase order ${o.po_code}`} audit={{ kind: 'purchaseorder', id }}
      subtitle={o.external_po_number ? `Finance PO ${o.external_po_number}` : 'No finance PO number recorded yet'}
      actions={<>
        <Button variant="light" href="#/purchasing/orders">All orders</Button>{' '}
        {me.can_order && <><Button type="button" variant="outline-secondary" disabled={busy} onClick={edit}>Change PO number / confirmation</Button>{' '}</>}
        <Button type="button" variant="outline-secondary" onClick={() => window.print()}>Print</Button>
      </>} />
    <div className="cols">
      <Card body><h2>Order</h2><Kv pairs={[['Order', o.po_code], ['Finance PO number', o.external_po_number], ["Supplier's confirmation", o.confirmation_number],
        ['Ordered', `${o.ordered_by || ''} ${dt(o.ordered_at)}`], ['Notes', o.notes]]} /></Card>
      <Card body><h2>Supplier</h2><Kv pairs={[['Supplier', <a href={'#/purchasing/suppliers/' + o.supplier_id}>{o.supplier_name}</a>], ['Our account #', o.account_number], ['Contact', o.contact_name],
        ['Email', o.supplier_email], ['Phone', o.supplier_phone], ['Address', o.supplier_address]]} /></Card>
    </div>
    <Section title="Lines"><ReadGrid rows={d.lines} columns={COLUMNS} /></Section>
  </>;
}
