# APOLLO front end

The LIMS3 screens: plain HTML, CSS and JavaScript modules, with no build step and no npm packages. `server.js` serves them on port 3000 and passes every `/api/...` request on to the backend (`../backend`) unchanged, so the browser sees one address (one sign-in cookie, one security policy).

## Run it

The backend must be running first (`npm run start:backend`; see `../backend/README.md`). Then, from the project folder:

```
npm start
```

and open http://localhost:3000. The first time, the system administrator sets their own password on the setup screen.

Settings are read from `backend/.env`, so both programs agree: `PORT` (the screens, default 3000) and `LIMS_API_URL` (the backend, default http://127.0.0.1:3001). If the backend is not running, every screen says so.

## Folders

| Path | What |
|---|---|
| `server.js` | Serves the screens, sets the security headers for pages, forwards `/api` |
| `public/index.html` | The app's single page |
| `public/js/main.js` | The menu and the page router |
| `public/js/app.js` | Shared helpers: dialogs, the signature dialog, links, permissions (`can()`) |
| `public/js/grid.js` | The spreadsheet grid used for every list and data entry |
| `public/js/combo.js` | The smart dropdown applied to every pick list |
| `public/js/pages/*.js` | One file per area (orders, testing, inventory, reports, ...) |
| `public/*.html`, `public/js/public/` | The pages clients open without signing in (verify a COA, answer a quote or an OOS) |
| `public/css/app.css` | The styles (also used by the React screens for now) |
| `app/` | The React screens being moved over (Vite build, own `package.json`); served at `/app/` after `npm run build:app` |

### React screens (`app/`)

Build them once with `npm run build:app` (from the project folder), then `npm start` serves them at http://localhost:3000/app/. Screens not moved yet open in the current app from the menu, with the same sign-in. For quick changes, `npm run dev:app` serves them on http://localhost:5173 with `/api` forwarded to the backend.

## Rules for changing it (standing requirements)

- Every grid where data is listed or entered supports fill down (Ctrl+D), copy and paste to and from Excel, and multi-cell selection: use `grid.js` / `editableGrid`.
- Every pick list is a smart dropdown, every ID is a link to its record, and every page has the audit-trail icon next to its title.
- Show or hide screens and buttons with `can()`; the backend enforces the same permission anyway.
- Never use `alert()`, `confirm()` or `prompt()` (the embedded browser blocks them); use the in-page dialogs.
- No inline `<script>`, `onclick=` attributes, `eval()` or `Function()`: the security policy blocks them.
- Escape any data before putting it into HTML.

## Browser tests

The Playwright suites in `../tests` (`npm run test:browser` and the other `test:*` scripts) run against http://localhost:3000 on a freshly reset database.
