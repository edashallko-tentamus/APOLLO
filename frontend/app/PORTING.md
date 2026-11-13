# Moving a screen from `public/js/pages` to React

The current screens (`frontend/public/js/pages/*.js`) are the specification: same addresses, same columns, same buttons,
same permissions, same API calls, same wording. Port behaviour faithfully; do not redesign. The backend is the source of
truth: never move a business rule into the screen beyond what the old screen already did (hiding buttons with `can()`,
simple field checks).

## Where things go

| What | Where |
|---|---|
| An area's screens | `src/pages/<area>/<Name>Page.jsx` (one component per screen; split big screens into parts in the same folder) |
| Its addresses | `src/pages/<area>/routes.js`: `export default [{ pattern: /^\/clients\/([\w-]+)$/, page: lazy(() => import('./ClientPage.jsx')) }]`. Patterns are the old `ROUTES` in `public/js/main.js` without the `#`. Picked up automatically. |
| Its API calls | `src/api/<area>.js`: small named functions over `get`, `post`, `put` from `src/api/client.js`. No `fetch` anywhere else. |
| Its styles | `src/pages/<area>/<area>.css`, imported by its pages (copy the old page's injected `css.textContent`) |
| Parts other areas will use (cards, dialogs) | export them from the area folder and say so in your report |

## The old helpers and their React equivalents

| Old (`app.js`, `common.js`) | React |
|---|---|
| `api(path)` / `api(path, { method: 'POST', body })` / `'PUT'` | `get(path, { fresh })`, `post(path, body, { invalidates })`, `put(...)` in `src/api/client.js`, wrapped in `src/api/<area>.js`. GETs are cached 30 s: pass `{ fresh: true }` after a change, or `invalidates: '/prefix'` on the change. |
| Loading in a page | `const { data, error, loading, reload } = useApi(() => fn(args), [args])` (`src/hooks/useApi.js`). `reload()` asks the backend again. |
| `pageHeader(title, subtitle, actions, audit)` | `<PageHeader title subtitle actions audit={{ kind, id }} />` (`components/PageHeader.jsx`). Every page keeps its audit scope. |
| `section(title, help, actions)` + card | `<Section title help actions>…</Section>` (`components/Section.jsx`) |
| `badge(status)` | `<Badge status={…} />` |
| `money(v)`, `fmt` | `money`, `pct`, `dateTime`, `dateOnly`, `plural` in `src/lib/format.js` |
| `link(href, text)` | `<a href={href}>{text}</a>`. Every ID is a link. |
| `esc(…)` | not needed: React escapes text. Never put data into `dangerouslySetInnerHTML`. |
| `toast(msg, 'err')` | `const toast = useToast(); toast(msg, 'err')` (`components/Toasts.jsx`) |
| `await modal({ title, intro, fields, okText, html, after, wide })` | `const dialogs = useDialogs(); await dialogs.form({ title, intro, fields, okText, before, after, wide, submit })` (`components/dialogs/DialogProvider.jsx`). Same `fields` format; `select` fields are smart dropdowns. `submit(values)` runs while the dialog is open (errors show in it). |
| `await signDialog({ title, what, meaning, needReason, sign, submit })` | `await dialogs.sign({ … })` (same options; the module for canned reasons comes from the address) |
| `await askReason(what)` | `await dialogs.reason(what)` (text or null) |
| `await confirmBox(title, text, ok)` | `await dialogs.confirm(title, text, ok)` |
| custom dialog HTML | `await dialogs.open((done) => <MyDialog onDone={done} />)`; build it on `components/Modal.jsx` |
| `contextMenu(x, y, [[label, fn]])` | `dialogs.menu(event, [{ label, onClick, disabled }])` |
| `new Grid(el, opts)` (read only) | `const grid = useGrid({ rows, columns, readOnly: true }); <DataGrid grid={grid} search … />` (`components/grid/`). Same column format (`field, title, type, width, href, links, compute, format, options, editable, required, validate, help, assign, onClick, label, cellClass`). `detail: { open, key, render(row) → JSX }` for panels under rows; `onContextMenu(e, selectedRows)`. Call `grid.reset(newRows)` when rows reload. |
| a read-only list whose rows load or reload | `<ReadGrid rows={data?.rows} columns={…} search onRowOpen … />` (`components/grid/ReadGrid.jsx`) |
| adding rows with values (e.g. tests picked in a dialog) | `grid.act.addRows([{ …row }, …])` (each starts from `newRow()`); `addRows(n)` adds n empty rows |
| a file download (Excel, PDF) | `download(path, { method, body, name })` in `src/api/client.js` (sends the lab like every call) |
| a wide dialog | `<Modal wide>` (760 px) or `<Modal xwide>` (1100 px) |
| a file in a dialog (`modal({ collect })`) | a field `{ name, label, type: 'file', accept }`: the dialog gives back the chosen `File` (or null) |
| `editableGrid({ … })` | `<EditableGrid rows columns allowAdd newRow what sign needReason autosave save afterSave apiRef detail onContextMenu … />` (`components/EditableGrid.jsx`). `save(rows, reason, signature)` returns the API promise. `apiRef.current.selectedRows()`. |
| `pagedList({ url, filters, render, open })` | `<PagedList load={(params, opts) => api.list(params, opts)} query={query} filters={…} open={(row) => …}>{(rows, data, reload) => …}</PagedList>` |
| `can(code)`, `canAny`, `currentUser()`, `currentSite()`, `myGroups()` | `const { can, canAny, user, site, groups, refreshUsers } = useSession()` |
| `state.meta` | `const meta = useMeta()` (`src/hooks/useMeta.js`; undefined until loaded) |
| `state.query.get('x')` | the page gets `query` (the text after `?`) and `params` (the address's captured parts): `new URLSearchParams(query).get('x')` |
| `location.hash = '#/x'` | the same (or a plain `<a href="#/x">`) |
| `setDirtyCheck(fn)` | `useUnsavedChanges(isDirty)` (`src/router/useHashRoute.js`); EditableGrid does it for you |
| `enhanceAll` / native `<select>` | `<SmartSelect value options={[{ value, label }]} onChange />` for every pick list |
| `hooks.refreshUsers()` | `refreshUsers()` from `useSession()` |

## Rules (standing requirements)

- Every list or data entry uses DataGrid / EditableGrid (fill down, Excel paste, multi-select). Every pick list is a smart dropdown. Every ID is a link. Every page has its audit scope.
- Permissions: show and hide with `can()` exactly as the old screen did.
- Never `alert()`, `confirm()`, `prompt()`, inline `<script>`, `eval()` or `Function()` (the security policy blocks them).
- Function components and hooks only. Keep state local. Columns, filters and other constants at module level or in `useMemo`, so grids are not redrawn for nothing. No `useEffect` for values that can be worked out while drawing.
- One request per user action; no request loops. Prevent double submission (disable the button while saving).
- Loading, error and empty states on every page.
- No new npm packages. Plain CSS. No CSS framework.
- Something the old screen did that you cannot port yet (it needs another area that is not moved): keep the button, open the old screen at `'/' + hash` (the current app), and mark it `// shortcut: <what>, <when to replace>`.

## Checking your work

`npm test` (grid rules) and `npx vite build` must pass. While other areas are being written at the same time, a build error in another area's folder is not yours: check your own files compile with
`npx esbuild src/pages/<area>/*.jsx src/api/<area>.js --bundle --format=esm --outdir=node_modules/.check-<area> --jsx=automatic --loader:.js=jsx --external:react --external:react-dom --log-level=warning`
(it also checks that your imports resolve; `node_modules` is not in Git).
