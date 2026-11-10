import { lazy } from 'react';

// the package editor's address must come before the test editor's
export default [
  { pattern: /^\/catalog$/, page: lazy(() => import('./CatalogPage.jsx')) },
  { pattern: /^\/catalog\/packages\/([\w-]+)$/, page: lazy(() => import('./PackageEditorPage.jsx')) },
  { pattern: /^\/catalog\/([\w-]+)$/, page: lazy(() => import('./CatalogEditorPage.jsx')) },
];
