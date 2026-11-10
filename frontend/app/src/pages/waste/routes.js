import { lazy } from 'react';

export default [
  { pattern: /^\/admin\/waste$/, page: lazy(() => import('./WastePage.jsx')) },
];
