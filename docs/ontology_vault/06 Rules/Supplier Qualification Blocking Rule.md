---
type: Business Rule
status: Draft
---

# Supplier Qualification Blocking Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Supplier]]
- [[Vendor Qualification]]
- [[Supply Purchase Order Line]]

## Required behavior
Blocks the creation of a new [[Supply Purchase Order Line]] — including the Reorder action on an [[Inventory Lot]] — when the Supplier's current [[Vendor Qualification]] Approval Status is not "Approved," or its Expiration Date has passed. This is a hard block, not a flag — unlike [[Resource Consumption Negative Flag Rule]] and the retention/inventory threshold rules elsewhere in this module, purchasing from an unqualified or lapsed supplier is not something the lab absorbs and reconciles later.

## Value ownership
- Inputs: [[Vendor Qualification]] Approval Status and Expiration Date (most recent record per Supplier).
- Outputs: blocks Supply Purchase Order Line creation outright. No Alert/Notification path — the block itself is the signal, surfaced at the point of the Reorder action.
