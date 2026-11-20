import { lazy } from 'react';

export default [
  { pattern: /^\/admin\/report-templates$/, page: lazy(() => import('./ReportTemplatesPage.jsx')) },
  { pattern: /^\/admin\/report-templates\/([0-9a-f-]{36})$/, page: lazy(() => import('./ReportTemplatePage.jsx')) },
];
