// Electronic logbooks (L-1, L-2): logbooks, entries, QA review, and the cards other pages show.
import { get, post } from './client.js';

const INV = '/logbooks';

export const listLogbooks = (opts) => get('/logbooks', opts);
export const createLogbook = (body) => post('/logbooks', body, { invalidates: INV });
// query: { from, to, equipment, status } (only those set are sent)
export function getLogbook(id, query = {}, opts) {
  const p = new URLSearchParams(); for (const k of ['from', 'to', 'equipment', 'status']) if (query[k]) p.set(k, query[k]);
  return get(`/logbooks/${id}${p.toString() ? '?' + p : ''}`, opts);
}
export const saveLogbookSettings = (id, body) => post(`/logbooks/${id}/settings`, body, { invalidates: INV });
export const saveLogbookFields = (id, rows, reason) => post(`/logbooks/${id}/fields`, { rows, reason }, { invalidates: INV });
export const newLogbookVersion = (id, body) => post(`/logbooks/${id}/new-version`, body, { invalidates: INV });
export const approveLogbookDesign = (id, signature) => post(`/logbooks/${id}/approve`, { signature }, { invalidates: INV });
export const saveLogbookEquipment = (id, rows, reason) => post(`/logbooks/${id}/equipment`, { rows, reason }, { invalidates: INV });
export const recordEntries = (id, rows, signature) => post(`/logbooks/${id}/entries`, { rows, signature }, { invalidates: INV });

export const getEntry = (id, opts) => get('/logbooks/entries/' + id, opts);
export const correctEntry = (id, body) => post(`/logbooks/entries/${id}/correct`, body, { invalidates: INV });
export const returnEntry = (id, note) => post(`/logbooks/entries/${id}/return`, { note }, { invalidates: INV });
export const voidEntry = (id, body) => post(`/logbooks/entries/${id}/void`, body, { invalidates: INV });
export const giveEntryReason = (id, body) => post(`/logbooks/entries/${id}/reason`, body, { invalidates: INV });
export const resolveFlag = (flagId, note) => post(`/logbooks/flags/${flagId}/resolve`, { note }, { invalidates: INV });

export const getReview = (opts) => get('/logbooks/review', opts);
export const approveEntries = (ids, signature, comment) => post('/logbooks/review/approve', { ids, comment, signature }, { invalidates: INV });

// cards on other pages
export const logbooksForEquipment = (id, opts) => get('/logbooks/for-equipment/' + id, opts);
export const logbooksForLot = (id, opts) => get('/logbooks/for-lot/' + id, opts);
export const studyExcursions = (studyId, opts) => get('/logbooks/excursions?study=' + encodeURIComponent(studyId), opts);
export const batchEquipmentFlags = (batchId, opts) => get(`/testing/batches/${batchId}/equipment-flags`, opts);
export const acceptEquipmentFlag = (batchId, body) => post(`/testing/batches/${batchId}/accept-flag`, body, { invalidates: '/testing' });
export const batchAliquots = (batchId, opts) => get(`/testing/batches/${batchId}/aliquots`, opts);
