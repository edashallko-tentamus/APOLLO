---
type: Business Object
domain: Laboratory Operations
capability: Test Planning Assignment and Batching
object_classification: Definition Object
status: Reviewed
---

# Batching Rule

## Definition
Rule grouping compatible Requested Tests by Test, version, matrix, preparation, calibration range, instrument, QC, capacity, and due date.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Planning Assignment and Batching]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Max Samples Per Batch (client/non-QC samples only — required QC entries add on top of this number, they do not consume it)
- Required QC Types (CCV, ICV, Method Blank, Instrument Blank, Matrix Spike, Suitability Control Sample, Tailing Factor Control, Matrix Spike Duplicate, Reference Sample, Positive Control, Negative Control), each configured with:
  - QC Class: Prep QC (created at batch assembly and travels through the sample prep workflow like a real sample — weighed, digested, diluted — e.g. Matrix Spike, Method Blank) or Analytical QC (instrument-sequence only, does not go through prep — e.g. CCV, ICV)
  - Frequency: Once per batch (with a count), or Every N samples (interval — produces bracketing entries, opening plus closing: every 20 on a 20-sample batch creates 2)
  - No material assignment here — spiking and material tagging are deliberately NOT preset at Test-definition time. They happen per batch at execution, via right-click on any batch entry (see [[Test Batch]]), for flexibility.

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
- **evaluates** [[Test Pool]]
- **creates** [[Test Batch]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]
- Defined at Test-creation time via the workflow step builder's Batching step type — see [[Decision - Workflow Step Types Cascade Under One Definition Object]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Batching Rule?
- What is blocking or affecting this Batching Rule?
- Which related records explain this Batching Rule?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Auto-Batching and Analyst Assignment Workflow]]
- Governed or affected by [[Auto-Batching Rule]]
