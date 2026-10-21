---
type: Business Rule
status: Approved in principle (Alex, 2026-10-15); details Proposed
---

# Work in Progress Stages Rule

Revenue counts when an invoice is issued. Every other client test not cancelled, not internal and not non-billable is work in progress, valued at its price as ordered plus its rush fee, in one stage: Not Started (not in a batch), Incomplete (in a batch), Finalized (results approved in QC Review, report not issued) or Pending Invoice (report issued, or on a draft invoice). The month's projection counts invoiced revenue and the work due this month; work due later is shown beside it as the month-end boost.

Computed in the database (migration 037: `test_tat_view`, `client_hold_days`, `wip_view`, `revenue_view`). See [[Decision - Dashboards and the Executive Dashboard D-1]].
