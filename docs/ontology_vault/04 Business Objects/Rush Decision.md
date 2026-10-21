---
type: Business Object
domain: Laboratory Operations
capability: Test Planning Assignment and Batching
object_classification: Event Object
status: Reviewed
---

# Rush Decision

## Definition
Intake's response to a rush request: approval of a tier that requires it, or 'Rush Not Accepted' with a replacement (a slower tier or Standard) and a reason. A Not Accepted decision recalculates the due date and fee and sends a fixed-template email automatically to the order's Ordering contact naming the staff member; staff never write or edit the email.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Planning Assignment and Batching]]
- **Object classification:** [[Event Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Decision: Approved, Not Accepted
- Replacement Tier (Not Accepted only)
- Reason

## Derived Values
- Decided By
- Decided At
- Notification sent

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **applies to** [[Requested Test]]
- **references** [[Rush Fee Tier]]
- **triggers** [[Client Notification]]
- **recalculates** [[Due Date]]

## Governing Rules
- [[Rush Approval Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Rush Decision?
- What is blocking or affecting this Rush Decision?
- Which related records explain this Rush Decision?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
