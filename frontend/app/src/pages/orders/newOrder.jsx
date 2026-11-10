// "+ New lab order": pick the client, then the order's details; opens the new order.
//   await openNewOrder(dialogs, toast, { site, meta, clientId })   // site: useSession().site, meta: useMeta()
import * as api from '../../api/orders.js';

export async function openNewOrder(dialogs, toast, { site, meta, clientId } = {}) {
  if (!site) { toast('You are not assigned to a lab, so you cannot create orders. Ask an administrator.', 'err'); return; }
  let clients;
  try { clients = await api.orderClients(); } catch (e) { toast(e.message, 'err'); return; }
  const a = await dialogs.form({ title: 'New lab order', okText: 'Next',
    intro: <>Testing lab: <b>{site.site_code}</b> ({site.site_name}). To order for another lab, switch lab at the top right first.</>,
    fields: [{ name: 'client_id', label: 'Client', type: 'select', required: true, value: clientId,
      options: clients.filter((c) => c.account_status !== 'Inactive').map((c) => ({ value: c.id, label: c.legal_name + (c.account_status === 'On Hold' ? ' (On Hold: reports will be held)' : '') })) }] });
  if (!a) return;
  let setup;
  try { setup = await api.orderSetup(a.client_id); } catch (e) { toast(e.message, 'err'); return; }
  if (!setup.contacts.length) { toast('This client has no contact with the Ordering role. Add one on the client page first.', 'err'); return; }
  if (!Number(setup.orderableCount)) toast('Note: this client has no accepted quote yet, so no tests can be added until it is quoted or accepts list price.', 'err');
  const r = await dialogs.form({ title: 'New lab order: details', okText: 'Create order', fields: [
    { name: 'ordering_contact_id', label: 'Ordering contact', type: 'select', required: true, blank: false, options: setup.contacts.map((c) => ({ value: c.id, label: c.name })) },
    { name: 'submission_channel', label: 'Submission channel', type: 'select', blank: false, value: 'Walk-in', options: meta?.enums?.submission_channel || ['Online', 'Walk-in', 'Paper', 'Phone'] },
    { name: 'po_number', label: 'Purchase order number' }, { name: 'notes', label: 'Notes', type: 'textarea' }],
  submit: (b) => api.createOrder({ ...a, ...b }) });
  if (r) window.location.hash = '#/orders/' + r.id;
}
