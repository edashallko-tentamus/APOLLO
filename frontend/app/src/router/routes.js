// Screens moved to React. Each loads only when first opened (its own file in the build).
// An address not listed here is a screen still in the current app: the shell offers a link to it there.
import { lazy } from 'react';

const Home = lazy(() => import('../pages/home/HomePage.jsx'));
const Contacts = lazy(() => import('../pages/contacts/ContactsPage.jsx'));

export const ROUTES = [
  { pattern: /^\/$/, page: Home },
  { pattern: /^\/contacts$/, page: Contacts },
];

export function matchRoute(path) {
  for (const r of ROUTES) {
    const m = path.match(r.pattern);
    if (m) return { Page: r.page, params: m.slice(1) };
  }
  return null;
}

// Is a menu address (#/x?y) served by React?
export const isMoved = (href) => !!matchRoute(href.slice(1).split('?')[0] || '/');
