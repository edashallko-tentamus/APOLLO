---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Purchasing and Dynamic Receiving
object_classification: Event Object
status: Draft
---

# Vendor Qualification

## Definition
One qualification review of a Supplier — accreditation, risk classification, and approval decision. A new record is created at each review or re-qualification rather than overwriting the prior decision, so the qualification history is preserved, not just the current state.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Purchasing and Dynamic Receiving]]
- **Object classification:** [[Event Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Accreditation(s) (e.g. ISO 17025, ISO 9001, A2LA, NVLAP — the supplier's relevant certifications)
- Risk Classification (Class I, Class II, Class III)
- Approval Status (Approved, Not Approved, Suspended)
- Approval Date
- Expiration Date (re-qualification due date, if periodic review is required)
- Approved By
- Justification / Notes
- Level: Corporate (every lab, Corporate QA) or one Laboratory Site (that lab's QA); resolved by [[Decision - Vendor Approvals, Local and Corporate V-1]]
- Supply scopes (what the vendor is approved for: reference standards, calibration services, ...; or every scope)
- Promoted from (the lab approval a corporate approval came from) and its proposal
- Documents (questionnaires, certificates with their expiry, audit reports, quality agreements)

## Derived Values
- Is Current (true for the most recent Vendor Qualification record per Supplier)
- Is Expired (true when today is past Expiration Date)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[Supplier]]
- **approved by** [[User]]
- **blocks or allows** [[Supply Purchase Order Line]]

## Governing Rules
- Governed by [[Ontology Principles]]
- See [[Decision - Vendor Qualification Blocks Purchasing]]
- Governed by [[Supplier Qualification Blocking Rule]]
- Governed by [[GMP Record Change Control Rule]] — covers this record's own creation/edit; separate from the Approval Status decision it governs on Supply Purchase Order Line

## Resolved
- Scope: one qualification for all Tentamus North America labs, with a lab-specific decision when one lab needs it; risk classes set the re-qualification interval. See [[Decision - Purchasing Slice Scope and Rules]].
## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current Approval Status for this Supplier?
- Is this Vendor Qualification expired or approaching expiration?
- What is blocking or affecting this Vendor Qualification?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
