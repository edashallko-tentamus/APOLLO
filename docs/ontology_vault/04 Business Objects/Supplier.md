---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Purchasing and Dynamic Receiving
object_classification: Definition Object
status: Reviewed
---

# Supplier

## Definition
Organization supplying laboratory goods or services.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Purchasing and Dynamic Receiving]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Supplier Name
- Account Number (this lab's account number with the supplier)
- Primary Contact (name, email, phone)
- Address

## Derived Values
- Current Approval Status (Approved, Expired, Not Approved, Suspended — derived from the most recent [[Vendor Qualification]] record, not stored directly on Supplier)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **receives** [[Supply Purchase Order]]
- **provides** [[Inventory Receipt]]
- **manufactures or supplies** [[Inventory Item]]
- **qualified by** [[Vendor Qualification]] (multiple — one record per qualification review, not overwritten)

## Governing Rules
- Governed by [[Ontology Principles]]
- See [[Decision - Storage Location and Supplier Defined]]
- See [[Decision - Vendor Qualification Blocks Purchasing]]
- Governed by [[GMP Record Change Control Rule]] — covers Supplier's own fields (name, contact, account); Vendor Qualification's approval decision has its own separate QA-signature requirement

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Supplier?
- What is blocking or affecting this Supplier?
- Which related records explain this Supplier?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Inventory Receiving and Use Workflow]]
