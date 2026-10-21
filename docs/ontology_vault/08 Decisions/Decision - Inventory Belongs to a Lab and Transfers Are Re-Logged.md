---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Inventory Belongs to a Lab and Transfers Are Re-Logged

Every [[Inventory Lot]] belongs to one [[Laboratory Site]], and the [[Lab Access Rule]] applies (CFL staff cannot use TPS stock). A transfer to another lab is logged as a new lot at the receiving lab, just like receiving a new chemical; the sending lab records the quantity leaving. Proposed addition: the new lot keeps a link to the source lot so traceability (manufacturer lot, COA, expiry) follows the material.

See [[Ontology Principles]].
