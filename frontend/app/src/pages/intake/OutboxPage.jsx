// Intake > Outbox: every automatic email the system generates for the lab (nothing is sent in the Sandbox)
import { useMemo } from 'react';
import { listOutbox } from '../../api/intake.js';
import OutboxTemplates from '../reports/OutboxTemplates.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import { dateTime } from '../../lib/format.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { showEmail } from './EmailDialog.jsx';

export default function OutboxPage({ query }) {
  const { site } = useSession();
  const dialogs = useDialogs();
  const tab = new URLSearchParams(query).get('tab') === 'templates' ? 'templates' : 'emails';
  const open = useMemo(() => (e) => showEmail(dialogs, e, site?.id), [dialogs, site]);
  const columns = useMemo(() => [
    { field: 'created_at', title: 'When', type: 'readonly', width: 150, format: dateTime },
    { field: 'template', title: 'Type', type: 'readonly', width: 150 },
    { field: 'order_code', title: 'Order / quote', type: 'link', width: 105, compute: (r) => r.order_code || r.quote_code || '',
      href: (r) => (r.order_code ? '#/orders/' + r.lab_order_id : r.quote_project_id ? '#/quotes/' + r.quote_project_id : null) },
    { field: 'to_address', title: 'To', type: 'readonly', width: 230 },
    { field: 'subject', title: 'Subject', type: 'link', width: 380, href: () => '#', onClick: open },
    { field: 'triggered_by', title: 'Triggered by', type: 'readonly', width: 140 },
    { field: 'delivery_status', title: 'Delivery', type: 'readonly', width: 140 },
  ], [open]);

  return <>
    <PageHeader title="Outbox" audit={{ kind: tab === 'templates' ? 'templates' : 'outbox' }}
      subtitle={`Every automatic email the system generates for ${site ? site.site_code : 'your lab'}. In the Sandbox nothing is actually sent; this is exactly what the client would receive.`} />
    <div className="tabs">
      <a className={`tab${tab === 'emails' ? ' on' : ''}`} href="#/outbox">Emails</a>
      <a className={`tab${tab === 'templates' ? ' on' : ''}`} href="#/outbox?tab=templates" id="tplTab">Templates</a>
    </div>
    {tab === 'templates'
      ? <OutboxTemplates />
      : <PagedList load={listOutbox} query={query} placeholder="Search by subject, recipient, order, quote or type">
        {(rows) => <EditableGrid readOnly rows={rows} columns={columns} onRowOpen={open} emptyText="No emails here." />}
      </PagedList>}
  </>;
}
