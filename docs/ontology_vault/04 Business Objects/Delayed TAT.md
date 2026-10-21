---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Derived Value
status: Reviewed
---

# Delayed TAT

## Definition
Calculated turnaround delay caused by unavailable required equipment after considering qualified alternatives.

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
- **derived from** [[Equipment Impact Assessment]]
- **displayed on** [[Requested Test]]
- **displayed on** [[Test Pool]]
- **displayed on** [[Project]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Exempt from [[GMP Record Change Control Rule]] — Derived Value only, calculated from Equipment Tag/Requested Test state, nothing user-entered to protect

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Delayed TAT?
- What is blocking or affecting this Delayed TAT?
- Which related records explain this Delayed TAT?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Equipment Tag-Out Maintenance and TAT Workflow]]
- Governed or affected by [[Delayed TAT Rule]]
