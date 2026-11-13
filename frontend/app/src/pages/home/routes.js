import { lazy } from 'react';

export default [
  { pattern: /^\/$/, page: lazy(() => import('./HomePage.jsx')) },
];
