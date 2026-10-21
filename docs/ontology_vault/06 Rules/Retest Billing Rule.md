---
type: Business Rule
status: Approved
---

# Retest Billing Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Retest]]
- [[Retest Determination]]
- [[Requested Test]]
- [[Invoice Line Item]]
- [[Client Notification]]

## Required behavior
- Releasing a confirmed OOS result automatically emails the Report and Quality contacts the CoA with a Request Re-prep link. The email is sent on release, never on detection.
- A client retest is always a re-prep from retained sample, requested while retained material exists (insufficient material prompts a request for more). The client selects Standard or a rush tier, and the retest returns to the testing pool.
- Client retests default to the OOS analytes only; the client may add others from the original order. Price comes from the original quote line.
- Billing is Pending until QA records a [[Retest Determination]]: Confirmed OOS and Inconclusive are billable; Lab Error is non-billable including the rush fee.
- A differing retest result alone never establishes lab error.
- On the invoice (I-1, migration 036, [[Decision - Invoicing I-1]]): a retest is its own line, labelled Retest, naming the test it repeats, the OOS investigation and who ordered it, and "not charged" when non-billable. A retest waiting for QA's determination is not ready to invoice. A test replaced by a lab investigation retest is billed (as ordered) once the retest is reported.

## Value ownership
- Inputs: OOS release, retest request, QA determination
- Outputs: Client Notification, Retest, billing status

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
