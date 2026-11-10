import { lazy } from 'react';

export default [
  { pattern: /^\/trending$/, page: lazy(() => import('./WatchPage.jsx')) },
  { pattern: /^\/trending\/build$/, page: lazy(() => import('./BuilderPage.jsx')) },
  { pattern: /^\/trending\/charts$/, page: lazy(() => import('./ChartsPage.jsx')) },
  { pattern: /^\/trending\/charts\/([\w-]+)$/, page: lazy(() => import('./ChartPage.jsx')) },
  { pattern: /^\/trending\/reports$/, page: lazy(() => import('./ReportsPage.jsx')) },
];
