---
type: Business Object
domain: Laboratory Operations
capability: Technical Review and Completion
object_classification: Execution Object
status: Reviewed
---

# Retest

## Definition
A controlled repeat of a test, always linked to the original Requested Test and result, which is never overwritten. Two kinds: Re-analysis puts the already-prepared test sample back on the instrument in a new analytical batch (a lab investigation tool). Re-prep prepares a new test sample from retained material and analyzes it in a new batch, starting from scratch. A client-requested OOS retest is always a re-prep.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Technical Review and Completion]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Retest Type: Re-analysis, Re-prep
- Source: Client OOS Retest, Lab Investigation (non-billable)
- TAT: Standard or a rush tier (client retests)
- Analytes (client retests default to the OOS analytes; client may add others from the original order)

## Derived Values
- Billing Status: Pending QA Determination, Billable, Non-billable
- Result differs from original (information only)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **repeats** [[Requested Test]]
- **may be triggered by** [[OOS Investigation]]
- **draws from** [[Sample]] (requires retained material)
- **has** [[Retest Determination]]
- **reported on** [[Certificate of Analysis]] (new CoA)

## Governing Rules
- [[Retest Billing Rule]]
- [[Quoted-Only Ordering Rule]]
- [[TAT Clock Start Rule]]
- [[Retained Sample Threshold Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Retest?
- What is blocking or affecting this Retest?
- Which related records explain this Retest?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
