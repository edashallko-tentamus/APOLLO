---
type: Business Object
domain: Security Compliance and Audit
capability: Roles and Permissions
object_classification: Derived Value
status: Reviewed
---

# SME Status

## Definition
Category-level subject matter expert status derived after four active completed Test qualifications in the same Training Category, subject to exclusions.

## Ownership
- **Core domain:** [[Security Compliance and Audit]]
- **Capability:** [[Roles and Permissions]]
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
- **belongs to** [[User]]
- **derived from** [[Analyst Qualification]]
- **applies to** [[Training Category]]
- **governed by** [[SME Authorization Rule]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this SME Status?
- What is blocking or affecting this SME Status?
- Which related records explain this SME Status?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Training and Competency Workflow]]
- Governed or affected by [[Four-Test SME Rule]]

## Built (0.31.0)
- Built as "department trained": N current qualifications in a department (default 4, configurable), unlocking any test of it and/or training others. See [[Decision - Training and Competency C-1]].
