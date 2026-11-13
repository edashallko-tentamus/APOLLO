// Pricing > Stability quotes: the list, and "+ New stability quote" (client, lab, reference, product; then the contact).
import { allClients, createStabilityQuote, getClient, stabilityQuotes } from '../../api/stability.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { d8, Failed, Loading } from './shared.jsx';
import { Button, Card } from 'react-bootstrap';

const COLS = [
  { field: 'project_code', title: 'Quote', type: 'link', width: 95, compute: (r) => `${r.project_code}${r.version_no > 1 ? ' v' + r.version_no : ''}`, href: (r) => '#/stability/quotes/' + r.project_id },
  { field: 'client_name', title: 'Client', type: 'link', width: 170, href: (r) => '#/clients/' + r.client_id },
  { field: 'project_name', title: 'Reference', type: 'readonly', width: 230 },
  { field: 'product', title: 'Product', type: 'readonly', width: 190 },
  { field: 'site_code', title: 'Lab', type: 'readonly', width: 55 },
  { field: 'status', title: 'Status', type: 'readonly', width: 110, compute: (r) => (r.past_valid ? 'Past valid date' : r.status === 'Submitted for Quote' ? 'Submitted' : r.status),
    cellClass: (r) => ({ Accepted: 'tbpass', Rejected: 'tbfail' }[r.status] || (r.status === 'Quoted' ? 'tbwait' : '')) },
  { field: 'total', title: 'Study total', type: 'money', width: 100 },
  { field: 'study_code', title: 'Study', type: 'link', width: 95, href: (r) => (r.study_id ? '#/stability/studies/' + r.study_id : null) },
  { field: 'owner_name', title: 'Prepared by', type: 'readonly', width: 150 },
  { field: 'sent', title: 'Sent', type: 'readonly', width: 110, compute: (r) => (r.sent_at ? d8(r.sent_at) : r.quoted_at ? 'Issued, not sent' : '') },
  { field: 'valid_until', title: 'Valid until', type: 'readonly', width: 100, format: d8 },
];
const mutedRow = (r) => (['Rejected', 'Expired', 'Superseded'].includes(r.status) ? 'mutedrow' : '');
const openQuote = (r) => { window.location.hash = '#/stability/quotes/' + r.project_id; };

async function newStabilityQuote(dialogs, toast, labs, siteId) {
  let clients;
  try { clients = await allClients(); } catch (e) { toast(e.message, 'err'); return; }
  const v = await dialogs.form({ title: 'New stability quote', okText: 'Next', intro: 'The study is designed on the quote: storage conditions, timepoints, and the tests at each timepoint. It starts with the usual ICH set (25 °C / 60% RH and 40 °C / 75% RH; T0 to 24 months), which you then change.',
    fields: [{ name: 'client_id', label: 'Client', type: 'select', required: true, options: clients.filter((c) => c.status !== 'Inactive').map((c) => ({ value: c.id, label: c.legal_name })) },
      { name: 'site_id', label: 'Lab (stores and tests the material)', type: 'select', required: true, value: siteId || '', options: labs.map((l) => ({ value: l.id, label: l.site_code })) },
      { name: 'project_name', label: 'Reference', help: 'What the client asked for, e.g. "Fish oil softgels, 24 months real time".' },
      { name: 'product', label: 'Product' }, { name: 'lot', label: 'Lot (optional)' },
      { name: 'unit_name', label: 'Material counted in', value: 'units', help: 'bottles, blisters, sachets, jars...' }] });
  if (!v) return;
  let people;
  try { people = (await getClient(v.client_id)).contacts.filter((x) => x.status === 'Active' && x.contact_status === 'Active'); } catch (e) { toast(e.message, 'err'); return; }
  let contact = '';
  if (people.length) {
    const w = await dialogs.form({ title: 'Who is the quote for?', okText: 'Create quote', fields: [{ name: 'quote_contact_id', label: 'Contact', type: 'select', value: people[0].contact_id,
      options: people.map((x) => ({ value: x.contact_id, label: `${x.contact_name}${x.email ? ' <' + x.email + '>' : ''}` })) }] });
    if (!w) return;
    contact = w.quote_contact_id;
  }
  try {
    const r = await createStabilityQuote({ ...v, quote_contact_id: contact });
    toast(`${r.project_code} started: add the tests and tick the matrix.`);
    window.location.hash = '#/stability/quotes/' + r.id;
  } catch (e) { toast(e.message, 'err'); }
}

export default function QuotesPage({ query }) {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error } = useApi(() => stabilityQuotes(), []);
  const find = new URLSearchParams(query).get('find') || '';
  return <>
    <PageHeader title="Stability quotes" audit={{ kind: 'stability_quotes' }}
      subtitle="A stability study starts as a quote: the conditions, the timepoints and the tests at each one, priced per test. Sent and accepted like any quote (Pricing > Quotes lists them too); once accepted it becomes a study, and its T0 sample waits to be logged in."
      actions={d?.can_edit && <Button type="button" variant="primary" id="new" onClick={() => newStabilityQuote(dialogs, toast, d.labs, site?.id)}>+ New stability quote</Button>} />
    {error && !d ? <Failed error={error} /> : !d ? <Loading /> : (
      <Card body>
        <ReadGrid rows={d.rows} columns={COLS} keyField="version_id" search filter={find} rowClass={mutedRow} onRowOpen={openQuote}
          emptyText={d.can_edit ? 'No stability quotes yet. "+ New stability quote" starts one.' : 'No stability quotes yet.'} />
      </Card>
    )}
  </>;
}
