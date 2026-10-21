---
type: Business Object
domain: Sample Management
capability: Sample Classification
object_classification: Definition Object
status: Reviewed
---

# Matrix

## Definition
Scientific material or sample matrix classification, maintained as a controlled list by administrators (see [[Decision - Matrix Is a Controlled List]]).

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Sample Classification]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Matrix Name (unique regardless of capitals; cannot be renamed once in use)
- Status: Active / Inactive (Inactive cannot be used on new samples)

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
- **classifies** [[Sample]]
- **maintained by** administrators only ([[Lab Access Rule]])

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Matrix?
- What is blocking or affecting this Matrix?
- Which related records explain this Matrix?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
