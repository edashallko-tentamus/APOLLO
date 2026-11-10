// The New project dialog (the projects list and the client page):
//   await openNewProject(dialogs, toast, { clientId })   // opens the new project's first quote version; false if cancelled
import { allClients, createProject } from '../../api/projects.js';

export async function openNewProject(dialogs, toast, { clientId = '' } = {}) {
  let clients;
  try { clients = await allClients(); } catch (e) { toast(e.message, 'err'); return false; }
  const r = await dialogs.form({ title: 'New project', okText: 'Create and start quote', fields: [
    { name: 'client_id', label: 'Client', type: 'select', required: true, value: clientId, options: clients.map((c) => ({ value: c.id, label: c.legal_name })) },
    { name: 'project_name', label: 'Project name', required: true, help: 'Usually one product or purpose, e.g. "Protein Powder Release Panel"' },
    { name: 'purpose', label: 'Purpose' },
    { name: 'available_to_child_clients', label: 'Sharing', type: 'checkbox', cbLabel: 'Child clients (sites) may order under this project' },
    { name: 'is_list_price_acceptance', label: 'List price acceptance', type: 'checkbox', cbLabel: 'Client accepts catalogue list pricing (no discounts)' },
  ], submit: (v) => createProject(v) });
  if (!r) return false;
  window.location.hash = '#/quote/' + r.version_id;
  return true;
}
