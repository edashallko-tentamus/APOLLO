---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Inventory Transactions and Reconciliation
object_classification: Event Object
status: Reviewed
---

# Inventory Transaction

## Definition
Immutable quantity-changing inventory event.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Inventory Transactions and Reconciliation]]
- **Object classification:** [[Event Object]]
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
- **affects** [[Inventory Lot]]
- **derives** [[Quantity On Hand]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Inventory Transaction?
- What is blocking or affecting this Inventory Transaction?
- Which related records explain this Inventory Transaction?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
