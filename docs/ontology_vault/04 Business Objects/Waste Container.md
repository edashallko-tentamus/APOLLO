---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Waste Classification and Disposal
object_classification: Execution Object
status: Reviewed
---

# Waste Container

## Definition
Physical waste accumulation container with tracked contents and compatibility.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Waste Classification and Disposal]]
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
- **belongs to** [[Waste Stream]]
- **contains** [[Waste Accumulation Record]]
- **evaluated by** [[Disposal Compatibility Rule]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Waste Container?
- What is blocking or affecting this Waste Container?
- Which related records explain this Waste Container?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Waste Disposal Decision Workflow]]
- Governed or affected by [[Waste Compatibility Rule]]
