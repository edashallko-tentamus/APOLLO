---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Definition Object
status: Reviewed
---

# Maintenance Schedule

## Definition
Planned preventive maintenance schedule capable of automatic tag-out on the scheduled date.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
- **Object classification:** [[Definition Object]]
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
- **applies to** [[Equipment]]
- **creates** [[Maintenance Work Order]]
- **triggers** [[Equipment Tag]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: schedules across equipment.

## AI Questions
- What is the current status of this Maintenance Schedule?
- What is blocking or affecting this Maintenance Schedule?
- Which related records explain this Maintenance Schedule?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Equipment Tag-Out Maintenance and TAT Workflow]]
- Governed or affected by [[Equipment Automatic Tag-Out Rule]]
