import { lazy } from 'react';

// more specific addresses first
export default [
  { pattern: /^\/purchasing$/, page: lazy(() => import('./RequestsPage.jsx')) },
  { pattern: /^\/purchasing\/requests\/([\w-]+)$/, page: lazy(() => import('./RequestPage.jsx')) },
  { pattern: /^\/purchasing\/receive$/, page: lazy(() => import('./ReceivePage.jsx')) },
  { pattern: /^\/purchasing\/orders\/([\w-]+)$/, page: lazy(() => import('./OrderPage.jsx')) },
  { pattern: /^\/purchasing\/orders$/, page: lazy(() => import('./OrdersPage.jsx')) },
  { pattern: /^\/purchasing\/suppliers\/([\w-]+)$/, page: lazy(() => import('./SupplierPage.jsx')) },
  { pattern: /^\/purchasing\/(?:suppliers|vendors)$/, page: lazy(() => import('./SuppliersPage.jsx')) },
  { pattern: /^\/purchasing\/risk-classes$/, page: lazy(() => import('./RiskClassesPage.jsx')) },
  { pattern: /^\/purchasing\/settings$/, page: lazy(() => import('./SettingsPage.jsx')) },
];
