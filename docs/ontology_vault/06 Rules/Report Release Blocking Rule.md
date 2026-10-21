---
type: Business Rule
status: Reviewed
---

# Report Release Blocking Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Certificate of Analysis]]
- [[Technical Review]]
- [[Quality Review]]
- [[Deviation]]
- [[OOS Investigation]]
- [[Report Approval]]
- [[Client]] (Account Status On Hold blocks release; see [[Client Account Status Rule]])
- [[OOS Investigation]] (holds only the OOS result; see [[Partial Reporting Rule]])
- [[Logbook Entry]] (0.18.0: a result that used a logbook entry not approved, or with an open correction flag, is blocked; see [[Logbook Value Approval Rule]] and [[Logbook Correction Flag Rule]])

## Required behavior
This rule must be implemented through controlled configuration, evaluated consistently, and recorded in the [[Audit Trail]] when it changes a regulated state.

## Value ownership
- Inputs may include [[User Value]], [[Derived Value]], and [[System Value]].
- Outputs are generally [[Derived Value]] or [[Governance Object]] decisions.
