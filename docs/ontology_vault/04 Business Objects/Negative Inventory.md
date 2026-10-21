---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Inventory Transactions and Reconciliation
object_classification: Derived Value
status: Reviewed
---

# Negative Inventory

## Definition
State where Quantity On Hand is below zero; accepted as operational reality but requires visibility and reconciliation.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Inventory Transactions and Reconciliation]]
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
- **applies to** [[Inventory Lot]]
- **triggers** [[Inventory Reconciliation]]
- **creates** [[Variance]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Negative Inventory?
- What is blocking or affecting this Negative Inventory?
- Which related records explain this Negative Inventory?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Negative Inventory Reconciliation Workflow]]
- Governed or affected by [[Negative Inventory Rule]]
