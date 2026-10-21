---
type: Business Object
domain: Security Compliance and Audit
capability: Roles and Permissions
object_classification: Governance Object
status: Reviewed
---

# Analyst Qualification

## Definition
Active qualification authorizing a User for a Test, workflow step, instrument, review activity, or category.

## Ownership
- **Core domain:** [[Security Compliance and Audit]]
- **Capability:** [[Roles and Permissions]]
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
- **belongs to** [[User]]
- **qualifies for** [[Test]]
- **may qualify** [[Workflow Step Definition]]
- **may contribute to** [[SME Status]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Analyst Qualification?
- What is blocking or affecting this Analyst Qualification?
- Which related records explain this Analyst Qualification?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Training and Competency Workflow]]
- Governed or affected by [[Workflow Step Authorization Rule]]
- Governed or affected by [[Four-Test SME Rule]]

## Built (0.31.0)
- Per person and test (AQ-), from an initial competency or as Legacy; Current, Due soon, Lapsed, Withdrawn; checked at the bench where the lab requires training. See [[Decision - Training and Competency C-1]].
