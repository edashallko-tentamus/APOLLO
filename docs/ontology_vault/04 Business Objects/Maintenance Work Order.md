---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Execution Object
status: Reviewed
---

# Maintenance Work Order

## Definition
Assigned maintenance task for equipment.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
- **Object classification:** [[Execution Object]]
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
- **created by** [[Maintenance Schedule]]
- **belongs to** [[Equipment]]
- **assigned as** [[Worklist Task]]
- **documented in** [[Maintenance Logbook]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Maintenance Work Order?
- What is blocking or affecting this Maintenance Work Order?
- Which related records explain this Maintenance Work Order?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Equipment Tag-Out Maintenance and TAT Workflow]]
- Governed or affected by [[Equipment Automatic Tag-Out Rule]]
