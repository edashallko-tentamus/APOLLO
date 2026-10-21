---
type: Business Object
domain: Laboratory Operations
capability: Electronic Logbooks
object_classification: Execution Object
status: Reviewed
---

# Logbook Entry

## Definition
Structured observation, measurement, count, note, or input within a logbook.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Electronic Logbooks]]
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
- **belongs to** [[Electronic Logbook]]
- **may be used by** [[Calculation]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: repeated logbook readings.

## AI Questions
- What is the current status of this Logbook Entry?
- What is blocking or affecting this Logbook Entry?
- Which related records explain this Logbook Entry?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Electronic Logbook Calculation Workflow]]
- [[Pathogen Spike Recovery Workflow]]

## As built (0.18.0, migrations 034 and 035)
See [[Decision - Electronic Logbooks L-1 and L-2]].
- **User Values:** when, the equipment / lot / sample it is about, the field values, the reason when it fails.
- **Derived Values:** entry code (LBE-000001), calculated values, result (Pass / Fail), values outside their limits, usable until (validity), the lot it made, review due date and overdue.
- **System Values:** status (Recorded, Approved, Returned, Voided), approved by / in batch, the recording signature.
- **Rules:** a failure needs its reason; equipment and lots used must be usable; no future entries; corrections need a reason (an approved entry goes back to QA); an entry used at the bench or by a result is corrected, never voided; nobody approves an entry they recorded or corrected.
- **Relationships:** **may make** [[Inventory Lot]]; **may be scanned at** [[Workflow Step Instance]] (with the material); **may be used by** [[Analyte Result]] (the values used are kept; a later correction flags the result); **flags** batch steps that used failing equipment.
