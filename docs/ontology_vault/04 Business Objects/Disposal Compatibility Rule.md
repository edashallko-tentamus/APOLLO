---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Waste Classification and Disposal
object_classification: Definition Object
status: Reviewed
---

# Disposal Compatibility Rule

## Definition
Rule determining compatible, incompatible, or review-required disposal based on profile and container contents.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Waste Classification and Disposal]]
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
- **evaluates** [[Waste Profile]]
- **evaluates** [[Waste Container]]
- **may block** [[Disposal Event]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Disposal Compatibility Rule?
- What is blocking or affecting this Disposal Compatibility Rule?
- Which related records explain this Disposal Compatibility Rule?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Waste Disposal Decision Workflow]]
- Governed or affected by [[Waste Compatibility Rule]]
