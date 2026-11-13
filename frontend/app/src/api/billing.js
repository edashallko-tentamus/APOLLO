// Billing (I-1, migration 036; charges, payments and PO corrections 058): Ready to invoice, drafts, issued invoices,
// the QuickBooks queue, settings, an invoice and its actions, the order's billing card.
import { get, post, put } from './client.js';

const B = { invalidates: '/billing' };

// { rows, charges, can_issue }
export const billingReady = () => get('/billing/ready', { fresh: true });
export const claimWork = (tests, charges) => post('/billing/claim', { tests, charges }, B);
// tab: mine | drafts | queue -> { rows, me, can_issue, can_release_any }
export const billingInvoices = (tab) => get(`/billing/invoices?tab=${tab}`, { fresh: true });
export function listIssuedInvoices({ page, size, q, f }, { fresh = false } = {}) {
  const p = new URLSearchParams({ tab: 'issued', page: String(page), size: String(size) });
  if (q) p.set('q', q);
  if (f) p.set('f', f);
  return get(`/billing/invoices?${p}`, { fresh });
}
export const issueInvoices = (ids, signature) => post('/billing/issue', { ids, signature }, B);
export const releaseInvoice = (id, body = {}) => post(`/billing/invoices/${id}/release`, body, B);

export const billingSettings = () => get('/billing/settings', { fresh: true });
export const savePaymentTerms = (rows, reason) => post('/billing/settings/terms', { rows, reason }, B);
export const saveConnection = (body) => put('/billing/settings/connection', body, B);

// an invoice: { invoice, lines, credits, corrections, push, emails, me, can_issue, charge_items, samples }
export const getInvoice = (id) => get('/billing/invoices/' + id, { fresh: true });
export const updateInvoice = (id, body) => put('/billing/invoices/' + id, body, B);
export const removeLines = (lines) => post('/billing/lines/remove', { lines }, B);
export const setLinePrice = (lineId, body) => post(`/billing/lines/${lineId}/price`, body, B);
export const setLineRush = (lineId, body) => post(`/billing/lines/${lineId}/rush`, body, B);
export const addInvoiceCharge = (id, body) => post(`/billing/invoices/${id}/charges`, body, B);
export const recordPayment = (id, body) => post(`/billing/invoices/${id}/payment`, body, B);
export const correctPo = (id, body) => post(`/billing/invoices/${id}/correct-po`, body, B);
export const creditInvoice = (id, body) => post(`/billing/invoices/${id}/credit`, body, B);

export const orderBilling = (orderId) => get(`/orders/${orderId}/billing`, { fresh: true });

const sq = (siteId) => '?s=' + encodeURIComponent(siteId || '');
export const invoicePdfUrl = (id, siteId) => `/api/billing/invoices/${id}/pdf${sq(siteId)}`;
export const correctionPdfUrl = (id, siteId) => `/api/billing/corrections/${id}/pdf${sq(siteId)}`;
