---
type: Business Rule
status: Reviewed
---

# Equipment Return-to-Service Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Maintenance Logbook]]
- [[Equipment Document]]
- [[Calibration]]
- [[Qualification]]
- [[Release Approval]]
- [[Equipment Tag]]
- [[Electronic Signature]]

## Required behavior
Closing an active [[Equipment Tag]] (Tag-In) always requires a Tag-In [[Electronic Signature]]. For Reason: Repair, Calibration, or Qualification, Tag-In additionally requires [[Release Approval]] from a User holding the relevant QA approval [[Permission]] (via a directly assigned Role or via Team membership) — and that User must be a different individual than whoever performed the Tag-Out or the underlying repair/calibration/qualification work. This is a confirmed hard requirement, not a role-name check: the gate is holding the right Permission plus not being the same person, not simply "assigned to a Role called QA." For Reason: Maintenance, only the Tag-In signature and the [[Maintenance Event]] summary are required (document attachment optional, never a hard requirement).

## Value ownership
- Inputs: Equipment Tag Reason, current Calibration/Qualification status.
- Outputs: Tag-In Signature (required), Release Approval (conditionally required), Equipment Tag closure.
