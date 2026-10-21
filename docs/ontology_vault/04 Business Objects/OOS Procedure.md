---
type: Business Object
domain: Quality Review and Reporting
capability: Deviations and Investigations
object_classification: Definition Object
status: Reviewed
---

# OOS Procedure

## Definition
The investigation procedure applied to an OOS result. Two are defined. Full Phase I (21 CFR 211): analyst, supervisor and QA sections each e-signed, enforced hypothesis-testing and re-analysis rules, invalidation only with a documented assignable cause and QA approval. Check and Acknowledge: a short checklist and one reviewer e-signature; invalidation needs a documented reason. Checklist items are configuration, not code, so non-pharma labs can define theirs later. The Check and Acknowledge record also serves as the ISO 17025 nonconforming-work record (clause 7.10).

## Ownership
- **Core domain:** [[Quality Review and Reporting]]
- **Capability:** [[Deviations and Investigations]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Procedure Name
- Checklist items
- Required signatures
- Target times (open within, close within)

## Derived Values
- None

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **applied to** [[OOS Investigation]]
- **default for** [[Laboratory Site]]
- **required by** [[Client]] (Regulated GMP clients always get Full Phase I)

## Governing Rules
- [[OOS Investigation Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this OOS Procedure?
- What is blocking or affecting this OOS Procedure?
- Which related records explain this OOS Procedure?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
