---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Build Order Is Inventory Before the Workflow Designer

After Sample Management (slices 1 and 2), the next slice is Inventory, then the Test Workflow Designer and result entry. This restores the agreed build order (Sample Management, then Inventory and onward) and follows the dependency direction: workflow steps consume [[Inventory Lot]]s (Material Usage Record, titrant concentration), so lots must exist before the steps that use them.

See [[Ontology Principles]].
