import { lazy } from 'react';

// review and entries before /logbooks/:id (first match wins)
export default [
  { pattern: /^\/logbooks$/, page: lazy(() => import('./LogbooksPage.jsx')) },
  { pattern: /^\/logbooks\/review$/, page: lazy(() => import('./ReviewPage.jsx')) },
  { pattern: /^\/logbooks\/entries\/([\w-]+)$/, page: lazy(() => import('./EntryPage.jsx')) },
  { pattern: /^\/logbooks\/([\w-]+)$/, page: lazy(() => import('./LogbookPage.jsx')) },
];
