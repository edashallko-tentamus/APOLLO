---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Lab Supervisor Approves Reorders Until Purchasing Exists

A reorder creates a pending [[Inventory Lot]] (Purchase Status: Approved only after a Lab Supervisor approves it on the lot). When the Purchasing module is built, its approval queue takes over this step. See [[Decision - Purchase Status Lives on Inventory Lot]].

See [[Ontology Principles]].
