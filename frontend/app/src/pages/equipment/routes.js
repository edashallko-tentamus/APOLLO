import { lazy } from 'react';

const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const lists = () => import('./ListPages.jsx');

// more specific addresses first
export default [
  { pattern: /^\/equipment$/, page: named(lists, 'RegisterPage') },
  { pattern: /^\/equipment\/due$/, page: named(lists, 'DuePage') },
  { pattern: /^\/equipment\/lists$/, page: named(lists, 'TypesDeptsPage') },
  { pattern: /^\/equipment\/new$/, page: lazy(() => import('./FormPage.jsx')) },
  { pattern: /^\/equipment\/add$/, page: lazy(() => import('./AddManyPage.jsx')) },
  { pattern: /^\/equipment\/([\w-]+)\/edit$/, page: lazy(() => import('./FormPage.jsx')) },
  { pattern: /^\/equipment\/([\w-]+)$/, page: lazy(() => import('./EquipmentPage.jsx')) },
];
