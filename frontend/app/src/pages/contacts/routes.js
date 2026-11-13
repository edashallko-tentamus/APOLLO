import { lazy } from 'react';

export default [
  { pattern: /^\/contacts$/, page: lazy(() => import('./ContactsPage.jsx')) },
];
