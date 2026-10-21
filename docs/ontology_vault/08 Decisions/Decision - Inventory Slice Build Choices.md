---
type: Architecture Decision
status: Proposed
decided: 2026-10-12
---

# Decision - Inventory Slice Build Choices

Choices made while building the Inventory slice (migration 005) that were not explicitly decided with Alex. Each is easy to change; confirm or correct them.

- **Wrong storage condition is refused**, not just warned: a lot or sample cannot be put in a [[Storage Location]] that does not provide the condition it needs (see [[Decision - Storage Location and Supplier Defined]]).
- **A purchase starts as Requested**, before Approved, so the Lab Supervisor's approval is a recorded step (see [[Decision - Lab Supervisor Approves Reorders Until Purchasing Exists]]).
- **Quantity received and unit are locked after receipt**; stock is corrected with an Adjustment, so the receipt record never changes.
- **Default warning thresholds:** low stock below 20% of the amount received, expiring within 30 days, retained sample below 25% of the amount received.
- **Storage locations and warning rules** are maintained by the same group as the Chemical list (Lab Supervisors, QA, General Managers, administrators).
- **Every lot gets a lab ID** (INV-000001); for an in-house mixture it is the Resource ID.
- **Interim job role** on each user (Analyst, Intake, Lab Supervisor, QA, General Manager, Account Manager), set by administrators and audited, until [[Role]] and [[Permission]] are built.
- **Dates follow the lab's time zone** (receipt date, expiry checks).
- **AI COA reading** is built but off until an API key is approved (see [[Decision - AI Reads Uploaded Supplier COAs and Proposes Values]]).

See [[Ontology Principles]].
