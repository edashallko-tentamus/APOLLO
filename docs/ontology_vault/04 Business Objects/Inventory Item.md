---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Inventory Status and Availability
object_classification: Definition Object
status: Reviewed
---

# Inventory Item

## Definition
Master definition of a chemical, solvent, reagent, reference material, consumable, supply, or other inventory resource.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Inventory Status and Availability]]
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
- **has** [[Inventory Lot]]
- **supplied by** [[Supplier]]
- **manufactured by** [[Manufacturer]]
- **has** [[Waste Profile]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: item master import.

## AI Questions
- What is the current status of this Inventory Item?
- What is blocking or affecting this Inventory Item?
- Which related records explain this Inventory Item?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
