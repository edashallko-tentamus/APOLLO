// Screens moved to React. Each area lists its own addresses in src/pages/<area>/routes.js:
//   import { lazy } from 'react';
//   export default [{ pattern: /^\/clients$/, page: lazy(() => import('./ClientsPage.jsx')) }, ...];
// Each page loads only when first opened (its own file in the build). An address no area lists shows "Page not found".
const areas = import.meta.glob('../pages/*/routes.js', { eager: true });

export const ROUTES = Object.values(areas).flatMap((m) => m.default);

export function matchRoute(path) {
  for (const r of ROUTES) {
    const m = path.match(r.pattern);
    if (m) return { Page: r.page, params: m.slice(1) };
  }
  return null;
}
