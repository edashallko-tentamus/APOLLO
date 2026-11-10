// Equipment (Phase 1, migration 009): the register, due list, each lab's lists, the equipment page and its actions.
import { get, post, put } from './client.js';

const EQ = { invalidates: '/equipment' };

export const equipmentMe = () => get('/equipment/me', { fresh: true }); // { can_edit, can_tag, can_calibrate, can_release, can_lists }
export function listEquipment({ page, size, q, f }, { fresh = false } = {}) {
  const p = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('show', f);
  return get(`/equipment?${p}`, { fresh });
}
export const equipmentDue = () => get('/equipment/due', { fresh: true });
export const equipmentLists = () => get('/equipment/lists', { fresh: true }); // { types, departments, locations, groups, people }
export const saveTypes = (rows, reason, signature) => post('/equipment/types/bulk', { rows, reason, signature }, EQ);
export const saveDepartments = (rows, reason, signature) => post('/equipment/departments/bulk', { rows, reason, signature }, EQ);

export const getEquipment = (id) => get('/equipment/' + id, { fresh: true });
export const createEquipment = (body) => post('/equipment', body, EQ);
export const updateEquipment = (id, body) => put('/equipment/' + id, body, EQ);
export const addManyEquipment = (body) => post('/equipment/many', body, EQ);

// the equipment page's grids
export const saveCalibration = (id, body) => put('/equipment/calibrations/' + id, body, EQ);
export const saveQualification = (id, body) => put('/equipment/qualifications/' + id, body, EQ);
export const saveSchedules = (id, body) => post(`/equipment/${id}/schedules`, body, EQ);
export const saveDocuments = (body) => post('/equipment/documents/bulk', body, EQ);

// actions: tag-out, events, calibrations, qualifications, documents, status, transfer
export const equipmentAction = (id, action, body) => post(`/equipment/${id}/${action}`, body, EQ);
export const tagIn = (tagId, body) => post(`/equipment/tags/${tagId}/tag-in`, body, EQ);
export const transferOptions = () => get('/equipment/transfer-options', { fresh: true });

// Service companies come from the shared supplier list (Purchasing); the name is stored with the record
export const serviceSuppliers = () => get('/purchasing/suppliers');

export const equipmentDocUrl = (docId, siteId) => `/api/equipment/documents/${docId}/file?s=${encodeURIComponent(siteId || '')}`;
