import { lazy } from 'react';

export default [
  { pattern: /^\/orders$/, page: lazy(() => import('./OrdersPage.jsx')) },
  { pattern: /^\/orders\/([\w-]+)$/, page: lazy(() => import('./OrderPage.jsx')) },
  { pattern: /^\/samples\/([\w-]+)$/, page: lazy(() => import('./SamplePage.jsx')) },
];
