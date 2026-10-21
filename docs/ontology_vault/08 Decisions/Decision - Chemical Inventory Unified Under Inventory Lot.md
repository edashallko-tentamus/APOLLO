---
type: Architecture Decision
status: Approved
---

# Decision - Chemical Inventory Unified Under Inventory Lot

Reagent, Reference Standard, and Solvent (formerly separate Definition Objects) are retired and replaced by a single controlled [[Chemical]] definition (CAS Number, controlled name) plus a Chemical Type multi-select on [[Inventory Lot]]: Consumable, In-house mixture, Solvent, Reagent, Media, Reference Standard, Microbiological Strain. The same Chemical (e.g., Methanol) may be received under different Chemical Types across different lots.

In-House Reagent Mixture, In-House Reference Standard, In-House Solvent Mixture, and Prepared Material Lot are retired. An internally prepared mixture is an [[Inventory Lot]] with Chemical Type including "In-house mixture" — Lot# is replaced by a system-generated Resource ID, expiration is derived from the earliest-expiring component, and Unit is constrained to mathematically valid conversions via [[Unit of Measure]] equivalency data (admin-controlled; whether the underlying Chemical naming table itself is admin-only or open to lab use is undecided).

Chemical Type governs two distinct things, not one: what a lot may be *mixed with* (unrestricted — any type may combine with any other) and what a lot may be *used as* (only Reference Standard and Microbiological Strain may be represented as the reported analyte of a test result; they are treated as functionally equivalent, differing only in label). Reagent and Media may still carry a concentration value consumed by calculation logic (e.g., a titrant's normality) — the Chemical Type gate controls analyte-reporting eligibility, not participation in calculation math.

Prepared Laboratory Materials capability is retired as a consequence — its sole object (Prepared Material Lot) no longer exists as a separate type.

See [[Ontology Principles]].
