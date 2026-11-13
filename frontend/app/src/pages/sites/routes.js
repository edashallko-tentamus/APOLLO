import { lazy } from 'react';

const Sites = lazy(() => import('./SitesPage.jsx'));

export default [
  { pattern: /^\/admin\/sites$/, page: Sites },
  { pattern: /^\/admin\/sites\/([\w-]+)$/, page: Sites },
  { pattern: /^\/sites$/, page: Sites }, // old address
];
