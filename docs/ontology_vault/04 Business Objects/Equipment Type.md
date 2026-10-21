---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Definition Object
status: Reviewed
---

# Equipment Type

## Definition
Classification of equipment or instrument. A static table each lab configures (like [[Department]]), see [[Decision - Equipment Slice Scope and Rules]].

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Type Name (unique in the lab)
- Description
- Status (Active, Inactive)
- Lab (each lab keeps its own list)

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
- **classifies** [[Equipment]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Equipment Type?
- What is blocking or affecting this Equipment Type?
- Which related records explain this Equipment Type?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
