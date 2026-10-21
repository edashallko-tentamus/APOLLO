---
type: Business Object
domain: Laboratory Operations
capability: Test Planning Assignment and Batching
object_classification: Execution Object
status: Reviewed
---

# Requested Test

## Definition
A test ordered on a Sample. It always traces to an accepted [[Quoted Test Configuration]] (the source of its price) and records the [[Test Version]] in effect when ordered. It enters the testing pool as soon as it is logged, even after the cutoff time, so late staff can start it; only the due date moves.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Planning Assignment and Batching]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Selected analytes (may remove analytes, never add unquoted ones)
- Rush Tier (or Standard)
- Priority override
- Special instructions
- TAT Override (days; Reason for Change required; price and rush fee unchanged; see [[Decision - Requested Test TAT Can Be Overridden With a Reason]])

## Derived Values
- Price (new list price x (1 - quoted discount %), dollar difference always shown)
- Rush Fee
- Rush Status: None, Auto-accepted, Pending Approval, Approved, Not Accepted
- Clock Start (Day 0)
- Due Date
- Current status
- Backlog status
- Estimated completion date
- OOS hold (only this result is held while its investigation is open)
- Clock start: sample logging time, or the time the test was added if the sample was already logged

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **created from** [[Quoted Test Configuration]]
- **pins** [[Test Version]]
- **applies to** [[Sample]]
- **may apply to** [[Aliquot]]
- **references** [[Test]]
- **contains** [[Requested Analyte]]
- **may select** [[Rush Fee Tier]]
- **has** [[Rush Decision]]
- **has** [[Due Date]]
- **enters** [[Test Pool]]
- **may appear in** [[Backlog]]
- **may belong to** [[Test Batch]]
- **creates** [[Test Workflow Instance]]
- **produces** [[Result]]
- **may be repeated by** [[Retest]]

## Governing Rules
- [[Quoted-Only Ordering Rule]]
- [[Analyte Removal Pricing Rule]]
- [[TAT Clock Start Rule]]
- [[Rush Approval Rule]]
- [[Rush Fee Calculation Rule]]
- [[Delayed TAT Rule]]
- Governed by [[Ontology Principles]]
- [[Lab Access Rule]]

## Related Workflows
- [[Requested Test Execution Workflow]]

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- When is this test due, and why?
- Is the rush on this test approved?
- Which quote line priced this test?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
