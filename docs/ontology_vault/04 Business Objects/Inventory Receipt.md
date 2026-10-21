---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Purchasing and Dynamic Receiving
object_classification: Event Object
status: Reviewed
---

# Inventory Receipt

## Definition
Dynamic receipt event supporting partial receipts, unexpected receipts, multiple lots, quantities, and expiration dates.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Purchasing and Dynamic Receiving]]
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
- **references** [[Supply Purchase Order Line]]
- **contains** [[Received Item]] (one per distinct item received — each Received Item fulfills its own pending Inventory Lot)
- **creates** [[Inventory Lot]] directly, only for an unexpected receipt with no prior Supply Purchase Order Line — the normal path is Received Item fulfilling an already-pending lot, not this relationship
- **may create** [[Receipt Discrepancy]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: multi-lot receipt.

## AI Questions
- What is the current status of this Inventory Receipt?
- What is blocking or affecting this Inventory Receipt?
- Which related records explain this Inventory Receipt?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Inventory Receiving and Use Workflow]]
