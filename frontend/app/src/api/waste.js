// Waste classifications (Admin > Lab setup)
import { get, post } from './client.js';

export const getWaste = (opts) => get('/waste', opts);
export const saveWaste = (rows, reason) => post('/waste', { rows, reason });
