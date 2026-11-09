// The one place the React screens talk to the backend. Every call goes to /api on this same address:
// the person comes from the session cookie, the lab being worked in from the x-site-id header.
import { API_BASE, SITE_HEADER, GET_CACHE_MS } from '../config.js';

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.name = 'ApiError'; this.status = status; this.data = data; }
}

let siteId = '';
export function setApiSite(id) { if ((id || '') !== siteId) { siteId = id || ''; clearCache(); } } // a lab's answers never serve another lab

// The session ended (timed out, signed out elsewhere, temporary password): the session provider shows the sign-in screen
const authListeners = new Set();
export function onAuthRequired(fn) { authListeners.add(fn); return () => authListeners.delete(fn); }

async function send(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', [SITE_HEADER]: siteId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the LIMS. Check your connection and try again.', 0, null);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data.signIn || data.changePassword)) authListeners.forEach((fn) => fn(data));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  return data;
}

// GETs: one request in flight per address (callers asking at the same time share it), answers kept for GET_CACHE_MS
const cache = new Map(); // path -> { at, promise }
export function get(path, { fresh = false } = {}) {
  const hit = cache.get(path);
  if (!fresh && hit && Date.now() - hit.at < GET_CACHE_MS) return hit.promise;
  const promise = send(path);
  cache.set(path, { at: Date.now(), promise });
  promise.catch(() => { if (cache.get(path)?.promise === promise) cache.delete(path); }); // never keep a failure
  return promise;
}

// Changes: never cached, and they drop the cached answers they make stale (all of them unless a prefix is given)
export async function post(path, body, { invalidates } = {}) { const d = await send(path, { method: 'POST', body: body ?? {} }); clearCache(invalidates); return d; }
export async function put(path, body, { invalidates } = {}) { const d = await send(path, { method: 'PUT', body: body ?? {} }); clearCache(invalidates); return d; }

export function clearCache(prefix) {
  if (!prefix) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}
