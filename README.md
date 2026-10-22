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

Every business rule lives in the database (PostgreSQL constraints, triggers and functions), so no screen, script or integration can bypass it. Every regulated table has an append-only audit trail; changes need a reason, and signed actions need the user's password.

## Run it

Needs Node.js 18 or later. No other software: the database is embedded (PGlite).

```
npm install      # the embedded database package
npm test         # builds a fresh database and runs every rule test
npm start        # then open http://localhost:3000
npm run reset    # deletes the local database; the next start rebuilds it with demo data
```

On first start the system administrator sets their own password. To use a PostgreSQL server instead, set `DATABASE_URL`. The browser tests (`npm run test:browser` and the other `test:*` scripts) need Playwright and run against a fresh database.

On a Windows laptop the simplest way is the Claude desktop app's Code tab: open this folder and ask Claude to read `CLAUDE.md`, set up, start the app and run the tests.

## Where things are

| Path | What |
|---|---|
| `db/migrations/` | The schema and every rule, one numbered migration per change |
| `db/seed*.sql` | Fictional demo data |
| `db/tests/` | Database rule tests |
| `server/` | Plain Node server (no framework): the JSON API, PDFs, Excel, the sensor feed |
| `public/` | The screens (plain HTML, CSS and JavaScript modules, no build step) |
| `tests/` | Browser tests (Playwright) |
| `docs/LIMS3 Design and Build Log.md` | Every version: what changed, why, how it was checked |
| `docs/ontology_vault/` | The design (Obsidian vault): business objects, rules, workflows and every decision (`08 Decisions`) |
| `docs/project_docs/` | Other project documents (scale test, demo scripts) |
| `CLAUDE.md` | Working instructions for Claude, with the detail of each slice |

## How it is built

Alex Kiddle (LIMS Director, Tentamus North America) designs each slice and decides; Claude builds it, with Claude in the cloud and Claude Code on the laptop working on the same project. Each slice is designed first, recorded as decision notes in the vault, built as a migration with its screens and tests, checked on a fresh database and on a copy of the working data, then applied on Alex's go. Git history in this repository starts at version 0.33.0 (2026-10-20); earlier versions are recorded in the build log.
