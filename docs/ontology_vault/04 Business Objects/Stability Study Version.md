---
type: Business Object
domain: Sample Management
capability: Stability Studies
object_classification: Governance Object
status: Reviewed
---

# Stability Study Version

## Definition
A priced, accepted version of a study's design. Amendments (for example adding a 36-month pull) create a new version. Cancelling a study stops future pulls and creates a disposition task for remaining material (return or destroy).

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Stability Studies]]
- **Object classification:** [[Governance Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Version Number
- Status: Draft, Quoted, Accepted, Superseded
- Annual Price Escalation % (optional, compounded on each acceptance anniversary)
- Accepted By
- Accepted At

## Derived Values
- Price table by year (Year 1, Year 2, Year 3...)
- Study total

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **version of** [[Stability Study]]
- **contains** [[Stability Condition]]
- **contains** [[Stability Timepoint]]
- **contains** [[Stability Test Matrix Entry]]
- **contains** [[Quote Rush Term]]
- **issued as** [[Quote]]

## Governing Rules
- [[Stability Price Escalation Rule]]
- [[List Price Snapshot Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Stability Study Version?
- What is blocking or affecting this Stability Study Version?
- Which related records explain this Stability Study Version?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
