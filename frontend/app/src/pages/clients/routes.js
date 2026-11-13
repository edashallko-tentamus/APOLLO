import { lazy } from 'react';

export default [
  { pattern: /^\/clients$/, page: lazy(() => import('./ClientsPage.jsx')) },
  { pattern: /^\/licenses/, page: lazy(() => import('./LicensesPage.jsx')) },
  { pattern: /^\/clients\/([\w-]+)$/, page: lazy(() => import('./ClientPage.jsx')) },
];
