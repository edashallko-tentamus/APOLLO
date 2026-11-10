// The address after # (as in the current app: #/orders?show=mine), so links people already share keep working.
// Leaving a page with unsaved changes asks first (an in-page dialog, never the browser's confirm()).
import { useEffect, useRef, useSyncExternalStore } from 'react';

let current = window.location.hash || '#/';
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

// ---------------------------------------------------------------- unsaved changes
const dirtyChecks = new Set();
let ask = null; // set by the shell: () => Promise<boolean>
export const setLeaveAsker = (fn) => { ask = fn; return () => { if (ask === fn) ask = null; }; };
const hasUnsaved = () => [...dirtyChecks].some((fn) => fn());

// true when nothing is unsaved, or the person chose to leave without saving
export async function confirmLeave() {
  if (!hasUnsaved()) return true;
  return ask ? ask() : true;
}

// After the person chose to leave (signing out reloads the page): no second warning from the browser
export const forgetUnsaved = () => dirtyChecks.clear();

// A page with edits registers here while they are unsaved. isDirty: true/false, or a function asked at the moment
// of leaving (use one when a save and a move to another page can happen before the page redraws)
export function useUnsavedChanges(isDirty) {
  const ref = useRef(isDirty); ref.current = isDirty;
  useEffect(() => {
    const check = () => (typeof ref.current === 'function' ? !!ref.current() : !!ref.current);
    dirtyChecks.add(check);
    return () => dirtyChecks.delete(check);
  }, []);
}

let asking = false;
window.addEventListener('hashchange', async () => {
  const target = window.location.hash || '#/';
  if (target === current) return;
  if (hasUnsaved()) {
    history.replaceState(null, '', current); // stay put while asking
    if (asking) return;
    asking = true;
    const leave = await confirmLeave();
    asking = false;
    if (!leave) return;
    history.replaceState(null, '', target);
  }
  current = target; notify();
});
window.addEventListener('beforeunload', (e) => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- the address
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => current;

export function useHashRoute() {
  const hash = useSyncExternalStore(subscribe, snapshot);
  const [path, q = ''] = hash.slice(1).split('?');
  return { hash, path: path || '/', query: q };
}

// Keep a page's own state (tab, search, page number) in the address without reopening the page
export function replaceHash(next) {
  if (next === current) return;
  current = next; history.replaceState(null, '', next);
}
