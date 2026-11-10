import { lazy } from 'react';

export default [
  { pattern: /^\/quotes$/, page: lazy(() => import('./QuotesPage.jsx')) },
  { pattern: /^\/quotes\/([\w-]+)$/, page: lazy(() => import('./QuoteOpenPage.jsx')) },
];
