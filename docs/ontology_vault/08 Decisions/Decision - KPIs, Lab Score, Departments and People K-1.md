---
type: Architecture Decision
status: Approved (Alex, 2026-10-28); build choices Proposed
decided: 2026-10-28
built: 2026-10-28 (version 0.37.0, migration 059)
---

# Decision - KPIs, Lab Score, Departments and People K-1

Relates to [[Decision - Dashboards and the Executive Dashboard D-1]], [[Decision - Invoicing I-1]]. Background: project doc `Analysis - Tentamus OpEx KPIs vs APOLLO` (the corporate OpEx KPI deck was reviewed for context only; Alex: do not build it in directly).

**Context.** Alex (2026-10-28) asked for KPIs by department and by person "for granularity", a Lab Score, the top tests and clients by revenue, and the top departments across labs, on the GM and executive dashboards. "Executives don't need to see the granular lab department side: they can have access to the GM dashboard and see the individual labs if they want to dig deeper." Receipt vs login for the TAT clock: "we won't care about that."

## Decision (Alex)

1. **Lab Score**, out of 100: samples on time **60 %**, revenue against the budget forecast **10 %**, revenue against the monthly forecast **30 %**. No weekly forecast ("I misspoke on that").
2. **Top 20 tests** by how often they are ordered, with their monthly and yearly revenue and the revenue percentage, the **top 3 clients** ordering each, and a **flag when a month swings outside 2 standard deviations**. Lab level (GM) and across all labs (executive).
3. **Top 20 clients** with CM, PM, CY, PY revenue and the revenue percentage. Lab level and across all labs. **PY is shown both ways:** to the same date and the full year.
4. **Top 10 departments across all labs** for executives, with CM, PM, CY, PY revenue, % of the lab and % of the group.
5. **Departments and people** on the GM dashboard. A person's figures cover **work and quality**, are seen by **General Managers and Lab Supervisors**, and **each person sees their own**.

## What was built

- **The GM dashboard** has these widgets: Lab Score, Top 20 tests, Top 20 clients, Departments and People.
  - Departments lists every department of the lab with its revenue and its work: tests reported, on time, backlog, median lab days and batches returned.
- **The executive dashboard** has these widgets: Lab Score (every lab, best first), Top 20 tests (with each test's lab), Top 20 clients (% of group) and the top 10 departments (% of lab and % of group).
  - People and the department work figures are not on it.
- **Home** has two new widgets:
  - People: Lab Supervisors (and anyone given `dashboard.staff`).
  - My numbers: everyone's own figures. It is on by default for Analysts, Lab Supervisors, QA and Project Managers.

## Build choices (Proposed)

1. **Revenue** is the issued invoice lines, credit notes taken off (`revenue_line_view`). It adds up to the Revenue widget.
   - A test line counts to its test and that test's department.
   - Kits, shipping and other charges count to the client but to no test or department.
2. **Periods** use the lab's date:
   - CM: this month to date.
   - PM: last month.
   - CY: this year to date.
   - PY to date: last year up to the same date.
   - PY: all of last year.
   - The client and department tables also show CY against PY to date.
3. **The Lab Score** is judged on this month to date. The month's budget and forecast are taken in proportion to the days gone.
   - Revenue attainment counts up to 100 %: beating the plan does not make up for late samples.
   - "On time" means samples whose complete COA was issued by their due date, with On Hold days not counted (the D-1.1 sample measure).
   - A part with nothing to judge (no sample completed, no budget typed) is left out, and the other weights are scaled up.
   - Last month's score is shown beside it.
4. **Top tests are ranked by client tests ordered in the last 12 months.** Internal work, lot QA testing and cancelled tests are left out.
   - Swing flag: last month's orders lie outside the mean ± 2 SD of the 12 months before it. This uses the sample standard deviation.
   - The month in progress is shown but not judged, because a part month would always look low.
   - The top 3 clients are by orders in the same 12 months.
5. **Top clients are ranked by CY revenue.** Internal clients are left out.
6. **A person's figures**, this month and last month, at the lab:
   - Bench steps signed (QC Review not counted), batches worked, and client tests in those batches.
   - Batches returned from QC Review at least once.
   - On time: the share of those tests approved in QC Review by their due date. It is shared by everyone on the batch, not one person's alone.
   - Batches reviewed and tests finalized on a COA.
   - Verification runs and automated accounts are left out.
   - A person's departments are their department groups at the lab.
7. **New permission `dashboard.staff`** ("People"), held by the standard General Manager and Lab Supervisor groups at every lab. A new lab gets it through the standard group templates. My numbers needs no permission.
8. **The KPIs are worked out on request**, like the other heavy widgets: refresh icon or Refresh all (0.35.0). Nothing is stored, so the figures always follow the records.

## Not built

- Corporate OpEx definitions (TAT-50/95, TAT-R from receipt, deferred starts). Alex: not needed now; see the analysis doc.
- Targets per KPI and per lab (the score's weights are fixed in code), and a stored monthly history of scores.
- A score per department or per person.
