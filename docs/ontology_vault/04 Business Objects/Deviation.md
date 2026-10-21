---
type: Business Object
domain: Quality Review and Reporting
capability: Deviations and Investigations
object_classification: Governance Object
status: Reviewed
---

# Deviation

## Definition
Controlled record of departure from approved procedure or expectation.

## Ownership
- **Core domain:** [[Quality Review and Reporting]]
- **Capability:** [[Deviations and Investigations]]
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
- **may affect** [[Sample]]
- **may affect** [[Requested Test]]
- **may affect** [[Result]]
- **may affect** [[Equipment]]
- **may block** [[Report Release]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Deviation?
- What is blocking or affecting this Deviation?
- Which related records explain this Deviation?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
- Governed or affected by [[Report Release Blocking Rule]]
