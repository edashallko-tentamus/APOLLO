// Lab orders and samples (backend: orders module): the list, an order with its samples and tests, the sample page.
import { get, post, put } from './client.js';

const pageQuery = ({ page, size, q, f }) => {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  return p;
};

// One page: { rows, total, page, pages, size, filter, counts, q, exact }
export const listOrders = (params, { fresh = false } = {}) => get(`/orders?${pageQuery(params)}`, { fresh });

// New order
export const orderClients = () => get('/clients');
export const orderSetup = (clientId) => get(`/order-setup/${clientId}`, { fresh: true });
export const createOrder = (row) => post('/orders', { row });

// One order
export const getOrder = (id, { fresh = false } = {}) => get(`/orders/${id}`, { fresh });
export const updateOrder = (id, row) => put(`/orders/${id}`, { row });
export const orderCoas = (id, { fresh = false } = {}) => get(`/orders/${id}/coas`, { fresh });
export const saveSamples = (id, rows, reason) => post(`/orders/${id}/samples`, { rows, reason });
export const saveTests = (id, rows, reason) => post(`/orders/${id}/tests`, { rows, reason });
export const packageCancelPreview = (testId) => get(`/requested-tests/${testId}/package-cancel`, { fresh: true });
export const applyProject = (id, sampleIds, projectId) => post(`/orders/${id}/apply-project`, { sample_ids: sampleIds, project_id: projectId });
export const addPackage = (id, sampleIds, qp) => post(`/orders/${id}/add-package`, { sample_ids: sampleIds, quoted_package_id: qp });
export const cancelItems = (id, sampleIds, testIds, reason) => post(`/orders/${id}/cancel`, { sample_ids: sampleIds, test_ids: testIds, reason });
export const rushOrder = (id, tiers, reason) => post(`/orders/${id}/rush`, { tiers, reason });
export const logSamples = (id, sampleIds) => post(`/orders/${id}/log`, { sample_ids: sampleIds });
export const testAnalytes = (testId) => get(`/requested-tests/${testId}/analytes`, { fresh: true });
export const saveTestAnalytes = (testId, rows, reason) => post(`/requested-tests/${testId}/analytes`, { rows, reason });

// One sample
export const getSample = (id, { fresh = false } = {}) => get(`/samples/${id}`, { fresh });
export const sampleResults = (id, { fresh = false } = {}) => get(`/testing/samples/${id}/results`, { fresh });
export const sampleOos = (id, { fresh = false } = {}) => get(`/oos/for?sample=${id}`, { fresh });
export const servingRequest = (sampleId, role, note) => post(`/samples/${sampleId}/serving-request`, { role, note });
export const oosRetest = (oosId, body) => post(`/oos/${oosId}/retest`, body);
export const oosPhase2 = (oosId, body) => post(`/oos/${oosId}/phase2`, body);
export const decideSplit = (splitId, decision, note) => post(`/testing/split-requests/${splitId}/decide`, { decision, note });
