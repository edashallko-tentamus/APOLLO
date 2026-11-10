// Charges on a lab order and on a quote, and a client's service lines (0.36.0)
import { get, post, put } from './client.js';

export const orderCharges = (orderId) => get(`/orders/${orderId}/charges`, { fresh: true });
export const addOrderCharge = (orderId, body) => post(`/orders/${orderId}/charges`, body);
export const changeOrderCharge = (id, body) => put(`/order-charges/${id}`, body);

export const quoteCharges = (versionId) => get(`/versions/${versionId}/charges`, { fresh: true });
export const addQuoteCharge = (versionId, body) => post(`/versions/${versionId}/charges`, body);
export const changeQuotedCharge = (id, body) => put(`/quoted-charges/${id}`, body);

export const clientServiceLines = (clientId) => get(`/clients/${clientId}/service-lines`, { fresh: true });
export const saveClientServiceLines = (clientId, ids, reason) => put(`/clients/${clientId}/service-lines`, { ids, reason });
