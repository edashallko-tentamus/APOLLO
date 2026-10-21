---
type: Business Object
domain: Laboratory Operations
capability: Result Management
object_classification: Execution Object
status: Reviewed
---

# Calculation

## Definition
Executed calculation using controlled formula and referenced inputs.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Result Management]]
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
- **uses** [[Calculation Formula]]
- **may reference** [[Logbook Entry]]
- **produces** [[Derived Value]]
- **supports** [[Analyte Result]]

## As built (0.18.0, migration 035)
- A formula token whose field is not one of its step's own fields reads a value published by a logbook entry: `{inoc.cfu_added}` is the CFU added from the logbook entry of the lot scanned at the step `inoc`. The designer offers the lab's published values on steps that take materials.
- A lot that names organisms serves only those analytes. Until its entry is approved the result waits ("Waiting for QA to approve LBE-…"), and the Calculation step cannot be completed.
- Logbook fields have their own formulas: `{field}` for a field before it, `{lot_field.passage}` for a value published on a Lot field's lot.
- The workflow verification picks an approved lot per analyte and scans it in its run.
- See [[Logbook Value Approval Rule]], [[Decision - Electronic Logbooks L-1 and L-2]].

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Calculation?
- What is blocking or affecting this Calculation?
- Which related records explain this Calculation?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Electronic Logbook Calculation Workflow]]
