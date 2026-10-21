---
type: Business Object
domain: Security Compliance and Audit
capability: User and Identity Management
object_classification: Definition Object
status: Reviewed
---

# User

## Definition
Authenticated person using the LIMS.

## Ownership
- **Core domain:** [[Security Compliance and Audit]]
- **Capability:** [[User and Identity Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Administrator flag (administrators maintain sites, holidays, the Matrix list and lab assignments)
- Assigned laboratories (see [[Decision - Lab Access Is Assigned Per User by Administrators]])

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
- **has** [[User Account]]
- **has** [[Employment Profile]]
- **has** [[Analyst Qualification]]
- **assigned** [[Role]] (multiple, additive — not a single fixed role)
- **member of** [[Team]] (multiple — inherits that Team's assigned Roles/Permissions while a member, additive on top of directly assigned Roles)
- **owns** [[Analyst Worklist]]
- **performs** [[Electronic Signature]]
- **assigned to** [[Laboratory Site]] (many; limits which labs' orders and samples the user can work on)

## Governing Rules
- Governed by [[Ontology Principles]]
- [[Lab Access Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this User?
- What is blocking or affecting this User?
- Which related records explain this User?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Auto-Batching and Analyst Assignment Workflow]]
- Governed or affected by [[Workflow Step Authorization Rule]]
- Governed or affected by [[Four-Test SME Rule]]
