---
type: Business Object
domain: Sample Management
capability: Stability Studies
object_classification: Event Object
status: Reviewed
---

# Stability Pull

## Definition
The retrieval of material from a chamber for one condition at one timepoint. Generated from the schedule; the [[Lab Order]] is created on the pull date (not earlier). An upcoming-pulls calendar gives read-only visibility of future pulls by chamber. Due date counts from the scheduled pull date.


## As built (migration 032, 2026-10-14)
- Scheduled (date moved off non-working days inside the window), Ordered (its lab order made on the date), Pulled (units out of storage, sample logged, inside or outside the window with a note). Turnaround from the scheduled date; priced for its study year.
- See [[Decision - Stability Studies S-1]].

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Stability Studies]]
- **Object classification:** [[Event Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Actual pull date and time
- Pulled by
- Quantity pulled

## Derived Values
- Scheduled Pull Date
- Within Tolerance (Yes/No)
- Due Date

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[Stability Study]]
- **for** [[Stability Timepoint]]
- **for** [[Stability Condition]]
- **creates** [[Lab Order]]
- **draws from** [[Sample]]

## Governing Rules
- [[Stability Pull Generation Rule]]
- [[Stability Material Sufficiency Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Stability Pull?
- What is blocking or affecting this Stability Pull?
- Which related records explain this Stability Pull?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
