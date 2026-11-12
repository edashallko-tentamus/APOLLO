// Layout: header, menu and the page for the address. Pages load on first visit; a page's own errors stay inside it.
import { Suspense, useEffect } from 'react';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { matchRoute } from '../router/routes.js';
import { useHashRoute } from '../router/useHashRoute.js';
import { useSession } from '../session/SessionProvider.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';
import Header from './Header.jsx';
import LeaveConfirm from './LeaveConfirm.jsx';
import Nav, { activeMenuItem } from './Nav.jsx';

export default function AppShell() {
  const { hash, path, query } = useHashRoute();
  const { site } = useSession();
  const match = matchRoute(path);

  useEffect(() => { window.scrollTo(0, 0); }, [path]);
  // each menu section has its own colour; the page wears its menu item's (app.css: body[data-sec])
  useEffect(() => { document.body.dataset.sec = activeMenuItem(hash)?.sec || 'home'; }, [hash]);

  return <>
    <Header />
    <div className="layout">
      <Nav hash={hash} />
      <main id="main">
        {/* a new lab or page starts afresh: nothing from the old one carries over (a page's own ?tab=… does not reopen it) */}
        <ErrorBoundary key={`${site?.id}|${path}`}>
          <Suspense fallback={<div className="loading">Loading…</div>}>
            {match ? <match.Page params={match.params} query={query} /> : <NotFoundPage />}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
    <LeaveConfirm />
  </>;
}
