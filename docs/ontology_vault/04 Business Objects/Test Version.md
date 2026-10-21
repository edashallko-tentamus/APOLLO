---
type: Business Object
domain: Laboratory Operations
capability: Test Method and Workflow Management
object_classification: Governance Object
status: Reviewed
---

# Test Version

## Definition
Approved version of a Test's scientific definition: method, procedure, workflow steps, analyte configuration, formulas and limits. Status: Draft, Effective, Superseded; one Effective version per Test. A [[Requested Test]] records the version in effect when it was ordered so later edits never change what an existing order means. Pricing is deliberately not part of the version.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Method and Workflow Management]]
- **Object classification:** [[Governance Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Version Number
- Status
- Effective From

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
- **version of** [[Test]]
- **owns** [[Workflow Version]]
- **has** [[Test Procedure]]
- **pinned by** [[Requested Test]]
- **used by** [[Test Workflow Instance]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Test Version?
- What is blocking or affecting this Test Version?
- Which related records explain this Test Version?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
