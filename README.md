# APOLLO

**APOLLO** is the in-house Laboratory Information Management System (LIMS3) being built for Tentamus North America. This repository is the **Sandbox** build: a working prototype with fictional demo data, used to design and try every module before it is promoted under change control through Test/Validation to Production (first lab: CFL).

**Status:** version **0.36.0** (2026-10-21). It passes its automated tests (1898 database rule tests and 41 browser test suites). It has **not** been validated and is not for GxP use. Validation follows GAMP 5 Category 5, module by module (URS, FS, RTM, risk assessment, IQ/OQ/PQ).

## What it does

| Area | Modules |
|---|---|
| Clients and pricing | Clients and contacts (roles per client, licenses), test catalogue with pricing and turnaround, rush fee schedules, projects, standalone quotes, stability quotes, test packages and dated price changes, discounts by %, miscellaneous charges, service lines |
| Intake | Lab orders and samples (grid entry, paste from Excel), the test picker (service line > type > department, any test at list price), chain of custody and signed receipt, receipt photos, rush approvals, due dates on each lab's calendar, labels (Dymo, Code 128), the Outbox |
| Testing | Workflow Designer (tests built as signed, versioned workflows), workflow verification (automated runs with a URS/FRS report), backlog and batches, bench steps (weighing, dilution, readings, incubation, plating), analytical runs, QC Review, preliminary results, OOS investigations and retests, training and competency |
| Reports | Report Finalization, the Certificate of Analysis (PDF, report templates, QR verification), stability studies and reports |
| Lab supplies | Inventory (lots, mixtures, QA testing before use, waste classifications), purchasing and receiving, vendor approvals (local and corporate), equipment (calibration, tag-out, release), electronic logbooks, the sensor feed (iMonnit) |
| Oversight | Invoicing (QuickBooks Online queue, credit notes, payment status), dashboards (Home, GM, Executive, finance figures, performance report to Excel), trending and control charts, the audit trail, permissions through lab groups, electronic signatures |

The business rules live in the Java backend (`backend/`); the database keeps the structure and the GxP backstop. See `backend/README.md` and `frontend/README.md`. Every regulated table has an append-only audit trail; changes need a reason, and signed actions need the user's password.

## Run it

Needs a PostgreSQL 16 server, Java 21 with Maven (the backend) and Node.js 20.12 or later (the front end and the browser tests). The app connects to databases that already exist; it never creates a database. At every start the backend's migrations make whatever tables, rules and demo data are missing.

1. Create the account and the two databases once, as the `postgres` superuser:
   ```
   psql -h localhost -U postgres -v pw='<choose one>' -f backend/db/create_database.sql
   ```
   This makes `lims3` (the app's data) and `lims3_test` (emptied by every `npm test` run), both empty.
2. Copy `backend/.env.example` to `backend/.env` (never committed) and put the same password in `DATABASE_URL` and `LIMS_TEST_DATABASE_URL`. Every command, the front end included, reads `backend/.env`.
3. Start the app with two commands, each in its own terminal, then open http://localhost:3000:
   ```
   npm run start:backend   # the backend (Java, in backend/): the JSON API on 127.0.0.1:3001
   npm start               # the front end: the screens on port 3000, /api forwarded to the backend
   ```
4. Other commands (both run by the Java backend):
   ```
   npm test        # empties lims3_test, applies every migration there and runs every rule test
   npm run reset   # empties lims3 (every record is lost); the next start rebuilds it with demo data
   ```

There is no Node backend. The front end (`frontend/server.js`) only serves the screens and forwards every `/api/...` request unchanged to `LIMS_API_URL` (default `http://127.0.0.1:3001`; the backend's port is `LIMS_API_PORT`), so the browser sees one address. Keep `PORT` the same for both (links in emails and PDFs, and the verification screenshots, use it).

On first start the system administrator sets their own password. The browser tests (`npm run test:browser` and the other `test:*` scripts) need Playwright and run against a freshly reset database.

No PostgreSQL server yet? With Docker: `docker run -d --name apollo-pg --restart unless-stopped -e POSTGRES_PASSWORD=<choose one> -p 127.0.0.1:5432:5432 -v apollo-pgdata:/var/lib/postgresql/data postgres:16`, then step 1 with that password for `postgres`.

For a server holding GxP data use `backend/db/roles_setup.sql` instead (separate owner and app accounts, `LIMS_MIGRATE_URL`).

On a Windows laptop the simplest way is the Claude desktop app's Code tab: open this folder and ask Claude to read `CLAUDE.md`, set up, start the app and run the tests.

## Where things are

| Path | What |
|---|---|
| `backend/db/migrations/` | The schema and every rule, one numbered migration per change |
| `backend/db/seed*.sql` | Fictional demo data |
| `backend/db/tests/` | Database rule tests |
| `backend/` | The backend (Java, Spring Boot): the JSON API, PDFs, Excel, the sensor feed, the rule tests |
| `frontend/public/` | The screens (plain HTML, CSS and JavaScript modules, no build step) |
| `frontend/server.js` | The front-end server: the screens, and `/api` forwarded to the backend |
| `backend/.env` | The backend's settings (copy `backend/.env.example`); the front end reads its `PORT` and `LIMS_API_URL` |
| `tests/` | Browser tests (Playwright), run against the front end on port 3000 |
| `docs/LIMS3 Design and Build Log.md` | Every version: what changed, why, how it was checked |
| `docs/ontology_vault/` | The design (Obsidian vault): business objects, rules, workflows and every decision (`08 Decisions`) |
| `docs/project_docs/` | Other project documents (scale test, demo scripts) |
| `CLAUDE.md` | Working instructions for Claude, with the detail of each slice |

## How it is built

Alex Kiddle (LIMS Director, Tentamus North America) designs each slice and decides; Claude builds it, with Claude in the cloud and Claude Code on the laptop working on the same project. Each slice is designed first, recorded as decision notes in the vault, built as a migration with its screens and tests, checked on a fresh database and on a copy of the working data, then applied on Alex's go. Git history in this repository starts at version 0.33.0 (2026-10-20); earlier versions are recorded in the build log.
