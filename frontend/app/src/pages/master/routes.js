import { lazy } from 'react';

const Rush = lazy(() => import('./RushPage.jsx'));

export default [
  { pattern: /^\/start$/, page: lazy(() => import('./StartPage.jsx')) },
  { pattern: /^\/analytes$/, page: lazy(() => import('./AnalytesPage.jsx')) },
  { pattern: /^\/rush$/, page: Rush },
  { pattern: /^\/rush\/([\w-]+)$/, page: Rush },
  { pattern: /^\/audit$/, page: lazy(() => import('./AuditPage.jsx')) },
];
