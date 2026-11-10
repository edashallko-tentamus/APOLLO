import { lazy } from 'react';

export default [
  { pattern: /^\/sensors$/, page: lazy(() => import('./SensorsPage.jsx')) },
];
