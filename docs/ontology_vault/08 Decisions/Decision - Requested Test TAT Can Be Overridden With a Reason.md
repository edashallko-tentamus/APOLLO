---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Requested Test TAT Can Be Overridden With a Reason

Intake or the lab can override the turnaround of an individual [[Requested Test]] (a whole number of days, zero or more). The override replaces the calculated TAT (standard or rush) and moves the due date, but never changes the price or the rush fee: a longer or shorter promise is a service decision, not a commercial one. It always needs a Reason for Change and is audited. Clearing the override restores the calculated TAT and due date. Built in migration 004.

See [[Ontology Principles]].
