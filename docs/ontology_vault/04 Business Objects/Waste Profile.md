---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Waste Classification and Disposal
object_classification: Definition Object
status: Reviewed
---

# Waste Profile

## Definition
Approved hazard, compatibility, segregation, container, and disposal profile for a material or mixture.

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
- **belongs to** [[Inventory Item]]
- **may belong to** [[Inventory Lot]]
- **uses** [[Hazard Classification]]
- **determines** [[Waste Stream]]
- **evaluated by** [[Disposal Compatibility Rule]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Waste Profile?
- What is blocking or affecting this Waste Profile?
- Which related records explain this Waste Profile?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Waste Disposal Decision Workflow]]
- Governed or affected by [[Waste Compatibility Rule]]

## Built (0.30.0)
- Built as the waste classification (WC-001) each inventory item has: hazard classes, EPA codes, stream, container, disposal instructions, segregation; chosen, or the default for the item type. See [[Decision - Waste Classifications W-1]].
