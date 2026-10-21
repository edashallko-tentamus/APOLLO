---
type: Architecture Decision
status: Approved
---

# Decision - Vendor Qualification Blocks Purchasing

[[Vendor Qualification]] is a new object, not fields added to [[Supplier]]. Each qualification review — accreditation, Risk Classification (Class I / II / III), Approval Status, approval and expiration dates — creates a new record rather than overwriting the prior one, preserving qualification history. Supplier's Current Approval Status is derived from the most recent Vendor Qualification record.

Unlike every other threshold and status rule in this module, this one blocks outright: [[Supplier Qualification Blocking Rule]] prevents a new [[Supply Purchase Order Line]] — including the Reorder action on an [[Inventory Lot]] — from being created when the supplier's current qualification is not Approved or has expired. This is a deliberate departure from the non-blocking-flag pattern used everywhere else (Retained Sample, Negative Inventory, Resource Consumption) — an inventory quantity shortfall is something the lab can absorb and reconcile; purchasing from an unqualified or lapsed supplier is a compliance exposure the system should not let through quietly.

Risk Classification is captured but does not yet drive different behavior (e.g. shorter re-qualification intervals for higher-risk classes) — that's a real next question, not resolved here.

See [[Ontology Principles]].
