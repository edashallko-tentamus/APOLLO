---
type: Architecture Decision
status: Approved
---

# Decision - Storage Location and Supplier Defined

[[Storage Location]] gains a self-referential Parent Location (building the hierarchy the object was always named for but never modeled) and a Supported Condition field — the temperature/condition range the location actually provides. This creates a real integrity check that didn't exist before: a Sample, Aliquot, or Inventory Lot's required storage condition can now be validated against the Supported Condition of the location it's actually assigned to, rather than the two being entered independently with no relationship between them. A lot stored in a -20°C freezer that itself claims to need 2-8°C refrigeration is a real, catchable error, not just a data entry field.

[[Supplier]] gains a relationship to [[Vendor Qualification]] — see [[Decision - Vendor Qualification Blocks Purchasing]] for the full design; approval, accreditation, and risk classification live there, not as fields directly on Supplier, so qualification history is preserved rather than overwritten at each review.

See [[Ontology Principles]].
