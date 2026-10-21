---
type: Business Object
domain: Sample Management
capability: Stability Studies
object_classification: Definition Object
status: Reviewed
---

# Stability Timepoint

## Definition
A scheduled point in the study (T0 baseline, T1, T3, T6, T12 months...). Each timepoint has its own pull tolerance, entered as days early and days late (one number fills both) with fill down across timepoints.

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Stability Studies]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Label (T0, T1, ...)
- Interval and unit (months, weeks)
- Tolerance Days Early
- Tolerance Days Late

## Derived Values
- Scheduled Pull Date (adjusted for non-working days)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[Stability Study Version]]
- **generates** [[Stability Pull]]

## Governing Rules
- [[Stability Pull Generation Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Stability Timepoint?
- What is blocking or affecting this Stability Timepoint?
- Which related records explain this Stability Timepoint?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
