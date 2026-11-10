import { lazy } from 'react';

export default [
  { pattern: /^\/intake$/, page: lazy(() => import('./IntakeDashboardPage.jsx')) },
  { pattern: /^\/outbox$/, page: lazy(() => import('./OutboxPage.jsx')) },
];
