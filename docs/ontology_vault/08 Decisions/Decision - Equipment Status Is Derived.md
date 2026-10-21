---
type: Architecture Decision
status: Approved
---

# Decision - Equipment Status Is Derived

[[Equipment Status]] is not an independently settable field. Several of its enumerated values (tagged out, under maintenance, under calibration) already correspond exactly to what an active [[Equipment Tag]] and its Reason represent. Making Status independently settable would let it disagree with whether a Tag is actually active — the same risk closed elsewhere in this project (Inventory Lot's Purchase Status, Supplier's Approval Status). Status is instead fully derived from the currently active Equipment Tag's Reason, or "Available" when none exists. Retired and Out of Service remain administrative actions outside the Tag mechanism.

See [[Ontology Principles]].
