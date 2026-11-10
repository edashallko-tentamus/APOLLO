// Who is signed in, the lab they are working in and what they may do there. Screens use can() only to show or hide
// actions: the backend and the database enforce the same permissions anyway.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authState, listUsers, logout, publicSettings } from '../api/auth.js';
import { onAuthRequired, setApiSite, clearCache } from '../api/client.js';
import { DEFAULT_PRODUCT_NAME, SITE_STORAGE_KEY } from '../config.js';
import { confirmLeave, forgetUnsaved } from '../router/useHashRoute.js';
import LoginScreen from './LoginScreen.jsx';

const SessionContext = createContext(null);
export const useSession = () => useContext(SessionContext);

const readSaved = (userId) => { try { return localStorage.getItem(SITE_STORAGE_KEY(userId)); } catch { return null; } };
const saveSite = (userId, id) => { try { localStorage.setItem(SITE_STORAGE_KEY(userId), id); } catch { /* storage blocked: fine */ } };

function pickSite(user, wanted) {
  const sites = user?.sites || [];
  const ok = (id) => id && sites.some((s) => s.id === id);
  return ok(wanted) ? wanted : ok(readSaved(user?.id)) ? readSaved(user.id) : sites[0]?.id || null;
}

export default function SessionProvider({ children }) {
  const [productName, setProductName] = useState(DEFAULT_PRODUCT_NAME);
  const [status, setStatus] = useState('loading'); // loading | signin | ready | error
  const [signIn, setSignIn] = useState(null);       // what the sign-in screen asks: { mode, message, username, setupUsers }
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(null);
  const [siteId, setSiteId] = useState(null);
  const [error, setError] = useState(null);

  const start = useCallback(async () => {
    setStatus('loading');
    try {
      const s = await authState();
      if (!s.user) {
        setSignIn(s.setupNeeded ? { mode: 'setup', setupUsers: s.setupUsers }
          : { mode: 'login', message: s.timedOut ? `Your session timed out after ${s.idleMinutes} minutes without activity. Sign in again.` : '' });
        return setStatus('signin');
      }
      if (s.user.must_change_password) { setSignIn({ mode: 'change' }); return setStatus('signin'); }
      const all = await listUsers({ fresh: true });
      const me = all.find((u) => u.id === s.user.id) || null;
      const site = pickSite(me, null);
      setApiSite(site);
      setUsers(all); setUserId(s.user.id); setSiteId(site); setSignIn(null); setStatus('ready');
    } catch (e) { setError(e); setStatus('error'); }
  }, []);

  useEffect(() => {
    let live = true;
    publicSettings().then((s) => { if (live && s.product_name) setProductName(s.product_name); }, () => { /* keep the default name */ });
    start();
    return () => { live = false; };
  }, [start]);

  useEffect(() => { document.title = `${productName} Sandbox`; }, [productName]);

  // The session ended while working: sign in over the page, so unsaved work on screen stays.
  const me = useMemo(() => users.find((u) => u.id === userId) || null, [users, userId]);
  useEffect(() => onAuthRequired((data) => {
    setSignIn((cur) => cur || (data.changePassword ? { mode: 'change', overlay: true } : { mode: 'login', overlay: true, message: data.error, username: me?.username }));
  }), [me]);

  const afterSignIn = useCallback(async () => {
    if (!signIn?.overlay) return start();
    const s = await authState();
    if (!s.user || s.user.id !== userId) { window.location.reload(); return; } // someone else: start fresh
    if (s.user.must_change_password) return setSignIn({ mode: 'change', overlay: true });
    setSignIn(null);
  }, [signIn, start, userId]);

  const setSite = useCallback((id) => {
    if (!me || id === siteId) return;
    saveSite(me.id, id); setApiSite(id); setSiteId(id);
  }, [me, siteId]);

  const signOut = useCallback(async () => {
    if (!(await confirmLeave())) return;
    forgetUnsaved();
    await logout().catch(() => { /* already signed out */ });
    clearCache(); window.location.hash = '#/'; window.location.reload();
  }, []);

  const refreshUsers = useCallback(async () => {
    const all = await listUsers({ fresh: true });
    setUsers(all);
    setSiteId((cur) => { const s = pickSite(all.find((u) => u.id === userId), cur); setApiSite(s); return s; });
  }, [userId]);

  const value = useMemo(() => {
    const site = me?.sites?.find((s) => s.id === siteId) || null;
    const perms = me?.access?.[siteId]?.perms || [];
    const can = (code) => !!me && (me.is_admin || perms.includes(code));
    return {
      productName, user: me, site, sites: me?.sites || [], groups: me?.access?.[siteId]?.groups || [],
      can, canAny: (codes) => codes.some(can), setSite, signOut, refreshUsers,
    };
  }, [productName, me, siteId, setSite, signOut, refreshUsers]);

  if (status === 'error') return <div className="card err" style={{ margin: 20 }}>Cannot reach the server: {error?.message}</div>;
  if (status === 'loading') return <div className="loading" style={{ margin: 20 }}>Loading…</div>;
  const login = signIn && <LoginScreen {...signIn} productName={productName} onDone={afterSignIn} />;
  if (status === 'signin') return login;
  return <SessionContext.Provider value={value}>{children}{login}</SessionContext.Provider>;
}
