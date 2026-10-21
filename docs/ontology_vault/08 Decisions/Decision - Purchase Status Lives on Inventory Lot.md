---
type: Architecture Decision
status: Approved
---

# Decision - Purchase Status Lives on Inventory Lot

A purchased item does not wait until physical receipt to appear as an inventory item — it exists as an unfinished [[Inventory Lot]] from the moment its [[Supply Purchase Order Line]] is approved, carrying Purchase Status (Approved, Ordered, Received). Most physical fields (Manufacturer lot, Expiration date, Purity/Potency) stay blank until Received. [[Use Eligibility]] is false for the whole Approved/Ordered period — the lab can see the item is coming but cannot use it. This is a single-object design: no separate "Purchase Request" object exists in parallel to Inventory Lot.

The Reorder action — available on any [[Inventory Lot]] from both the inventory list screen and the item detail screen, not only expired or negative ones — creates a new [[Supply Purchase Order Line]] requiring supervisor role/permission to approve. The approval queue itself (where supervisors approve requests and create new orders directly, described as cyclical — the same screen serves both actions) is the Purchasing module and is explicitly out of scope for now.

See [[Ontology Principles]].
