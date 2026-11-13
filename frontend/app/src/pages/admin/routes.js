import { lazy } from 'react';

export default [
  { pattern: /^\/admin\/users$/, page: lazy(() => import('./UsersPage.jsx')) },
  { pattern: /^\/admin\/matrices$/, page: lazy(() => import('./MatricesPage.jsx')) },
  { pattern: /^\/admin\/reasons$/, page: lazy(() => import('./ReasonsPage.jsx')) },
];
