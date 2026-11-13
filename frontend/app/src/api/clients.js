// Clients, their contacts and licenses (backend: clients module)
import { get, post, put } from './client.js';

const pageQuery = ({ page, size, q, f }) => {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  return p;
};

// One page of clients: { rows, total, page, pages, size, filter, counts, q, exact }
export const listClients = (params, { fresh = false } = {}) => get(`/clients?${pageQuery(params)}`, { fresh });
// Every client (the parent client pick list)
export const allClients = () => get('/clients');
export const getClient = (id, { fresh = false } = {}) => get(`/clients/${id}`, { fresh });
export const createClient = (row) => post('/clients', { row });
export const updateClient = (id, row, reason) => put(`/clients/${id}`, { row, reason });

// Contact links and roles: rows [{ id, roles, portal_visible, status }] or [{ client_id, contact_id, roles }]
export const saveClientContacts = (rows, reason) => post('/client-contacts/bulk', reason === undefined ? { rows } : { reason, rows });
export const allContacts = () => get('/contacts', { fresh: true });
export const createContacts = (rows) => post('/contacts/bulk', { rows });

// Licenses
export const listLicenses = ({ fresh = false } = {}) => get('/licenses', { fresh });
export const addLicense = (clientId, body) => post(`/clients/${clientId}/licenses`, body);
export const updateLicense = (id, body) => put(`/licenses/${id}`, body);
export const licenseFileUrl = (id) => `/api/licenses/${id}/file`;
