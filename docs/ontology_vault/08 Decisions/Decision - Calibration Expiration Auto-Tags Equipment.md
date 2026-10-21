---
type: Architecture Decision
status: Approved
---

# Decision - Calibration Expiration Auto-Tags Equipment

A [[Threshold Rule]] instance evaluates each Equipment's Current Calibration Expiration Date: Days Until/Since type, Alert at 30 days before expiration (default — not confirmed with the lab, adjust as needed), Deficient once expired. Reaching Deficient automatically creates an [[Equipment Tag]] (Reason: Calibration), which blocks [[Workflow Step Instance]] the same way any other active Tag does.

The same Threshold Rule breach also creates a [[Notification]] delivered to the Equipment's responsible parties (Team and/or User — see [[Decision - Equipment Ownership Is Multi-Party and Required]], fanned out to each individual when delivered to a Team) and a [[Worklist Task]] referencing the Equipment in each recipient's Analyst Worklist — surfacing on their dashboard as an actionable item, not just a passive alert. Since Equipment is now required to have at least one responsible party, the earlier open question about a missing fallback recipient no longer applies.

See [[Ontology Principles]].
