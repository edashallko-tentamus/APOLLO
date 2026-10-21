---
type: Business Object
domain: Laboratory Operations
capability: Test Method and Workflow Management
object_classification: Definition Object
status: Reviewed
---

# Specification

## Definition
Acceptance criterion or reportable specification. Set per quoted test (copied to every test ordered from that quote) or per requested test. No specification means unspecified: the client gets the result as it is. See [[Decision - Workflow Designer Slice Scope and Rules]].

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Method and Workflow Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Analyte
- Minimum, Maximum, Text limit (e.g. Absent in 10 g)
- Unit
- Set by (Lab, Client, Client portal)

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
- **evaluated by** [[Specification Evaluation]]
- **applies to** [[Analyte Result]]
- **may reference** [[Threshold Rule]] (optional — for warning-zone/trending math only; pass/fail determination stays with Specification Evaluation)

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: specification limits per analyte.

## AI Questions
- What is the current status of this Specification?
- What is blocking or affecting this Specification?
- Which related records explain this Specification?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
