---
type: Business Rule
status: Approved
---

# Stability Pull Generation Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Stability Pull]]
- [[Stability Timepoint]]
- [[Lab Order]]
- [[Work Calendar]]

## Required behavior
- T0 is baseline testing at placement and creates its own Lab Order (origin Stability Baseline). Pulls begin at T1 and draw from chamber storage.
- Scheduled pull dates are calculated from the placement date when the study is set up. A date on a non-working day moves to the next business day if the tolerance window allows, otherwise to the previous business day. Clients see the adjusted dates on the quote.
- Each pull's Lab Order (origin Stability Pull) is created on the pull date, not before. An upcoming-pulls calendar shows future pulls by chamber, read-only.
- Each timepoint carries a tolerance in days early and days late; pulls outside tolerance are flagged.
- The pull's due date counts from the scheduled pull date. Pulls are billed when completed.

## Value ownership
- Inputs: Placement date, timepoints, tolerances, Work Calendar
- Outputs: Scheduled pull dates, Stability Pull, Lab Order

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
