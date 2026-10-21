---
type: Business Object
domain: Laboratory Operations
capability: Test Planning Assignment and Batching
object_classification: Derived Value
status: Reviewed
---

# Due Date

## Definition
Calculated completion date for a [[Requested Test]]. Day 0 is the day the test is logged (receipt). If it is logged after the test's Cutoff Time, or on a non-working day for a business-day test, Day 0 is the next working day. Due Date = Day 0 + Standard TAT (or the approved rush tier's TAT) in business or calendar days using the site's [[Work Calendar]]. A sample's due date is the latest of its tests; an order's is the latest of its samples. Stability pulls count from the scheduled pull date.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Planning Assignment and Batching]]
- **Object classification:** [[Derived Value]]
- **Value model:** [[Value Ownership]]

## User Values
- None (derived)

## Derived Values
- Day 0
- Due Date
- Sample Due Date
- Order Due Date

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **applies to** [[Requested Test]]
- **uses** [[Work Calendar]]
- **uses** [[Laboratory Site]] time zone
- **used to derive** [[Backlog]]
- **recalculated by** [[Equipment Impact Assessment]]
- **recalculated by** [[Rush Decision]]

## Governing Rules
- [[TAT Clock Start Rule]]
- [[Delayed TAT Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Due Date?
- What is blocking or affecting this Due Date?
- Which related records explain this Due Date?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
