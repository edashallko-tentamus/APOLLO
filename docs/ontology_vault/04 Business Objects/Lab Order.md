---
type: Business Object
domain: Commercial
capability: Service Requests and Projects
object_classification: Execution Object
status: Reviewed
---

# Lab Order

## Definition
The samples a client orders at one time (formerly Client Order; also called a work order in some labs, but 'Work Order' is reserved for [[Maintenance Work Order]]). Covers every submission channel. A Lab Order can span several Projects: projects are applied per sample, so samples 1 to 5 may run Project A and samples 6 to 10 Project B. Stability work creates Lab Orders automatically: one for T0 baseline at placement and one for each pull on its pull date.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Service Requests and Projects]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Client
- Ordering Contact
- Submission Channel: Online, Walk-in, Paper, Phone
- Origin: Client Submission, Stability Baseline, Stability Pull
- Purchase Order Number
- Rush Tier (order-level default; may be overridden per Requested Test)
- Received Date and Time
- Status: Draft, Submitted, Received, In Testing, Complete, Reported (see [[Decision - Lab Order Statuses]])

## Derived Values
- Order Due Date (latest Sample due date)
- Rush Incoming flag
- Projects on Order (derived from its Samples)
- Billable Total

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **placed for** [[Client]]
- **placed by** [[Contact]]
- **submitted through** [[Client Portal]] (Online)
- **entered by** [[User]] (Walk-in, Paper, Phone)
- **creates** [[Expected Sample]]
- **contains** [[Sample]]
- **may be created by** [[Stability Pull]]
- **received at** [[Laboratory Site]]

## Governing Rules
- [[Client Account Status Rule]]
- [[Quoted-Only Ordering Rule]]
- [[Rush Approval Rule]]
- [[TAT Clock Start Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- [[Commercial to Sample Intake Workflow]]

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- Which samples and tests are on this order, and when is each due?
- Is any rush on this order pending approval?
- Why can't the report for this order be released?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
