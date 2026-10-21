---
type: Architecture Decision
status: Approved
---

# Decision - Resource Consumption Flags Negative, Blocks on Expiration

When an [[Inventory Lot]] is added to a test workflow or batch (creating a [[Material Usage Record]]), two independent checks apply. A resulting negative [[Quantity On Hand]] does not block the action — it is flagged via [[Alert]] and [[Notification]] to the user, per [[Resource Consumption Negative Flag Rule]], consistent with [[Decision - Inventory May Become Negative]]. Expiration status, by contrast, blocks the action outright, per [[Expired Inventory Blocking Rule]]. These are deliberately asymmetric: quantity shortfall is a workflow problem the lab can absorb and reconcile; using expired material is not.

[[Material Usage Record]] moves from Laboratory Operations/Analytical Execution to Inventory and Laboratory Resources/Resource Consumption as a consequence — it is the object where inventory gets consumed, even though it is created during test execution.

See [[Ontology Principles]].
