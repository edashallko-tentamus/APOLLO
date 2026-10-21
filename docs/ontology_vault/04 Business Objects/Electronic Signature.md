---
type: Business Object
domain: Security Compliance and Audit
capability: Electronic Signatures
object_classification: Governance Object
status: Reviewed
---

# Electronic Signature

## Definition
Part 11-compliant signature bound to a record, user, date/time, and meaning.

## Ownership
- **Core domain:** [[Security Compliance and Audit]]
- **Capability:** [[Electronic Signatures]]
- **Object classification:** [[Governance Object]]
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
- **performed by** [[User]]
- **requires** [[User Authentication]]
- **creates** [[Signature Event]]
- **governed by** [[21 CFR Part 11 Controls]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Electronic Signature?
- What is blocking or affecting this Electronic Signature?
- Which related records explain this Electronic Signature?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
- Governed or affected by [[Part 11 Logbook Rule]]

## Sandbox implementation (slice 3.2, 2026-10-12)
Built for the Inventory module: see [[Decision - Inventory Changes Are Electronically Signed]], [[Decision - Users Sign In With Their Own User ID and Password]] and [[Decision - Reasons for Change Are Picked From Canned Reasons per Module]]. Stored in `signature_event` (signer, full name, meaning, action, module, reason, method, time; cannot be edited or deleted) and linked from each `audit_log` entry it covers.