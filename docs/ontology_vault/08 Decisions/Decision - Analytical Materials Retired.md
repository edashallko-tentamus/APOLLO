---
type: Architecture Decision
status: Approved
---

# Decision - Analytical Materials Retired

Analytical Materials capability is retired. Its physical-chemical objects (Reagent, Reference Standard, Solvent) were already unified into [[Inventory Lot]] under [[Decision - Chemical Inventory Unified Under Inventory Lot]], leaving only [[Test Material Requirement]] — a property of how a Test is defined, not a physical chemical. It moved to [[Test Method and Workflow Management]] (Laboratory Operations), alongside the other objects that define a Test (Calculation Formula, Specification, Test-Analyte Configuration). It relates to Inventory only through its existing "fulfilled by [[Inventory Lot]]" relationship, unchanged by this move.

See [[Ontology Principles]].
