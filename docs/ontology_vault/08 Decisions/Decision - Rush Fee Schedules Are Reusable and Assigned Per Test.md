---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Rush Fee Schedules Are Reusable and Assigned Per Test

Rush pricing is a named, reusable [[Rush Fee Schedule]] (for example micro differs from chemistry) with tiers, assigned per test in the designer. Clients can select any tier without approval unless the tier is marked Requires Intake Approval (schedule default, overridable per test). Auto-accepted rushes flag the intake dashboard; approval-required rushes notify intake, run at standard TAT and price until approved, and escalate if ignored. Rush Not Accepted sends a fixed automatic email. See [[Rush Approval Rule]].

See [[Ontology Principles]].
