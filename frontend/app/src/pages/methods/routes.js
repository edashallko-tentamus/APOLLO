import { lazy } from 'react';

export default [
  { pattern: /^\/methods$/, page: lazy(() => import('./TestsListPage.jsx')) },
  { pattern: /^\/methods\/sops$/, page: lazy(() => import('./SopsPage.jsx')) },
  { pattern: /^\/methods\/tests\/([\w-]+)$/, page: lazy(() => import('./TestPage.jsx')) },
  { pattern: /^\/methods\/versions\/([\w-]+)$/, page: lazy(() => import('./DesignerPage.jsx')) },
];
