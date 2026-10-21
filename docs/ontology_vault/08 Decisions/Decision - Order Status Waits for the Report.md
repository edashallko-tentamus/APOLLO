---
type: Architecture Decision
status: Approved (built in WD-5)
decided: 2026-10-13
---

# Decision - Order Status Waits for the Report

Alex Kiddle, 2026-10-13: an order is not Complete when its results are approved. It is complete when the order goes out to the client.

**Statuses (to build, replacing Complete)**
- Draft, Submitted, Received: as before ([[Decision - Lab Order Statuses]]).
- In Testing: a test on the order has been batched.
- In Review: every test's bench work is done and at least one batch waits for QC Review.
- Approved: every test on the order has approved results.
- Reported: the report went out to the client (the reporting slice).

Built in WD-5 (migration 021): Complete is retired and existing Complete orders are recalculated. In Review is set when no test is left at the bench and a batch waits for review. A preliminary (timepoint) result does not make an order Approved. See [[Decision - Analytical Runs, Preliminary Results and Order Statuses]].

See [[Decision - QC Review Build Choices]].
