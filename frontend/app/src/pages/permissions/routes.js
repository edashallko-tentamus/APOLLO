import { lazy } from 'react';

const Groups = lazy(() => import('./GroupsPage.jsx'));

export default [
  { pattern: /^\/admin\/roles$/, page: Groups }, // old address (Job roles were replaced by groups)
  { pattern: /^\/admin\/groups$/, page: Groups },
  { pattern: /^\/admin\/permissions$/, page: lazy(() => import('./MatrixPage.jsx')) },
];
