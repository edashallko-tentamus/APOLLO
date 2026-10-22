# Scale Measurement 1: LIMS3 0.33.0 at network volume

Measured 2026-10-20 and 21 by Claude in the cloud, on the separate scale copy (`lims3-scale`, version 0.33.0-scale). Nothing here was delivered to the laptop or to Alex's data. Fixes come next, on Alex's go.

## The answer

**LIMS3 as built cannot carry the network. It fails at about 50 people, not 500, and it fails for two reasons that feed each other.**

1. **One database connection for everyone.** The server sends every query, for every person, through a single connection, one at a time. So the system's capacity is one query at a time, and any slow page freezes everyone. With 150 people using only the fast pages (each under 1.5 s alone), every page took 5 to 45 seconds because people were queueing.
2. **Status is worked out from scratch, over the whole history, on every read.** "What is waiting for finalization", "what is ready to invoice", the dashboards, the QC verdicts and trend watch all recompute from every record ever made. After 10 days of network volume, the Home dashboard takes 9 minutes, the GM dashboard 31 minutes and Trend watch over an hour and a half. These grow with every day of data, so a faster server only delays the wall.

Fix 1 alone stops one person's slow page from freezing everyone. Fix 2 is what makes the pages fast. Both are needed, and neither is a small tweak: they are the next slice.

## What was measured

| | |
|---|---|
| Labs | 20 (CFL 2000 samples/day, TPS 200, 18 others 25 to 200): 4,243 samples a day across the network |
| People | 537 load-test accounts in 8 roles, in proportion to each lab's volume |
| Data loaded | 85,745 samples, 108,739 tests, 395,856 bench steps, 1.18 M readings, 411,386 results, 5.16 M audit rows; 9.9 GB. About 7 to 10 network days of work |
| Machine | 2 CPUs, 7 GB memory, PostgreSQL 16 on the same box |
| Method | The load runner makes the same API calls each page makes in the browser, with 20 s (±50 %) thinking time between pages and a mix of pages per role |

## Results

### One person at a time (no queueing)

| Page | Time | Target |
|---|---|---|
| Trend watch | 5,848 s (97 min) | 2 s |
| GM dashboard | 1,860 s (31 min) | 2 s |
| Home dashboard | 552 s (9 min) | 2 s |
| Billing, Ready to invoice | 234 s | 2 s |
| COA preview | over 180 s (timed out) | 10 s |
| Report Finalization queue | 66 s | 2 s |
| A batch page | 15 s (up to 75 s for a large batch in progress) | 2 s |
| Lab orders list | 1.4 s, growing with every order | 2 s |
| OOS list, audit trail, backlog, intake | 0.4 to 0.9 s | 2 s |
| Everything else | under 0.2 s | 2 s |

### A crowd

| Run | Result |
|---|---|
| 50 people, slow dashboards left out | Collapse. Most pages hit the 2-minute limit; half the sign-ins failed. Cause: batch pages, each holding the only connection for 6 to 75 s. |
| 150 people, every page over 2 s left out | No failures, but every page 5 to 45 s (orders list p50 5.8 s, backlog 12.5 s, an order 32 s). Pure queueing: the pages are fast alone. |
| 300 and 500 people | Not run. They cannot do better than 150. |

## Why each slow thing is slow

| What | Cause | Proof |
|---|---|---|
| Everyone waits on everyone | `server/db.js` queues every query onto one connection | 150-user run above; sign-ins took 23 to 30 s while a dashboard ran |
| QC verdicts (batch page, QC Review, GM dashboard, Trend watch) | (a) a reading is looked up by entry and analyte, but the only index starts with the step, so each lookup reads all 1.18 M readings (0.27 s each, once per QC row); (b) the 042 wrapper recalculates `batch_results` again for every waiting row; (c) Trend watch recalculates verdicts for about 600 batches, the GM dashboard about 150 | Adding one index cut a batch from 6.4 s to 1.0 s. A batch in progress still takes 74 s through (b) |
| Report Finalization queue, Ready to invoice, dashboards' WIP, TAT, revenue, rush and due-date counts | Views that call a function per test over every test ever requested (`test_awaits_finalization`, `billing_completed_at`, `test_invoice_line`) | 66 s to over 300 s each at 10 days |
| Low stock widget | `low_stock_demand_view` joined to the whole test pool | over 300 s |
| Lab orders list | Loads the lab's whole history, no paging | 1.4 s now; about 150 s after 3 years |
| COA preview | PDF made in Chromium while the request holds the connection | over 180 s under load |

## Three years from now (confidence: low)

The load holds about 1 % of three years' work (about 780 working days). Things that read the whole history grow about 110 times:

- **Audit trail:** about 56 audit rows per test, about 1.3 KB each, roughly 1 GB a day across the network: **about 0.5 to 0.6 billion rows and 1 TB** after three years. It needs monthly partitions and a storage and backup plan.
- **Database:** about 1 TB in all, mostly audit.
- **Unpaged lists:** the orders list goes from 1.4 s to minutes.
- **History-wide views:** from minutes to hours. They must not exist in this form by then.

## The fixes, in order

1. **A connection pool** (about 20 connections), a statement time limit for page reads (for example 15 s), and PDFs, sensor reads and the hourly jobs moved off the people's connections onto a job worker. This removes the "one slow page freezes everyone" failure. It does not make a slow page fast.
2. **Stored status instead of status recalculated from history.** Each requested test keeps its own "waiting for finalization", "ready to invoice", "completed at" and verdict state, kept up to date by the database when the record changes, and indexed. The queues then read a few hundred rows, not every test ever made.
3. **QC verdicts:** the missing index on readings (proved here), calculate a batch's results once per call, and store the verdicts when a batch is approved so Trend watch and the dashboards read stored figures.
4. **Dashboards from summaries:** figures computed every few minutes into summary tables by the job worker; the page reads the summary.
5. **Paging on every list**, with Current and Finished tabs, search and filters (Alex's rule). The backlog keeps showing everything waiting.
6. **Audit partitioned by month**, plus a storage, backup and restore plan.
7. **For more than one server:** sessions in the database (today a restart signs everyone out), files out of the database, backups tested by a restore.

After 1 to 5, rerun this same measurement (the tooling stays in the scale copy) and add a second history point (40 days) before calling it done.

## Confidence and limits

- **2-CPU test box.** A real database server would run each query perhaps 3 to 5 times faster (below 90 % sure of that factor). It does not change the conclusions: one connection still serializes, and history-wide views still grow without limit.
- **Thin template data.** The data was multiplied from 23 demo orders, so some tests are over-represented and the samples are about 3 times overstated against the tests (the load was calibrated to tests). Page times depend mostly on test, step and audit counts, which are realistic.
- **Bench saves were not measured properly.** The chosen bench steps were not yet startable, so every save was refused (7 s under load was the time to refuse). Fix the targets before the next run.
- **One database for all 20 labs** was assumed. Splitting by lab would shrink each database but not remove either cause.
- Every number above was measured on this copy; the three-year figures are extrapolations.

## Files (scale copy only)

- `loadtest/run.js` (load runner; `--single`, crowd mode, `--exclude`), `loadtest/targets.js`, `loadtest/profile.js`
- Results: `single_p1.json`, `profile_p1.log`, `profile_p1b.log`, `crowd_light_50.json`, `crowd_lighter_150.json`
- `server/db.js` slow-statement log (`LIMS_SLOW_MS`, `LIMS_SLOW_FILE`)
- Data builders in the session scratchpad: `setup.js`, `clone.js`, `plan.js`
- An index `scale_ev_entry_idx` was added to the measurement database only.
