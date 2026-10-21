---
type: Business Object
domain: Sample Management
capability: Chain of Custody
object_classification: Event Object
status: Reviewed
---

# Custody Event

## Definition
Immutable custody occurrence.

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Chain of Custody]]
- **Object classification:** [[Event Object]]
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
- **belongs to** [[Chain of Custody]]
- **references** [[Custodian]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Custody Event?
- What is blocking or affecting this Custody Event?
- Which related records explain this Custody Event?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Built (0.29.0)
- Built as Received (the receiver's signed receipt: time, delivered by, tracking, temperature, condition, seals, their handwritten signature, the signed PDF) and Paper copy (the scan). Never changed. See [[Decision - Chain of Custody, Receipt Photos and Photo Reports]].
