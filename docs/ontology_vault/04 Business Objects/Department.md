---
type: Business Object
domain: Master Data and Configuration
capability: Organizational Configuration
object_classification: Definition Object
status: Reviewed
---

# Department

## Definition
Organizational unit responsible for work. Admin-managed — Department is a static, admin-maintained table (add/edit access restricted to admin users), assigned on records like [[Equipment]] rather than freely typed.

## Ownership
- **Core domain:** [[Master Data and Configuration]]
- **Capability:** [[Organizational Configuration]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Department Name
- Department Code

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
- **owns** [[Test Pool]]
- **contains** [[User]]
- **assigned** [[Requested Test]]
- **assigned to** [[Equipment]]
- **represented by** a lab group marked as the department; its members do the department's workflow steps ([[Decision - Workflow Designer Slice Scope and Rules]])

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Department?
- What is blocking or affecting this Department?
- Which related records explain this Department?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
