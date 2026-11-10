// Search everything in the lab: { q, results: [{ kind, code, title, sub, href }], exact }
import { get } from './client.js';

export const searchAll = (q) => get('/search?q=' + encodeURIComponent(q), { fresh: true });
