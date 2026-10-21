---
type: Architecture Decision
status: Approved
---

# Decision - Equipment Tag Unified Reason Field Resolves Calibration Block

Flagged in review: [[Equipment Tag]] blocked Workflow Step Instance, and separately [[Calibration]] "may block" the same target independently — an inconsistency with the rest of the capability, where triggers (like [[Maintenance Schedule]]) create a Tag rather than blocking directly.

Resolved: [[Equipment Tag]] gains a Reason field (Maintenance, Repair, Calibration). It is the single blocking mechanism. A [[Calibration]] record expiring no longer blocks anything itself — it triggers a new Equipment Tag (Reason: Calibration) via [[Threshold Rule]], the same pattern Maintenance Schedule already used for scheduled tag-outs. See [[Decision - Calibration Expiration Auto-Tags Equipment]] for the trigger mechanics.

See [[Ontology Principles]].
