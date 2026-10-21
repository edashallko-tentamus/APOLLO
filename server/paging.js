// Paged lists (0.35.0). A list route keeps its query; this wraps it so the screen gets one page at a time (50 rows by
// default, newest first), with the count of every filter tab, a search across chosen columns, and the exact record when
// the search is an ID typed or scanned (the screen then opens that record).
//
//   c.query: page (1, 2, ...), size (default 50, at most 200), q (search text), f (filter key)
//   opts:    sql + params (the list's own query; its columns are what the filters, search and order use)
//            filters: { key: 'SQL condition on the columns' }   (the first is the default)
//            search:  ['column', ...]   text matched anywhere (case ignored)
//            ids:     ['column', ...]   an exact match (case and spaces ignored) is returned as `exact`
//            order:   'ORDER BY clause on the columns'  (default: created_at DESC)
//            enrich:  async (rows) => rows   per-row extras worked out for the page only
//            findExact: async (q) => row   another ID leading to a record of the list (e.g. a sample ID on the orders list)
//            aggregate: 'sum(total) AS total, ...'   totals over every row matching the tab and search (returned as agg)
'use strict';

const MAX = 200;

async function page(c, o) {
  const q = String(c.query.q || '').trim();
  const size = Math.min(MAX, Math.max(1, parseInt(c.query.size, 10) || 50));
  const filters = o.filters || {};
  const keys = Object.keys(filters);
  const f = keys.includes(c.query.f) ? c.query.f : (o.filter && keys.includes(o.filter) ? o.filter : keys[0]);
  const params = [...(o.params || [])];
  const base = `WITH base AS (${o.sql})`;
  // the count of every tab, so the screen can show "Active 120 · Expired 4"
  let counts = {};
  if (keys.length) {
    counts = await c.db.one(`${base} SELECT ${keys.map((k, i) => `count(*) FILTER (WHERE ${filters[k]})::int AS "${i}"`).join(', ')} FROM base`, params);
    counts = Object.fromEntries(keys.map((k, i) => [k, counts ? counts[i] : 0]));
  }
  // the exact record for a scanned or typed ID (whatever tab it is on)
  let exact = null;
  if (q && (o.ids || []).length) {
    const n = params.length + 1;
    exact = await c.db.one(`${base} SELECT * FROM base WHERE ${o.ids.map((col) => `upper(replace(${col}::text, ' ', '')) = upper(replace($${n}, ' ', ''))`).join(' OR ')} LIMIT 1`, [...params, q]);
  }
  // another ID that leads to a record of this list (a sample ID on the orders list opens its order)
  if (q && !exact && o.findExact) exact = await o.findExact(q);
  const where = [];
  if (f && filters[f]) where.push(`(${filters[f]})`);
  if (q && (o.search || []).length) {
    params.push('%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%');
    where.push(`(${o.search.map((col) => `${col}::text ILIKE $${params.length}`).join(' OR ')})`);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (await c.db.one(`${base} SELECT count(*)::int AS n FROM base ${w}`, params)).n;
  const agg = o.aggregate ? await c.db.one(`${base} SELECT ${o.aggregate} FROM base ${w}`, params) : undefined;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(pages, Math.max(1, parseInt(c.query.page, 10) || 1));
  let rows = await c.db.rows(`${base} SELECT * FROM base ${w} ${o.order || 'ORDER BY created_at DESC'} LIMIT ${size} OFFSET ${(p - 1) * size}`, params);
  if (o.enrich) rows = await o.enrich(rows);
  return { rows, total, page: p, pages, size, filter: f, counts, q, exact, agg };
}

// true when the screen asked for a page (old callers, scripts and tests that want the whole list keep getting an array)
const wantsPage = (c) => c.query.page !== undefined;

module.exports = { page, wantsPage };
