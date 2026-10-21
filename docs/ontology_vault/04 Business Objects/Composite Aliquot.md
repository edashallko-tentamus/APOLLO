---
type: Business Object
domain: Sample Management
capability: Sample Preparation
object_classification: Execution Object
status: Draft
---

# Composite Aliquot

## Definition
Portion created by combining two or more existing Aliquots, each traceable to its own parent Sample, for separate routing, testing, storage, or retention as a single new unit.

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Sample Preparation]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Purpose
- Total quantity
- Unit
- Assigned department

## Derived Values
- Composite Aliquot ID
- Quantity remaining
- Status
- Availability for testing
- Source Sample count

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **composed of** [[Aliquot]] (multiple)
- **traces to** [[Sample]] (via source Aliquots, multiple)
- **may be used by** [[Requested Test]]
- **stored at** [[Storage Location]]

## Governing Rules
- Governed by [[Ontology Principles]]
- See [[Decision - Composite Aliquot Aggregates From Aliquots, Not Samples]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Composite Aliquot?
- Which source Samples and Aliquots contributed to this Composite Aliquot?
- What is blocking or affecting this Composite Aliquot?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
