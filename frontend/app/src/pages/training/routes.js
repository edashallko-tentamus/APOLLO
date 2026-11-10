import { lazy } from 'react';

export default [
  { pattern: /^\/training$/, page: lazy(() => import('./OverviewPage.jsx')) },
  { pattern: /^\/training\/people\/([\w-]+)$/, page: lazy(() => import('./PersonPage.jsx')) },
  { pattern: /^\/training\/attempts\/([\w-]+)$/, page: lazy(() => import('./AttemptPage.jsx')) },
];
