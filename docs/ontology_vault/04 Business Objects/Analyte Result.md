---
type: Business Object
domain: Laboratory Operations
capability: Result Management
object_classification: Execution Object
status: Reviewed
---

# Analyte Result

## Definition
Result for one requested analyte.

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
- **belongs to** [[Result]]
- **references** [[Analyte]]
- **uses** [[Unit of Measure]]
- **evaluated by** [[Specification Evaluation]]
- **may have** [[Result Qualifier]]

## As built (WD-3, migration 018)
- The approved result of record: one per requested test and analyte (test_result).
- It holds the value (or the qualitative value), the reported value, the batch, entry and reading it came from, and the specification it was compared with and the outcome.
- It is stored by the reviewer's signed approval and locked. A later result supersedes it, keeping both.
- See [[Decision - QC Review Build Choices]].
- WD-5 (migration 021): a result is the test's final result or a timepoint's (e.g. day 7), with stage Preliminary or Final. A preliminary result is released by a timepoint review and carried into the final one unchanged. It also records how it was reported: the only reading, one reading picked (with the justification), or the average of the readings listed. See [[Decision - Analytical Runs, Preliminary Results and Order Statuses]].
- 0.18.0 (migration 035): a result whose calculation read a logbook value (an inoculum's CFU added) keeps the value used and the entry. It waits until QA approves the entry. A later correction of that entry flags the result for a reviewer who did not make the correction; the result is never changed silently, and its release waits. See [[Logbook Value Approval Rule]], [[Logbook Correction Flag Rule]], [[Decision - Electronic Logbooks L-1 and L-2]].

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: manual result entry across analytes.

## AI Questions
- What is the current status of this Analyte Result?
- What is blocking or affecting this Analyte Result?
- Which related records explain this Analyte Result?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Electronic Logbook Calculation Workflow]]
- [[Pathogen Spike Recovery Workflow]]
