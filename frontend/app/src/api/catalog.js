// Test catalogue: tests, packages, dated price changes, charges and service lines
import { get, post, put } from './client.js';

export const listCatalog = ({ fresh = false } = {}) => get('/catalog', { fresh });
export const getCatalogTest = (id) => get(`/catalog/${id}`, { fresh: true });
export const saveCatalogTest = (id, body) => put(`/catalog/${id}`, body);
export const listRushSchedules = () => get('/rush-schedules');
export const listAnalytes = () => get('/analytes');

// Price changes: { pct, tests, effective_on, rounding, include_packages, reason }
export const listPriceChanges = ({ fresh = false } = {}) => get('/price-changes', { fresh });
export const createPriceChange = (body) => post('/price-changes', body);
export const cancelPriceChange = (id, reason) => post(`/price-changes/${id}/cancel`, { reason });

// Packages
export const listPackages = ({ fresh = false } = {}) => get('/packages', { fresh });
export const createPackage = (body) => post('/packages', body);
export const getPackage = (id) => get(`/packages/${id}`, { fresh: true });
export const packageOptions = () => get('/packages/options');
export const savePackage = (id, body) => put(`/packages/${id}`, body);
export const retirePackage = (id, reason) => post(`/packages/${id}/retire`, { reason });

// Charges (kits, shipping, fees, discounts)
export const listChargeItems = ({ fresh = false } = {}) => get('/charge-items', { fresh });
export const saveChargeItems = (rows, reason) => post('/charge-items', { rows, reason });

// Service lines and types, and this lab's tests under them
export const getServiceLines = ({ fresh = false } = {}) => get('/service-lines', { fresh });
export const saveServiceLines = (rows, reason) => post('/service-lines', { rows, reason });
export const saveServiceLineTypes = (rows, reason) => post('/service-lines/types', { rows, reason });
export const serviceLineTests = ({ fresh = false } = {}) => get('/service-lines/tests', { fresh });
export const saveServiceLineTests = (rows, reason) => post('/service-lines/tests', { rows, reason });
