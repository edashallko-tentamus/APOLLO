---
type: Business Rule
status: Approved
---

# Client Account Status Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Client]]
- [[Lab Order]]
- [[Report Release]]
- [[Client Report]]

## Required behavior
- Active: orders, sample login, testing and report release all allowed.
- On Hold: orders, sample login and testing are allowed; release and sending of reports is blocked until the hold is lifted.
- Inactive: no new orders; reports may still be released for work already in the lab.
- Status applies only to the client it is set on and never cascades to child clients. Every change requires a Reason for Change and is audited.

## Value ownership
- Inputs: Client Account Status
- Outputs: Can Order, Can Release Reports (Derived Values); blocks on Lab Order creation and report release

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
