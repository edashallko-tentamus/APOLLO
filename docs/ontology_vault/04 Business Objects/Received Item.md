---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Purchasing and Dynamic Receiving
object_classification: Execution Object
status: Reviewed
---

# Received Item

## Definition
Specific item received during an Inventory Receipt. The Receive action, triggered from a pending Inventory Lot's detail screen, is what creates this record.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Purchasing and Dynamic Receiving]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Actual Received Quantity
- Actual Manufacturer Lot (the supplier's own lot number)
- Actual Expiration Date
- Storage Location assigned on receipt

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
- **belongs to** [[Inventory Receipt]]
- **fulfills** [[Inventory Lot]] (the pending record already created when its Supply Purchase Order Line was approved — Received Item fills in the actual values and flips Purchase Status to Received; it does not create a second Inventory Lot)
- **may attach** [[Supplier COA]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: receiving several items per shipment.

## AI Questions
- What is the current status of this Received Item?
- What is blocking or affecting this Received Item?
- Which related records explain this Received Item?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
