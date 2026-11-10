import { lazy } from 'react';

export default [
  { pattern: /^\/projects$/, page: lazy(() => import('./ProjectsPage.jsx')) },
  { pattern: /^\/projects\/([\w-]+)$/, page: lazy(() => import('./ProjectPage.jsx')) },
  { pattern: /^\/quote\/([\w-]+)$/, page: lazy(() => import('./VersionPage.jsx')) },
  { pattern: /^\/print\/([\w-]+)$/, page: lazy(() => import('./PrintPage.jsx')) },
];
