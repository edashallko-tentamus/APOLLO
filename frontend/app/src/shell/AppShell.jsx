// Layout: header, menu and the page for the address. Pages load on first visit; a page's own errors stay inside it.
import { Suspense, useEffect, useState } from 'react';
import { Offcanvas } from 'react-bootstrap';
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
  const [menuOpen, setMenuOpen] = useState(false); // the menu panel on narrow screens

  useEffect(() => { window.scrollTo(0, 0); setMenuOpen(false); }, [path]);
  // each menu section has its own colour; the page wears its menu item's (app.css: body[data-sec])
  useEffect(() => { document.body.dataset.sec = activeMenuItem(hash)?.sec || 'home'; }, [hash]);

  return <>
    <Header onMenu={() => setMenuOpen(true)} />
    <div className="layout">
      {/* below 992 px the menu slides in from the left (the header's Menu button); wider, it sits beside the page */}
      <Offcanvas responsive="lg" placement="start" show={menuOpen} onHide={() => setMenuOpen(false)} className="navwrap" aria-label="Menu">
        <Offcanvas.Header closeButton><Offcanvas.Title>Menu</Offcanvas.Title></Offcanvas.Header>
        <Offcanvas.Body><Nav hash={hash} onPick={() => setMenuOpen(false)} /></Offcanvas.Body>
      </Offcanvas>
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
