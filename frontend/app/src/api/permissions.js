// Groups and what they may do, the permission matrix and its change history
import { get, post } from './client.js';

export const getGroups = (opts) => get('/groups', opts);
export const saveGroups = (rows, reason, signature) => post('/groups', { rows, reason, signature });
export const saveGroupPermissions = (rows, reason, signature) => post('/groups/permissions', { rows, reason, signature });
export const getPermissionMatrix = (opts) => get('/permission-matrix', opts);
export const getPermissionHistory = (opts) => get('/permission-history', opts);
// Excel downloads (plain links; the lab goes as ?s=)
export const permissionMatrixXlsx = (siteId, what = '') => `/api/permission-matrix.xlsx?s=${encodeURIComponent(siteId || '')}${what ? '&what=' + what : ''}`;
