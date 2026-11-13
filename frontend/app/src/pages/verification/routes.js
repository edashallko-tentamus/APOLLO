import { lazy } from 'react';

export default [
  { pattern: /^\/verification\/([\w-]+)$/, page: lazy(() => import('./VerificationPage.jsx')) },
];
