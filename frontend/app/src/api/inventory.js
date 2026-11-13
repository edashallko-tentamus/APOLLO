// Inventory (backend: inventory module): lots, items, mixtures, stock movements, Supplier COAs, sample storage, the
// Supplier / Storage location / Warning rule lists, QA testing before use, Units and Unit conversions.
// Every create and change is signed (signature = { username, password }); routine usage is not.
import { get, post, put } from './client.js';

const INV = { invalidates: '/inventory' };
const pageQuery = ({ page, size, q, f }) => {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  return p;
};

// ---------------------------------------------------------------- lists used by several screens
export const inventoryMeta = () => get('/inventory/meta');      // { chemical_types, storage_conditions, units, conc_units, ..., ai: { enabled, model } }
export const inventoryMe = () => get('/inventory/me', { fresh: true }); // { can_approve, can_order, can_maintain, can_qualify, can_qa_configure }
export const listSuppliers = (opts) => get('/inventory/suppliers', opts);
export const listLocations = (opts) => get('/inventory/locations', opts);
export const listAnalytes = () => get('/analytes');
export const listDepartments = () => get('/departments');
export const wasteOptions = () => get('/waste/options');
export const inventorySites = () => get('/inventory/sites');

// ---------------------------------------------------------------- lots
export const listLots = (params, { fresh = false } = {}) => get(`/inventory/lots?${pageQuery(params)}`, { fresh }); // one page
export const allLots = () => get('/inventory/lots', { fresh: true });
export const usableLots = () => get('/inventory/lots?usable=1', { fresh: true });
export const getLot = (id, opts) => get('/inventory/lots/' + id, opts);
export const saveLotsBulk = (rows, reason, signature) => post('/inventory/lots/bulk', { rows, reason, signature }, INV);
export const createItem = (body) => post('/inventory/items', body, INV);
export const updateItem = (id, body) => put('/inventory/items/' + id, body, INV);
export const reorderLot = (id, body) => post(`/inventory/lots/${id}/reorder`, body, INV);
export const recordMovements = (body) => post('/inventory/movements', body, INV);
export const lotAction = (id, action, body) => post(`/inventory/lots/${id}/${action}`, body, INV); // purchase-status, receive, transfer, cancel, dispose, waive-qa
export const qualifyOptions = (id) => get(`/inventory/lots/${id}/qualify-options`, { fresh: true });
export const qualifyLot = (id, items) => post(`/inventory/lots/${id}/qualify`, { items }, INV);

// ---------------------------------------------------------------- Supplier COA
export const readCoa = (body) => post('/inventory/coa/read', body, INV);
export const uploadCoa = (lotId, body) => post(`/inventory/lots/${lotId}/coa`, body, INV);
export const confirmCoa = (coaId, body) => post(`/inventory/coa/${coaId}/confirm`, body, INV);
// opened in a new tab: the session cookie says who is asking; the lab comes in the link
export const coaFileUrl = (coaId, siteId) => `/api/inventory/coa/${coaId}/file?s=${encodeURIComponent(siteId || '')}`;

// ---------------------------------------------------------------- in-house mixtures
export const convertibleUnits = (units) => get('/units/convertible?units=' + encodeURIComponent(units.join(',')));
export const mixturePreview = (body) => post('/inventory/mixtures/preview', body, { invalidates: '/inventory/mixtures' });
export const prepareMixture = (body) => post('/inventory/mixtures/prepare', body, INV);

// ---------------------------------------------------------------- sample storage, lists, locations
export const sampleStorage = () => get('/inventory/samples', { fresh: true });
export const saveSampleStorage = (rows, reason, signature) => post('/inventory/samples/bulk', { rows, reason, signature }, INV);
export const saveSuppliers = (rows, reason, signature) => post('/inventory/suppliers/bulk', { rows, reason, signature }, INV);
export const saveLocations = (rows, reason, signature) => post('/inventory/locations/bulk', { rows, reason, signature }, INV);
export const getLocation = (id) => get('/inventory/locations/' + id, { fresh: true });
export const listThresholds = () => get('/inventory/thresholds', { fresh: true });
export const saveThresholds = (rows, reason, signature) => post('/inventory/thresholds/bulk', { rows, reason, signature }, INV);

// ---------------------------------------------------------------- QA testing before use
export const qaDefaults = (opts) => get('/inventory/qa-defaults', opts);
export const saveQaDefaults = (rows, reason) => post('/inventory/qa-defaults', { rows, reason }, INV);

// ---------------------------------------------------------------- Units and Unit conversions (Admin)
export const listUnits = () => get('/units', { fresh: true });
export const saveUnits = (rows, reason, signature) => post('/units/bulk', { rows, reason, signature }); // clears every cached answer (units appear everywhere)
export const listConversions = () => get('/unit-conversions', { fresh: true });
export const saveConversions = (rows, reason, signature) => post('/unit-conversions/bulk', { rows, reason, signature });
export const convertUnits = (from, to, form) => get(`/units/convert?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&form=${encodeURIComponent(form)}`);
