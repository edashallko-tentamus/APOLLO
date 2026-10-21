---
type: Business Object
domain: Sample Management
capability: Sample Intake
object_classification: Execution Object
status: Reviewed
---

# Sample

## Definition
Central laboratory record for submitted material; multiple physical units may collectively be one Sample and one Sample ID.

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Sample Intake]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Client Sample ID
- Description
- Matrix
- Product
- Lot
- Batch
- Quantity received
- Number of units
- Unit types
- Condition
- Receipt temperature
- Preservation
- Received by
- Sample ID assigned at logging: SITEyymmdd### (e.g. CFL261012001; see [[Decision - Sample ID Format Is SITEyymmdd Three-Digit Sequence]])
- Logged at / logged by (starts the clock) and Received at (physical arrival, chain of custody)
- Matrix: chosen from the controlled [[Matrix]] list (see [[Decision - Matrix Is a Controlled List]])
- Storage Location and Retained Quantity (see [[Decision - Sample Storage and Retained Quantity Are in the Inventory Slice]])

## Derived Values
- Laboratory Sample ID
- Barcode
- Status
- Current custody
- Current storage location
- Retention status
- Calculated Disposal Date
- Retained Quantity

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **derived from** [[Expected Sample]]
- **has** [[Sample Identifier]]
- **has** [[Barcode]]
- **classified by** [[Matrix]]
- **associated with** [[Product]]
- **associated with** [[Lot]]
- **associated with** [[Batch]]
- **governed by** [[Chain of Custody]]
- **subdivides into** [[Aliquot]]
- **quantity reduced by** [[Aliquot]] (creation of any Aliquot decrements Retained Quantity)
- **traced to by** [[Composite Aliquot]] (via source Aliquots)
- **stored at** [[Storage Location]]
- **governed by** [[Retention Policy]]
- **has** [[Requested Test]]
- **may be held for** [[Stability Study]] (one study sample per condition; quantity reduced by each [[Stability Pull]])
- **belongs to** [[Lab Order]]
- **has projects applied** [[Project]] (per sample)

## Governing Rules
- Governed by [[Ontology Principles]]
- [[Lab Access Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: batch sample login.

## AI Questions
- What is the current status of this Sample?
- What is blocking or affecting this Sample?
- Which related records explain this Sample?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Commercial to Sample Intake Workflow]]
- [[Pathogen Spike Recovery Workflow]]
- Governed or affected by [[Calculated Disposal Date Rule]]
- Governed or affected by [[Retained Sample Threshold Rule]]
