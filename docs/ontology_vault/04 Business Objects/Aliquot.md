---
type: Business Object
domain: Sample Management
capability: Sample Preparation
object_classification: Execution Object
status: Reviewed
---

# Aliquot

## Definition
Portion subdivided from one parent Sample for separate routing, testing, storage, or retention.

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Sample Preparation]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Purpose
- Quantity
- Unit
- Assigned department

## Derived Values
- Aliquot ID
- Quantity remaining
- Status
- Availability for testing

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[Sample]]
- **may be used by** [[Requested Test]]
- **may be combined into** [[Composite Aliquot]]
- **stored at** [[Storage Location]]

## As built (0.18.0, migration 035)
- Built as an entry in a **sample weights logbook** (pre-analytical): intake weighs a test aliquot, records the balance and weight, and labels it with the entry code (LBE-), its barcode.
- Scanned at a test's Weighing step, it fills the sample's weight and the balance; a repeat weighing is a new aliquot scanned in its place, and both stay visible.
- Reviewed inside the batch that uses it, not by QA in the logbook. See [[Aliquot Weight Review Rule]], [[Decision - Electronic Logbooks L-1 and L-2]].

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: creating several aliquots from one sample.

## AI Questions
- What is the current status of this Aliquot?
- What is blocking or affecting this Aliquot?
- Which related records explain this Aliquot?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
