---
type: Business Rule
status: Approved
---

# Rush Approval Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Requested Test]]
- [[Rush Fee Tier]]
- [[Test Catalog Entry]]
- [[Rush Decision]]
- [[Lab Order]]

## Required behavior
- Each rush tier is either auto-accepted or Requires Intake Approval. The schedule sets the default; each test may override it in the Test Workflow Designer.
- Auto-accepted rush: no approval needed. The order appears on the intake dashboard flagged Rush Incoming so intake can plan.
- Approval-required rush: the test shows Rush Pending Approval on the intake dashboard and raises a notification (lower right corner) routed to the intake [[Team]]. Until approved, the test runs on standard TAT and standard price; the rush fee is charged only after approval.
- An unanswered approval escalates to the lab manager after the tier's escalation time.
- Rush Not Accepted: intake selects a replacement (slower tier or Standard) and a reason. The due date and fee recalculate and a fixed-template email is sent automatically to the Ordering contact naming the staff member. Staff do not write or edit the email. All decisions are audited.

## Value ownership
- Inputs: Rush tier, approval setting, intake decision
- Outputs: Rush Status, Due Date, Rush Fee, Client Notification

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
