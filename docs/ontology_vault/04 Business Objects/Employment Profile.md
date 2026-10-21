---
type: Business Object
domain: Security Compliance and Audit
capability: User and Identity Management
object_classification: Definition Object
status: Reviewed
---

# Employment Profile

## Definition
Employment and labor-cost profile linked to a User.

## Ownership
- **Core domain:** [[Security Compliance and Audit]]
- **Capability:** [[User and Identity Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Job title
- Position
- Hire date
- Salary
- Hourly Rate
- Employment type
- Shift
- Supervisor
- Cost center
- Standard hours

## Derived Values
- Hourly Cost
- Fully Burdened Hourly Cost
- Capacity Remaining
- Scheduled Labor Cost

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[User]]
- **includes** [[Salary]]
- **includes** [[Hourly Rate]]
- **belongs to** [[Department]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Employment Profile?
- What is blocking or affecting this Employment Profile?
- Which related records explain this Employment Profile?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
