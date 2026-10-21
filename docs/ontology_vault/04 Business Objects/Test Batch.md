---
type: Business Object
domain: Laboratory Operations
capability: Test Planning Assignment and Batching
object_classification: Execution Object
status: Reviewed
---

# Test Batch

## Definition
Method-specific grouping of compatible Requested Tests for efficient preparation or execution.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Planning Assignment and Batching]]
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
- **contains** [[Requested Test]]
- **contains** QC entries generated per its [[Batching Rule]] (Prep QC and Analytical QC classes)
- **created by** [[Batching Rule]]
- **supports per-entry material tagging** via [[Material Usage Record]] — right-click any batch entry (sample or QC) at execution to Spike with an inventory item (Usage Type: Spike, feeds recovery calculation) or Add an inventory item (Usage Type: Consumable, e.g. pipette tips, matrix material). Deliberately a per-batch action, not preset at Test-definition time.
- **assigned as** [[Worklist Task]]
- **may become** [[Analytical Run]]

## As built (WD-2, migration 016)
- A batch has a code (BAT-000001), a lab, a test and its version, a department, a status and the person it is assigned to.
- Its status is Open, In Progress, Awaiting Review, Approved or Cancelled. The steps set it; nobody changes it by hand.
- Entries are samples (requested tests, or re-preps with a replicate number) and QC (QC type, Prep or Analytical). Each has its position in the run order.
- A matrix spike names the sample it is made from.
- A re-prepped entry is superseded with its reason and keeps its data.
- Each workflow step gets one [[Workflow Step Instance]] in the batch.
- Materials (lot, purpose, spike volume) and equipment are recorded per entry or for the whole batch. Raw data files attach to a step.
- See [[Decision - Chemistry Execution Scope and Rules]].
- WD-5 (migration 021): a reading step can hold several analytical runs, each with its own readings, raw data file, instrument and analytical QC. Re-readings are labelled RA1-, RA2-..., re-preps RP1-, RP2-... A batch with released preliminary results cannot be cancelled. See [[Decision - Analytical Runs, Preliminary Results and Order Statuses]].

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: batch result and QC entry.

## AI Questions
- What is the current status of this Test Batch?
- What is blocking or affecting this Test Batch?
- Which related records explain this Test Batch?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Auto-Batching and Analyst Assignment Workflow]]
- Governed or affected by [[Auto-Batching Rule]]
