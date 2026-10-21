---
type: Business Rule
status: Reviewed
---

# Part 11 Logbook Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Electronic Logbook]]
- [[User Authentication]]
- [[Electronic Signature]]
- [[Audit Trail]]
- [[Record Lock]]
- [[Reason for Change]]

## Required behavior
This rule must be implemented through controlled configuration, evaluated consistently, and recorded in the [[Audit Trail]] when it changes a regulated state.

## Value ownership
- Inputs may include [[User Value]], [[Derived Value]], and [[System Value]].
- Outputs are generally [[Derived Value]] or [[Governance Object]] decisions.

## As built (0.18.0, migration 034)
- A logbook's design is versioned; QA approves a Draft with a signature and never someone who designed it. Changes to a Draft need a reason.
- Entries are signed by default ("Recorded by", one signature for a grid of entries), switchable per logbook to recorded without a signature.
- A failing entry needs its reason. Entries in the future are refused. Equipment and lots used in an entry must be usable.
- Corrections need a reason (and a signature when the logbook signs); the old values stay in the audit trail; an approved entry that is corrected goes back to QA. Voiding needs a reason; an entry used at the bench or by a result is corrected, never voided.
- QA approves entries daily or weekly, per logbook, with one signature for the ticked entries; nobody approves an entry they recorded or corrected. Late approvals are shown as overdue.
- See [[Decision - Electronic Logbooks L-1 and L-2]].
