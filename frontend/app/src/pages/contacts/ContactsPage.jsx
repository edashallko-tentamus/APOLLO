// Intake > Contacts: one record per person; link them to clients (and set their roles) from each client page.
import { listContacts, saveContacts } from '../../api/contacts.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import PagedList from '../../components/PagedList.jsx';

const FILTERS = [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const contactHref = (r) => (r.contact_code ? '#/contacts?find=' + encodeURIComponent(r.contact_code) : null);

// fixed for the page's lifetime, so rows are not redrawn for nothing
const COLUMNS = [
  { field: 'contact_code', title: 'Code', type: 'link', width: 90, href: contactHref },
  { field: 'first_name', title: 'First name', required: true },
  { field: 'last_name', title: 'Last name', required: true },
  { field: 'email', title: 'Email', required: true, width: 230, validate: (v) => (v && !EMAIL.test(v) ? 'Not a valid email' : null) },
  { field: 'phone', title: 'Phone' },
  { field: 'job_title', title: 'Job title' },
  { field: 'portal_access', title: 'Portal login', type: 'bool', width: 90 },
  { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90 },
  { field: 'clients', title: 'Linked clients', type: 'readonly', width: 220 },
];
const newContact = () => ({ status: 'Active', portal_access: false });
const AUDIT = { kind: 'contacts' };

export default function ContactsPage({ query }) {
  return <>
    <PageHeader title="Contacts" audit={AUDIT} subtitle="One record per person. Link contacts to clients (and set their roles) from each client page. Newest first, 50 at a time; search finds anyone." />
    <PagedList load={listContacts} query={query} filters={FILTERS} placeholder="Search by name, email, phone or client">
      {(rows, data, reload) => (
        <EditableGrid rows={rows} columns={COLUMNS} allowAdd newRow={newContact} what="contact records"
          save={saveContacts} afterSave={reload} />
      )}
    </PagedList>
  </>;
}
