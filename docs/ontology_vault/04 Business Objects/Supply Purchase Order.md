---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Purchasing and Dynamic Receiving
object_classification: Execution Object
status: Reviewed
---

# Supply Purchase Order

## Definition
Internal purchasing order for supplies or equipment.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Purchasing and Dynamic Receiving]]
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
- **issued to** [[Supplier]]
- **contains** [[Supply Purchase Order Line]]
- **fulfilled by** [[Inventory Receipt]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Supply Purchase Order?
- What is blocking or affecting this Supply Purchase Order?
- Which related records explain this Supply Purchase Order?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Inventory Receiving and Use Workflow]]
