// Testing (backend: testing module): the backlog, batches, the bench steps, QC Review and timepoint releases.
// Every change clears the cached answers (a batch change touches the backlog, the lists and the sample pages).
import { get, post } from './client.js';

const pageQuery = ({ page, size, q, f }) => {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  return p;
};

// ---------------------------------------------------------------- backlog
export const getBacklog = (opts) => get('/testing/backlog', opts);
export const getSplitRequests = (opts) => get('/testing/split-requests', opts);
export const decideSplit = (id, decision, note) => post(`/testing/split-requests/${id}/decide`, { decision, note });
export const makeBatch = (testVersionId, items) => post('/testing/batches', { test_version_id: testVersionId, items });
export const openBatches = (versionId) => get('/testing/open-batches?version=' + encodeURIComponent(versionId), { fresh: true });

// ---------------------------------------------------------------- batches
export const listBatches = (show, opts) => get('/testing/batches?show=' + encodeURIComponent(show), opts);
// every batch ever made, one page at a time (0.35.0)
export const listAllBatches = (params, opts) => get(`/testing/batches?show=all&${pageQuery(params)}`, opts);
export const assignBatch = (id, userId) => post(`/testing/batches/${id}/assign`, { user_id: userId });

// ---------------------------------------------------------------- one batch
export const getBatch = (id, opts) => get('/testing/batches/' + id, opts);
export const batchOptions = (id, opts) => get(`/testing/batches/${id}/options`, opts);
export const cancelBatch = (id, reason, signature) => post(`/testing/batches/${id}/cancel`, { reason, signature });
export const addToBatch = (id, items) => post(`/testing/batches/${id}/add`, { items });
export const batchPool = (id) => get(`/testing/batches/${id}/pool`, { fresh: true });
export const removeEntry = (entryId) => post(`/testing/entries/${entryId}/remove`, {});
export const setParent = (entryId, parentId) => post(`/testing/entries/${entryId}/parent`, { parent_entry_id: parentId || null });
export const reprepBatch = (id, body) => post(`/testing/batches/${id}/reprep`, body);
export const lotEntries = (id) => get(`/testing/batches/${id}/lot-entries`, { fresh: true });

// ---------------------------------------------------------------- a step
export const saveValues = (stepRunId, rows, reason) => post(`/testing/step-runs/${stepRunId}/values`, { reason, rows });
export const saveFields = (stepRunId, fields, reason) => post(`/testing/step-runs/${stepRunId}/fields`, { fields, reason });
export const addEquipmentUsed = (stepRunId, body) => post(`/testing/step-runs/${stepRunId}/equipment`, body);
export const addMaterialUsed = (stepRunId, body) => post(`/testing/step-runs/${stepRunId}/materials`, body);
export const attachRawData = (stepRunId, body) => post(`/testing/step-runs/${stepRunId}/attachments`, body);
export const scanAliquot = (stepRunId, code) => post(`/testing/step-runs/${stepRunId}/scan-aliquot`, { code });
export const addRun = (stepRunId, body) => post(`/testing/step-runs/${stepRunId}/runs`, body);
export const reopenStep = (stepRunId, reason, signature) => post(`/testing/step-runs/${stepRunId}/reopen`, { reason, signature });
export const completeStep = (stepRunId, signature, witness) => post(`/testing/step-runs/${stepRunId}/complete`, { signature, witness });
export const removeUsed = (kind, id) => post(`/testing/used/${kind}/${id}/remove`, {});
export const pickReading = (entryId, body) => post(`/testing/entries/${entryId}/pick`, body);
export const startLoad = (stepRunId, body) => post(`/testing/step-runs/${stepRunId}/loads`, body);
export const updateLoad = (loadId, body) => post(`/testing/loads/${loadId}`, body);

// ---------------------------------------------------------------- QC Review
export const getReview = (id, opts) => get(`/testing/batches/${id}/review`, opts);
export const oosForBatch = (id, opts) => get(`/oos/for?batch=${encodeURIComponent(id)}`, opts);
export const reviewMark = (id, stepRunId, undo) => post(`/testing/batches/${id}/steps/${stepRunId}/review-mark`, { undo });
export const acceptQc = (id, body) => post(`/testing/batches/${id}/accept-qc`, body);
export const acceptLoad = (id, loadId, justification) => post(`/testing/batches/${id}/accept-load`, { load_id: loadId, justification });
export const chooseResult = (id, rows) => post(`/testing/batches/${id}/choose`, { rows });
export const approveBatch = (id, signature) => post(`/testing/batches/${id}/approve`, { signature });
export const returnBatch = (id, body) => post(`/testing/batches/${id}/return`, body);
export const releaseTimepoint = (id, stepRunId, signature) => post(`/testing/batches/${id}/timepoints/${stepRunId}/release`, { signature });
