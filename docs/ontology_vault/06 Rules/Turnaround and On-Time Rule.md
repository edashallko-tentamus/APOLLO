---
type: Business Rule
status: Approved in principle (Alex, 2026-10-15); details Proposed
---

# Turnaround and On-Time Rule

Turnaround is measured in three segments for every client test reported (COA issued): Login TAT (received to logged in), Lab TAT (logged in to QC Review approval of its final results) and QA TAT (approval to the first COA that carried it). A test is on time when its COA was issued on or before its due date plus the calendar days the client's account was On Hold between Day 0 and the report (Alex: only the hold stops the clock; time on an OOS investigation counts). Hold periods come from the client's audit trail.

Computed in the database (migration 037: `test_tat_view`, `client_hold_days`, `wip_view`, `revenue_view`). See [[Decision - Dashboards and the Executive Dashboard D-1]].
