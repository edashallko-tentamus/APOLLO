import { lazy } from 'react';

export default [
  { pattern: /^\/admin\/report-templates$/, page: lazy(() => import('./ReportTemplatesPage.jsx')) },
];
