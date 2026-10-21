---
type: Business Rule
status: Reviewed
---

# Equipment Automatic Tag-Out Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Maintenance Schedule]]
- [[Calibration]]
- [[Threshold Rule]]
- [[Equipment Tag]]
- [[Equipment Status]]
- [[Maintenance Work Order]]

## Required behavior
Two triggers automatically create an [[Equipment Tag]] without a user manually initiating tag-out: (1) a [[Maintenance Schedule]] reaching its scheduled date creates a Tag with Reason: Maintenance and a corresponding [[Maintenance Work Order]]; (2) a [[Calibration]] record's expiration breaching Deficient status on its governing [[Threshold Rule]] creates a Tag with Reason: Calibration. In both cases [[Equipment Status]] updates automatically as a consequence of the new active Tag — it is never set directly.

## Value ownership
- Inputs: Maintenance Schedule due date; Calibration expiration Threshold Rule status.
- Outputs: a new [[Equipment Tag]] (Governance Object), Equipment Status recalculation (Derived Value).

## Not a trigger (0.18.0)
- A failing logbook check (balance, pipette, temperature) does **not** tag the equipment out: it flags the batch steps that used it ([[Logbook Failure Flag Rule]]). Whether some failures should tag out is QA item 44 in [[Open Items for QA Review]].
