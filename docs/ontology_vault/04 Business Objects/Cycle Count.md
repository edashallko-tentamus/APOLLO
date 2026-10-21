---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Inventory Transactions and Reconciliation
object_classification: Execution Object
status: Reviewed
---

# Cycle Count

## Definition
Physical count used to compare actual and recorded inventory.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Inventory Transactions and Reconciliation]]
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
- **evaluates** [[Inventory Lot]]
- **may create** [[Variance]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: counted quantities across many lots.

## AI Questions
- What is the current status of this Cycle Count?
- What is blocking or affecting this Cycle Count?
- Which related records explain this Cycle Count?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
