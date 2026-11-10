import { lazy } from 'react';

export default [
  { pattern: /^\/reports\/finalization$/, page: lazy(() => import('./QueuePage.jsx')) },
  { pattern: /^\/reports\/review$/, page: lazy(() => import('./ReviewPage.jsx')) },
];
