// Contacts (backend: clients module). One record per person, linked to clients from each client page.
import { get, post } from './client.js';

// One page: { rows, total, page, pages, size, filter, counts, q, exact }
export function listContacts({ page, size, q, f }, { fresh = false } = {}) {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  return get(`/contacts?${p}`, { fresh });
}

// New and changed rows in one save, with the Reason for Change
export const saveContacts = (rows, reason) => post('/contacts/bulk', { rows, reason }, { invalidates: '/contacts' });
