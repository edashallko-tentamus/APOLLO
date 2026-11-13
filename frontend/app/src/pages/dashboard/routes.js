import { lazy } from 'react';

const board = (name) => lazy(() => import('./Board.jsx').then((m) => ({ default: m[name] })));
export default [
  { pattern: /^\/dashboard\/gm$/, page: board('GmBoard') },
  { pattern: /^\/dashboard\/executive$/, page: board('ExecutiveBoard') },
  { pattern: /^\/dashboard\/finance$/, page: lazy(() => import('./FinancePage.jsx')) },
  { pattern: /^\/admin\/dashboard-widgets$/, page: lazy(() => import('./WidgetsAdminPage.jsx')) },
];
