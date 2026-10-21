---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Derived Value
status: Reviewed
---

# Equipment Impact Assessment

## Definition
Assessment of Test Pool, Test Batch, Worklist, workflow, due-date, backlog, and client impact from equipment unavailability.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
- **Object classification:** [[Derived Value]]
- **Value model:** [[Value Ownership]]

## User Values
- To be refined

## Derived Values
- To be refined

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **triggered by** [[Equipment Tag]]
- **affects** [[Requested Test]]
- **recalculates** [[Due Date]]
- **produces** [[Delayed TAT]]
- **lists affected** [[Stability Study]] (chamber excursions)

## Governing Rules
- Governed by [[Ontology Principles]]
- Exempt from [[GMP Record Change Control Rule]] — Derived Value only, calculated automatically when an Equipment Tag becomes active, nothing user-entered to protect

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Equipment Impact Assessment?
- What is blocking or affecting this Equipment Impact Assessment?
- Which related records explain this Equipment Impact Assessment?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Equipment Tag-Out Maintenance and TAT Workflow]]
- Governed or affected by [[Delayed TAT Rule]]
