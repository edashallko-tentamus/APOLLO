import { lazy } from 'react';

export default [
  { pattern: /^\/billing$/, page: lazy(() => import('./BillingPage.jsx')) },
  { pattern: /^\/billing\/invoices\/([\w-]+)$/, page: lazy(() => import('./InvoicePage.jsx')) },
];
