---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Inventory Transactions and Reconciliation
object_classification: Event Object
status: Reviewed
---

# Transfer Transaction

## Definition
Movement between storage or ownership locations.

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
- **is a** [[Inventory Transaction]]
- **affects** [[Inventory Lot]]
- **creates** a new [[Inventory Lot]] at the receiving lab (see [[Decision - Inventory Belongs to a Lab and Transfers Are Re-Logged]])

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Transfer Transaction?
- What is blocking or affecting this Transfer Transaction?
- Which related records explain this Transfer Transaction?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
