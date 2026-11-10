// Intake > Clients: one page at a time from the server (0.35.0)
import { allClients, createClient, listClients } from '../../api/clients.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useMeta } from '../../hooks/useMeta.js';
import { clientForm } from './clientForm.jsx';

const FILTERS = [['current', 'Current'], ['active', 'Active'], ['hold', 'On Hold'], ['inactive', 'Inactive'], ['all', 'All']];
const href = (r) => '#/clients/' + r.id;
const openClient = (r) => { window.location.hash = href(r); };
const COLUMNS = [
  { field: 'client_code', title: 'Code', type: 'link', width: 95, href },
  { field: 'legal_name', title: 'Legal name', type: 'link', width: 240, href },
  { field: 'display_name', title: 'Display name', type: 'readonly' },
  { field: 'parent_name', title: 'Parent client', type: 'link', href: (r) => (r.parent_client_id ? '#/clients/' + r.parent_client_id : null) },
  { field: 'account_status', title: 'Status', type: 'readonly', width: 90 },
  { field: 'is_gmp_client', title: 'GMP', type: 'readonly', width: 55, format: (v) => (v ? 'Yes' : '') },
  { field: 'can_order', title: 'Can order', type: 'readonly', width: 85, format: (v) => (v ? 'Yes' : 'No') },
  { field: 'can_release', title: 'Reports release', type: 'readonly', width: 115, format: (v) => (v ? 'Yes' : 'Blocked') },
  { field: 'contact_count', title: 'Contacts', type: 'readonly', width: 75 },
  { field: 'project_count', title: 'Projects', type: 'readonly', width: 75 },
];
const rowClass = (r) => (r.account_status === 'On Hold' ? 'warnrow' : r.account_status === 'Inactive' ? 'mutedrow' : '');
const AUDIT = { kind: 'clients' };

export default function ClientsPage({ query }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const meta = useMeta();

  async function newClient() {
    let all;
    try { all = await allClients(); } catch (e) { toast(e.message, 'err'); return; }
    const v = await clientForm(dialogs, meta, {}, all);
    if (!v) return;
    try { const r = await createClient(v); openClient(r); } catch (e) { toast(e.message, 'err'); }
  }

  return <>
    <PageHeader title="Clients" audit={AUDIT}
      subtitle="Hold and status apply to each client only. Nothing cascades from a parent client. Newest first, 50 at a time; search finds any client."
      actions={<button type="button" className="btn primary" onClick={newClient}>+ New client</button>} />
    <PagedList load={listClients} query={query} filters={FILTERS} open={openClient}
      placeholder="Search by code, name or parent client; type a client code and press Enter to open it">
      {(rows) => <EditableGrid readOnly rows={rows} columns={COLUMNS} emptyText="No clients here." onRowOpen={openClient} rowClass={rowClass} />}
    </PagedList>
  </>;
}
