// Admin: people and their groups, temporary passwords, COA signatures, sign-in history, canned reasons,
// matrices, product categories and compliance categories
import { get, post } from './client.js';

export const getAdminUsers = (opts) => get('/admin/users', opts);
export const createUser = (v) => post('/admin/users', v);
export const saveMemberships = (rows, reason, signature) => post('/admin/memberships', { rows, reason, signature });
export const setTempPassword = (userId, password) => post(`/admin/users/${userId}/temp-password`, { password });
export const authEvents = () => get('/admin/auth-events', { fresh: true });
export const saveUserSignature = (userId, body) => post(`/admin/users/${userId}/signature`, body);
// the signature image itself (an <img> source; the lab is passed as ?s= since an image request carries no header)
export const userSignatureUrl = (userId, siteId) => `/api/admin/users/${userId}/signature?s=${encodeURIComponent(siteId || '')}&t=${Date.now()}`;

export const listAllReasons = (opts) => get('/reasons/all', opts);
export const saveReasons = (rows, reason) => post('/reasons/bulk', { rows, reason });

export const listMatrices = (opts) => get('/matrices', opts);
export const saveMatrices = (rows, reason) => post('/matrices/bulk', { rows, reason });
export const listProductCategories = (opts) => get('/product-categories', opts);
export const saveProductCategories = (rows, reason) => post('/product-categories/bulk', { rows, reason });
export const listComplianceCategories = (opts) => get('/compliance-categories', opts);
export const saveComplianceCategories = (rows, reason) => post('/compliance-categories', { rows, reason });
