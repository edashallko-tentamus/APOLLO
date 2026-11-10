import { lazy } from 'react';

// more specific addresses first
export default [
  { pattern: /^\/stability\/quotes$/, page: lazy(() => import('./QuotesPage.jsx')) },
  { pattern: /^\/stability\/quotes\/([\w-]+)$/, page: lazy(() => import('./QuotePage.jsx')) },
  { pattern: /^\/stability\/setup$/, page: lazy(() => import('./SetupPage.jsx')) },
  { pattern: /^\/stability\/studies\/([\w-]+)$/, page: lazy(() => import('./StudyPage.jsx')) },
  { pattern: /^\/stability\/?(?:studies)?$/, page: lazy(() => import('./StudiesPage.jsx')) },
];
