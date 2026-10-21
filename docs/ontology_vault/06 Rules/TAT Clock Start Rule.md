---
type: Business Rule
status: Approved
---

# TAT Clock Start Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Requested Test]]
- [[Due Date]]
- [[Test Catalog Entry]]
- [[Laboratory Site]]
- [[Work Calendar]]

## Required behavior
- Day 0 is the day the test is logged. The next day is Day 1, and so on.
- Each test has a Cutoff Time (site local time). Logged after the cutoff, Day 0 moves to the next working day. The test still enters the testing pool immediately so staff who stay late can start it; only the due date moves.
- Business-day tests logged on a weekend or holiday start Day 0 on the next business day. Calendar-day tests start on the day received.
- Due Date = Day 0 + Standard TAT (the maximum) or the approved rush tier's TAT.
- Each Requested Test has its own due date; a sample's is the latest of its tests and an order's the latest of its samples.
- Stability pulls count from the scheduled pull date.

## Value ownership
- Inputs: Logged time, Cutoff Time, TAT, TAT Unit, site time zone, Holiday Calendar
- Outputs: Day 0, Due Date

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
