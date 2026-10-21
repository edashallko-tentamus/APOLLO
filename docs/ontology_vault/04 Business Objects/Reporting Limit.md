---
type: Business Object
domain: Laboratory Operations
capability: Test Method and Workflow Management
object_classification: Definition Object
status: Reviewed
---

# Reporting Limit

## Definition
Controlled reporting threshold such as LOQ, LOD, RL, or client-specific reporting limit.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Method and Workflow Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Limit Type (LOQ, LOD, RL, or client-specific)
- Value
- Unit (link to [[Unit of Measure]])
- Hide on Report (boolean — the value is still calculated and retained, just excluded from the Certificate of Analysis; independent per Limit Type, so LOQ and LOD on the same analyte can be hidden independently of each other)

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
- **applies to** [[Test-Analyte Configuration]]
- **applies to** [[Analyte Result]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: limits for many analytes at once.

## AI Questions
- What is the current status of this Reporting Limit?
- What is blocking or affecting this Reporting Limit?
- Which related records explain this Reporting Limit?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
