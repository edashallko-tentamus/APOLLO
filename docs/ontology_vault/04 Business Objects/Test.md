---
type: Business Object
domain: Laboratory Operations
capability: Test Method and Workflow Management
object_classification: Definition Object
status: Reviewed
---

# Test

## Definition
The report-facing, client-orderable test identity: what appears in the catalogue, on the quote and on the Certificate of Analysis. The analytical method underneath is [[Method]] (see [[Decision - Method Is Separate From Test and Test Procedure]]). Scientific content is versioned on [[Test Version]]; commercial terms live on [[Test Catalog Entry]].

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Method and Workflow Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Test Name
- Test Code

## Derived Values
- Current Effective Version

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **has** [[Test Version]]
- **uses** [[Method]]
- **contains** [[Test-Analyte Configuration]]
- **uses** [[Calculation Formula]]
- **uses** [[Unit of Measure]]
- **requires** [[Test Material Requirement]]
- **requires** [[Equipment]]
- **owns** [[Test Workflow]]
- **belongs to** [[Training Category]]
- **sold as** [[Test Catalog Entry]]
- **referenced by** [[Requested Test]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Test?
- What is blocking or affecting this Test?
- Which related records explain this Test?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
