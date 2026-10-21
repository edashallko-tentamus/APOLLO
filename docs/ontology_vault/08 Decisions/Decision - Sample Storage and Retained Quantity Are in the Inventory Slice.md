---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Sample Storage and Retained Quantity Are in the Inventory Slice

The Inventory slice includes sample storage: each [[Sample]] can be assigned a [[Storage Location]] (checked against the location's supported condition) and carries a retained quantity with a non-blocking low threshold. This feeds the OOS rule that a client retest is allowed only while retained sample exists.

See [[Ontology Principles]].
