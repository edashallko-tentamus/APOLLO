// Shared settings for the React screens. Nothing secret belongs here: everything in this folder reaches the browser.

export const API_BASE = '/api';
export const SITE_HEADER = 'x-site-id';
// The screens not yet moved to React still run at the old address; their menu links open there (same sign-in).
export const LEGACY_BASE = '/';
export const SITE_STORAGE_KEY = (userId) => `lims3.site.${userId}`;
export const DEFAULT_PRODUCT_NAME = 'LIMS3';
export const ENV_LABEL = 'Sandbox · demo data · not for GxP use';
// How long a GET answer is reused before asking the backend again
export const GET_CACHE_MS = 30_000;
export const TOAST_MS = { ok: 3500, err: 7000 };
export const PASSWORD_RULE = 'At least 10 characters, with a letter and a number, and not containing your user ID.';
