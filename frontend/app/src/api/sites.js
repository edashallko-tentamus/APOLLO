// Sites and holidays (Admin)
import { get, post } from './client.js';

export const listSites = (opts) => get('/sites', opts);
export const listTimezones = () => get('/timezones');
export const saveSites = (rows, reason) => post('/sites/bulk', { rows, reason });
export const listHolidays = (siteId, opts) => get(`/sites/${siteId}/holidays`, opts);
export const saveHolidays = (siteId, rows, reason) => post(`/sites/${siteId}/holidays/bulk`, { rows, reason });
