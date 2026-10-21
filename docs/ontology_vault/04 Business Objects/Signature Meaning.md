---
type: Business Object
domain: Security Compliance and Audit
capability: Electronic Signatures
object_classification: Definition Object
status: Reviewed
---

# Signature Meaning

## Definition
Meaning such as performed, reviewed, approved, released, or verified.

## Ownership
- **Core domain:** [[Security Compliance and Audit]]
- **Capability:** [[Electronic Signatures]]
- **Object classification:** [[Definition Object]]
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
- **applies to** [[Electronic Signature]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Signature Meaning?
- What is blocking or affecting this Signature Meaning?
- Which related records explain this Signature Meaning?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Sandbox implementation (slice 3.2, 2026-10-12)
Built for the Inventory module: see [[Decision - Inventory Changes Are Electronically Signed]], [[Decision - Users Sign In With Their Own User ID and Password]] and [[Decision - Reasons for Change Are Picked From Canned Reasons per Module]]. Stored in `signature_event` (signer, full name, meaning, action, module, reason, method, time; cannot be edited or deleted) and linked from each `audit_log` entry it covers.