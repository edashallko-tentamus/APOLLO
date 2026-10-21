---
type: Business Object
domain: Laboratory Operations
capability: Test Planning Assignment and Batching
object_classification: Execution Object
status: Reviewed
---

# Requested Analyte

## Definition
An analyte ordered on a [[Requested Test]]. Removed analytes are not ordered, not billed and not reported. This is different from 'Hide Analyte' on [[Test-Analyte Configuration]], which is a test-definition setting where the analyte is analyzed and retained but not printed on the CoA.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Planning Assignment and Batching]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Analyte
- Included (Yes/No)

## Derived Values
- Analyte price contribution

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[Requested Test]]
- **references** [[Analyte]]
- **limited to** [[Quoted Analyte Selection]]

## Governing Rules
- [[Analyte Removal Pricing Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Requested Analyte?
- What is blocking or affecting this Requested Analyte?
- Which related records explain this Requested Analyte?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
