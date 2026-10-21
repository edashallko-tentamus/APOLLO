---
type: Business Rule
status: Approved in principle (Alex, 2026-10-15); details Proposed
---

# Invoice Readiness Rule

Work is ready to invoice once the test's results have been on an issued COA (or, for a test replaced by a lab investigation retest, once the retest is reported). Internal work, cancelled tests and retests waiting for QA's billing determination are not ready. Work on a draft or an issued invoice is not ready again unless a credit note says to invoice it again.

Enforced in the database (migration 036). See [[Decision - Invoicing I-1]]. Applies to [[Invoice]] and [[Invoice Line Item]].
