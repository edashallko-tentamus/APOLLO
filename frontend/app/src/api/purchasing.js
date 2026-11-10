// Purchasing (backend: purchasing module): the request queue (approve, reject, order), receiving, purchase orders,
// vendor approvals (local and corporate, documents, proposals, notices), risk classes and supply scopes, lab settings.
// Every create and change is signed (signature = { username, password }).
import { get, post, put } from './client.js';

const PU = { invalidates: '/purchasing' };
const pageQuery = ({ page, size, q, f }) => {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  return p;
};

// { can_request, can_approve, can_approve_over, can_order, can_receive, can_qualify, can_qualify_corporate, can_settings }
export const purchasingMe = () => get('/purchasing/me', { fresh: true });

// ---------------------------------------------------------------- requests
export const listLines = (params, { fresh = false } = {}) => get(`/purchasing/lines?${pageQuery(params)}`, { fresh }); // one page (+ setting)
export const allLines = () => get('/purchasing/lines', { fresh: true });
export const getLine = (id) => get('/purchasing/lines/' + id, { fresh: true });
export const createLine = (row, signature) => post('/purchasing/lines', { row, signature }, PU);
export const updateLine = (id, row, reason, signature) => put('/purchasing/lines/' + id, { row, reason, signature }, PU);
export const approveLines = (ids, signature) => post('/purchasing/approve', { ids, signature }, PU);
export const rejectLines = (ids, reason, signature) => post('/purchasing/reject', { ids, reason, signature }, PU);
// receiving can make an inventory lot or an equipment record too
export const receiveLine = (id, body) => post(`/purchasing/lines/${id}/receive`, body, { invalidates: '/' });

// ---------------------------------------------------------------- purchase orders
export const listOrders = (params, { fresh = false } = {}) => get(`/purchasing/orders?${pageQuery(params)}`, { fresh });
export const getOrder = (id) => get('/purchasing/orders/' + id, { fresh: true });
export const createOrder = (body) => post('/purchasing/orders', body, PU);
export const updateOrder = (id, row, reason, signature) => put('/purchasing/orders/' + id, { row, reason, signature }, PU);

// ---------------------------------------------------------------- vendors
export const listSuppliers = () => get('/purchasing/suppliers', { fresh: true });
export const listVendors = () => get('/purchasing/vendors', { fresh: true }); // { rows, notices, promotions }
export const getSupplier = (id) => get('/purchasing/suppliers/' + id, { fresh: true });
export const addQualification = (supplierId, body) => post(`/purchasing/suppliers/${supplierId}/qualifications`, body, PU);
export const withdrawQualification = (id, reason, signature) => post(`/purchasing/qualifications/${id}/withdraw`, { reason, signature }, PU);
export const attachDocuments = (qualificationId, documents) => post(`/purchasing/qualifications/${qualificationId}/documents`, { documents }, PU);
export const withdrawDocument = (id, reason) => post(`/purchasing/documents/${id}/withdraw`, { reason }, PU);
export const documentUrl = (id, siteId) => `/api/purchasing/documents/${id}/file?s=${encodeURIComponent(siteId || '')}`;
export const slipUrl = (receiptId, siteId) => `/api/purchasing/receipts/${receiptId}/slip?s=${encodeURIComponent(siteId || '')}`;
export const proposePromotion = (qualificationId, body) => post(`/purchasing/qualifications/${qualificationId}/propose`, body, PU);
export const decidePromotion = (id, body) => post(`/purchasing/promotions/${id}/decide`, body, PU);
export const withdrawPromotion = (id, reason) => post(`/purchasing/promotions/${id}/withdraw`, { reason }, PU);
export const acknowledgeNotices = (ids) => post('/purchasing/notices/acknowledge', { ids }, PU);

// ---------------------------------------------------------------- risk classes, scopes, settings
export const listRiskClasses = () => get('/purchasing/risk-classes', { fresh: true });
export const saveRiskClasses = (rows, reason, signature) => post('/purchasing/risk-classes', { rows, reason, signature }, PU);
export const listScopes = (opts) => get('/purchasing/scopes', opts);
export const saveScopes = (rows, reason, signature) => post('/purchasing/scopes', { rows, reason, signature }, PU);
export const getSettings = () => get('/purchasing/settings', { fresh: true });
export const saveSettings = (row, reason, signature) => put('/purchasing/settings', { row, reason, signature }, PU);

// ---------------------------------------------------------------- lookups from other modules (receiving)
export const storageLocations = () => get('/inventory/locations');
export const equipmentLists = () => get('/equipment/lists');
