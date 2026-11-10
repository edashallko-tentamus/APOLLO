// The order's test picker (0.36.0): every test of the lab with the client's quoted price or the list price
import { get, post } from './client.js';

export const pickerData = (orderId) => get(`/orders/${orderId}/picker`, { fresh: true });
export const addCatalogueTests = (orderId, body) => post(`/orders/${orderId}/catalogue-tests`, body);
