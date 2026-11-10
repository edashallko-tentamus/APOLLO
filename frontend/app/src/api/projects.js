// Projects and quote versions: lines, analytes, packages, rush terms, lifecycle (backend: commercial module)
import { get, post, put } from './client.js';

// One page: { rows, total, page, pages, size, filter, counts, q, exact }
export function listProjects({ page, size, q, f }, { fresh = false } = {}) {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  return get(`/projects?${p}`, { fresh });
}
export const getProject = (id, { fresh = false } = {}) => get(`/projects/${id}`, { fresh });
export const createProject = (row) => post('/projects', { row });
export const updateProject = (id, row) => put(`/projects/${id}`, { row });
export const newProjectVersion = (projectId) => post(`/projects/${projectId}/versions`, {});

export const getVersion = (vid, { fresh = false } = {}) => get(`/versions/${vid}`, { fresh });
export const versionPackages = (vid, { fresh = false } = {}) => get(`/versions/${vid}/packages`, { fresh });
export const saveLines = (vid, rows, extra = {}) => post(`/versions/${vid}/lines`, { rows, ...extra });
export const setVersionStatus = (vid, body) => post(`/versions/${vid}/status`, body);
export const saveRushTerms = (vid, rows) => post(`/versions/${vid}/rush-terms`, { rows });
export const addServingLine = (vid, body) => post(`/versions/${vid}/serving-line`, body);

export const lineAnalytes = (lineId) => get(`/lines/${lineId}/analytes`, { fresh: true });
export const saveLineAnalytes = (lineId, rows) => post(`/lines/${lineId}/analytes`, { rows });

export const addPackage = (vid, packageId, quantity) => post(`/versions/${vid}/packages`, { package_id: packageId, quantity });
export const updateQuotedPackage = (id, body) => put(`/quoted-packages/${id}`, body);
export const removeQuotedPackage = (id) => post(`/quoted-packages/${id}/remove`, {});

export const allClients = () => get('/clients');
// the quotation PDF (opened in a new tab, like the current app): the one sent, or a fresh preview
export const quotePdfUrl = (vid, fresh) => `/api/quotes/versions/${vid}/pdf${fresh ? '?fresh=1' : ''}`;
