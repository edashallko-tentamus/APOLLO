import { lazy } from 'react';

const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const lists = () => import('./ListPages.jsx');

// #/oos/config before #/oos/:id
export default [
  { pattern: /^\/oos$/, page: named(lists, 'OosListPage') },
  { pattern: /^\/oos\/config$/, page: named(lists, 'OosConfigPage') },
  { pattern: /^\/oos\/([\w-]+)$/, page: lazy(() => import('./OosPage.jsx')) },
];
