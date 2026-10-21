---
type: Business Object
domain: Laboratory Operations
capability: Analytical Execution
object_classification: Execution Object
status: Reviewed
---

# Workflow Step Instance

## Definition
Actual execution record for one workflow step.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Analytical Execution]]
- **Object classification:** [[Execution Object]]
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
- **belongs to** [[Test Workflow Instance]]
- **derived from** [[Workflow Step Definition]]
- **may become** [[Worklist Task]]
- **may use** [[Electronic Logbook]]
- **may use** [[Equipment]]
- **may create** [[Step Exception]]

## As built (WD-2, migration 016)
- One step run per workflow step per batch. Its status is Not started, In progress or Completed.
- The first value recorded starts it. It is completed with a signature ("Performed by") once nothing is missing.
- A step may have a witness ("Witnessed by"), who signs in the same dialog.
- A completed step is reopened with a signature and a reason.
- Values are kept per entry, analyte and reading. A re-analysis adds readings 2 and up, and every reading is kept.
- See [[Decision - Chemistry Execution Scope and Rules]].
- 0.18.0: a material recorded at a step carries the logbook entry of its lot (shown as `INV-… · LBE-…`); a lot past its validity is refused. At a Weighing step, **Scan aliquot** fills the sample's weight and records its balance from the sample weights logbook; a typed weight cannot replace it. A step that used equipment while its logbook check was failing is flagged in QC Review. See [[Aliquot Weight Review Rule]], [[Logbook Failure Flag Rule]], [[Decision - Electronic Logbooks L-1 and L-2]].

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Workflow Step Instance?
- What is blocking or affecting this Workflow Step Instance?
- Which related records explain this Workflow Step Instance?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Requested Test Execution Workflow]]
