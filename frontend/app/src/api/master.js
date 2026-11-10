// Master data: Home tiles (#/start), analytes, rush fee schedules, the Audit trail page
import { get, post } from './client.js';

export const getStartCounts = (opts) => get('/dashboard', opts);

export const listAnalytes = (opts) => get('/analytes', opts);
export const saveAnalytes = (rows, reason, signature) => post('/analytes/bulk', { rows, reason, signature });

export const listRushSchedules = (opts) => get('/rush-schedules', opts);
export const createRushSchedules = (rows) => post('/rush-schedules/bulk', { rows });
export const saveRushTiers = (scheduleId, rows, reason) => post(`/rush-schedules/${scheduleId}/tiers/bulk`, { rows, reason });

export const auditTables = (opts) => get('/audit/tables', opts);
export const auditEntries = (table, opts) => get('/audit?table=' + encodeURIComponent(table || ''), opts);
