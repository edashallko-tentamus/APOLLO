---
type: Business Object
domain: Laboratory Operations
capability: Test Method and Workflow Management
object_classification: Definition Object
status: Reviewed
---

# Method

## Definition
The lab's own analytical method identity — owned and named by the lab, referencing the controlled SOP that governs it. Distinct from Test Name (the report/catalog-facing identity) and from SOP Code (the exact controlled document reference in the QMS, outside LIMS). A Method Name may reference an external standard method (e.g. a USP monograph) while the SOP Code is Tentamus's own internal document control number for how that method is actually performed — the two commonly differ and both are needed. Reusable — more than one Test may be built on the same Method.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Method and Workflow Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Method Name (lab-owned; may reference an external standard, e.g. "USP <232>")
- SOP Code (the controlled document reference in the QMS, outside LIMS)
- SOP Document (optional file upload)
- SOP Link (optional URL to the controlled document, e.g. in an external QMS) — Document and Link are both optional; a Method commonly has one or the other, not necessarily both

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
- **used by** [[Test]] (multiple — one Method may back more than one Test)

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]
- See [[Decision - Method Is Separate From Test and Test Procedure]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Method?
- Which Tests are built on this Method?
- What is blocking or affecting this Method?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
