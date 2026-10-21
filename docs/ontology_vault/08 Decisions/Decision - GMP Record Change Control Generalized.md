---
type: Architecture Decision
status: Approved
---

# Decision - GMP Record Change Control Generalized

[[GMP Record Change Control Rule]] applies to every Business Object with User Values by default — universal scope, no enumerated list and no exclusions. Originally scoped to nine named object types ([[Inventory Lot]], [[Chemical]], [[Analyte]], [[Supplier]], [[Department]], [[Team]], [[Role]], [[Permission]], [[Equipment]]), then widened to universal per explicit instruction: "everything that gets changed in a data record needs the esign."

Reasoning for the original nine, still relevant context:
- **Chemical and Analyte:** upstream identity records — a bad edit propagates into every Inventory Lot and every reported result that references them. Analyte's Report Name specifically is what prints on a customer-facing Certificate of Analysis.
- **Supplier:** basic vendor record integrity, distinct from [[Vendor Qualification]]'s approval decision, which already had its own QA-signature requirement before this decision and is unchanged.
- **Department, Team, Role, Permission:** access-control master data. Under GMP, changing who can do what is treated as sensitive in its own right, not just the approvals those permissions gate.
- **Equipment:** the base record (Serial Number, Manufacturer, Department, responsible parties) — distinct from the Tag-Out/Tag-In workflow, which already has its own signature and QA-approval requirements built earlier and is unchanged by this decision.

Threshold Rule configuration values were excluded at one point, then that exclusion was reconsidered and reversed — they're covered like everything else now.

See [[Ontology Principles]].
