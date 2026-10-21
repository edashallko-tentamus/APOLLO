---
type: Business Object
domain: Security Compliance and Audit
capability: Roles and Permissions
object_classification: Definition Object
status: Reviewed
---

# Role

## Definition
Named set of permissions and responsibilities. Composed of individually selectable [[Permission]] records — an admin builds a Role by picking which Permissions belong to it, rather than a fixed hardcoded bundle. A User's effective permission set is additive: the union of every Permission from every Role assigned directly to them, plus every Permission granted by every [[Team]] they belong to. See [[Decision - Roles and Permissions Are Additive and Group-Assignable]].

## Ownership
- **Core domain:** [[Security Compliance and Audit]]
- **Capability:** [[Roles and Permissions]]
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
- **assigned to** [[User]] (multiple per User — additive, not exclusive)
- **assigned to** [[Team]] (multiple — every current member inherits these Permissions while a member)
- **contains** [[Permission]] (individually selectable, admin-composed)
- **grants** cross-site oversight (view across [[Laboratory Site]]s) for VPs, Division Directors and C-suite (see [[Decision - Cross-Site Access Comes From Roles]])
- **folded into** [[Team]] as the permission group (see [[Decision - Permissions Are Granted Through Lab Groups]])

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]] — changing who can do what is treated as sensitive in its own right under GMP, not just the approvals it gates

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: role and permission matrix.

## AI Questions
- What is the current status of this Role?
- What is blocking or affecting this Role?
- Which related records explain this Role?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
