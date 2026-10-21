---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Purchasing and Dynamic Receiving
object_classification: Execution Object
status: Reviewed
---

# Supply Purchase Order Line

## Definition
One ordered laboratory supply or resource.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Purchasing and Dynamic Receiving]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- To be refined

## Derived Values
- Purchase Status (Approved, Ordered, Received — approval requires supervisor role/permission; the queue where supervisors approve requests and create new orders directly is the Purchasing module, out of scope for now)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[Supply Purchase Order]]
- **may have multiple** [[Inventory Receipt]]
- **creates** [[Inventory Lot]] (once approved — the lot exists as an unfinished item at Purchase Status: Approved, before physical receipt)
- **may be requested by** [[Inventory Lot]] (via the Reorder action on an existing lot)

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[Supplier Qualification Blocking Rule]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: order lines.

## AI Questions
- What is the current status of this Supply Purchase Order Line?
- What is blocking or affecting this Supply Purchase Order Line?
- Which related records explain this Supply Purchase Order Line?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
