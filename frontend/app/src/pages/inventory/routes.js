import { lazy } from 'react';

const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const lists = () => import('./ListsPages.jsx');
const units = () => import('./UnitsPages.jsx');

// more specific addresses first
export default [
  { pattern: /^\/inventory$/, page: lazy(() => import('./LotsPage.jsx')) },
  { pattern: /^\/inventory\/lots\/([\w-]+)\/edit$/, page: lazy(() => import('./ItemPage.jsx')) },
  { pattern: /^\/inventory\/lots\/([\w-]+)$/, page: lazy(() => import('./LotPage.jsx')) },
  { pattern: /^\/inventory\/new$/, page: lazy(() => import('./ItemPage.jsx')) },
  { pattern: /^\/inventory\/mixture$/, page: lazy(() => import('./MixturePage.jsx')) },
  { pattern: /^\/inventory\/receive$/, page: lazy(() => import('./ReceiveManyPage.jsx')) },
  { pattern: /^\/inventory\/samples$/, page: lazy(() => import('./SampleStoragePage.jsx')) },
  { pattern: /^\/inventory\/suppliers$/, page: named(lists, 'SuppliersPage') },
  { pattern: /^\/inventory\/locations\/([\w-]+)$/, page: lazy(() => import('./LocationPage.jsx')) },
  { pattern: /^\/inventory\/locations$/, page: named(lists, 'LocationsPage') },
  { pattern: /^\/inventory\/thresholds$/, page: named(lists, 'ThresholdsPage') },
  { pattern: /^\/inventory\/qa-testing$/, page: lazy(() => import('./QaTestingPage.jsx')) },
  { pattern: /^\/admin\/units$/, page: named(units, 'UnitsPage') },
  { pattern: /^\/admin\/conversions$/, page: named(units, 'ConversionsPage') },
];
