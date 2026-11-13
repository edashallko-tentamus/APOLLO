// The quote dialogs other screens reuse (the quote page, the quotes list, later stability quotes). Each takes
// `dialogs` from useDialogs() and `toast` from useToast(), and resolves when done:
//   await decideQuote(dialogs, toast, r, 'Accepted' | 'Rejected')   // r: { version_id, client_id, quote_contact_id, sent_to_contact_id, project_code }; true when recorded
//   await sendQuote(dialogs, toast, v, contacts)                    // v: the version (id, project_code, status, quote_contact_id, sent_to_contact_id); the send answer, or null
//   await newQuote(dialogs, toast, clientId)                        // opens the new quote's page; false if cancelled
import * as api from '../../api/quotes.js';

const activePeople = (cl) => cl.contacts.filter((x) => x.status === 'Active' && x.contact_status === 'Active');

export async function decideQuote(dialogs, toast, r, decision) {
  if (decision === 'Accepted') {
    let people;
    try { people = activePeople(await api.getClient(r.client_id)); } catch (e) { toast(e.message, 'err'); return false; }
    const v = await dialogs.form({ title: `Accept ${r.project_code}`, okText: 'Record acceptance',
      intro: 'Record that the client accepted this quote (by phone, email or purchase order). The client can then order these tests at these prices; an earlier accepted version is superseded.',
      fields: [{ name: 'contact_id', label: 'Accepted by', type: 'select', required: true, value: r.sent_to_contact_id || r.quote_contact_id || '', options: people.map((x) => ({ value: x.contact_id, label: x.contact_name })) },
        { name: 'note', label: 'How (optional)', help: 'For example "PO 4471 received" or "by phone".' }],
      submit: (x) => api.decideQuoteVersion(r.version_id, { decision, contact_id: x.contact_id, note: x.note }) });
    if (!v) return false;
    toast(`${r.project_code} accepted.`);
    return true;
  }
  const v = await dialogs.form({ title: `Reject ${r.project_code}`, okText: 'Record rejection', intro: 'Record that the client turned this quote down. The reason helps the sales team (price, turnaround, scope, went elsewhere).',
    fields: [{ name: 'note', label: 'Why', type: 'textarea', required: true }],
    submit: (x) => api.decideQuoteVersion(r.version_id, { decision, note: x.note }) });
  if (!v) return false;
  toast(`${r.project_code} rejected.`);
  return true;
}

export async function newQuote(dialogs, toast, clientId) {
  let clients;
  try { clients = await api.allClients(); } catch (e) { toast(e.message, 'err'); return false; }
  const v = await dialogs.form({ title: 'New quote', okText: 'Next', intro: 'A quote for one customer request. For a product the client will test again and again, make a project instead.',
    fields: [{ name: 'client_id', label: 'Client', type: 'select', required: true, value: clientId || '', options: clients.filter((c) => c.status !== 'Inactive').map((c) => ({ value: c.id, label: c.legal_name })) },
      { name: 'project_name', label: 'Reference (optional)', help: 'What the client asked for, e.g. "Collagen powder, 3 lots". Leave blank for "Quote for <client>".' }] });
  if (!v) return false;
  let people;
  try { people = activePeople(await api.getClient(v.client_id)); } catch (e) { toast(e.message, 'err'); return false; }
  let contact = '';
  if (people.length) {
    const w = await dialogs.form({ title: 'Who is the quote for?', okText: 'Create quote', fields: [{ name: 'quote_contact_id', label: 'Contact', type: 'select', value: people[0].contact_id,
      options: people.map((x) => ({ value: x.contact_id, label: `${x.contact_name}${x.email ? ' <' + x.email + '>' : ''}` })) }] });
    if (!w) return false;
    contact = w.quote_contact_id;
  }
  try {
    const r = await api.createQuote({ ...v, quote_contact_id: contact });
    toast(`${r.project_code} started: add the tests.`);
    window.location.hash = '#/quote/' + r.version_id;
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

export async function sendQuote(dialogs, toast, v, contacts) {
  const issued = v.status === 'Quoted';
  const def = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const people = contacts.filter((c) => c.email);
  if (!people.length) { toast('None of this client\'s contacts has an email address: add one on the client first.', 'err'); return null; }
  const out = await dialogs.form({ title: `Send ${v.project_code} to the client`, okText: issued ? 'Send' : 'Issue and send',
    intro: `${issued ? '' : 'Sending issues the quote: its prices, analytes and rush terms are locked. '}The client gets the quotation as a PDF and a link to accept or decline it online. In the Sandbox the email goes to the Outbox.`,
    fields: [{ name: 'contact_id', label: 'To', type: 'select', required: true, value: v.sent_to_contact_id || v.quote_contact_id || people[0].id, options: people.map((c) => ({ value: c.id, label: `${c.name} <${c.email}>` })) },
      ...(issued ? [] : [{ name: 'valid_until', label: 'Valid until', type: 'date', value: def }]),
      { name: 'message', label: 'Message (optional)', type: 'textarea', help: 'Added to the email, e.g. what you agreed on the phone.' }],
    submit: (r) => api.sendQuoteVersion(v.id, r) });
  if (!out) return null;
  toast('Quote sent: the email is in the Outbox.');
  return out;
}
