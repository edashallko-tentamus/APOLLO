---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Inventory Status and Availability
object_classification: Derived Value
status: Reviewed
---

# Use Eligibility

## Definition
Allowed, restricted, review required, or blocked determination for inventory use. False whenever Purchase Status is Approved or Ordered (not yet Received) — an unfinished purchased item cannot be used by the lab until it physically arrives, independent of expiration or hold status.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Inventory Status and Availability]]
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
- **derived from** [[Inventory Status]]
- **derived from** [[Expiration Status]]
- **derived from** [[Inventory Hold]]
- **derived from** Purchase Status (on [[Inventory Lot]])
- **controls** [[Material Usage Record]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Use Eligibility?
- What is blocking or affecting this Use Eligibility?
- Which related records explain this Use Eligibility?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Inventory Receiving and Use Workflow]]
- Governed or affected by [[Expired Inventory Blocking Rule]]
