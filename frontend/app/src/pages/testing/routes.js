import { lazy } from 'react';

export default [
  { pattern: /^\/testing$/, page: lazy(() => import('./BacklogPage.jsx')) },
  { pattern: /^\/testing\/batches$/, page: lazy(() => import('./BatchesPage.jsx')) },
  { pattern: /^\/testing\/batches\/([\w-]+)$/, page: lazy(() => import('./BatchPage.jsx')) },
];
