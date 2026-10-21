---
type: Business Rule
status: Draft
---

# Resource Consumption Negative Flag Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Material Usage Record]]
- [[Inventory Lot]]
- [[Quantity On Hand]]
- [[Alert]]
- [[Notification]]

## Required behavior
Evaluated when a [[Material Usage Record]] is created — i.e., when an Inventory Lot is added to a test workflow or batch. If the resulting Quantity On Hand would go negative, this rule does NOT block the Material Usage Record from being created. It generates an [[Alert]] and [[Notification]] flagging the Inventory Lot. This is distinct from the [[Expired Inventory Blocking Rule]], which DOES block at this same point when Expiration Status makes the lot ineligible. Consistent with [[Decision - Inventory May Become Negative]] — this rule applies that same non-blocking pattern specifically at the point of workflow/batch assignment.

## Value ownership
- Inputs: [[Quantity On Hand]] (Derived Value), Expiration Status (checked separately by Expired Inventory Blocking Rule).
- Outputs: [[Alert]], [[Notification]] (Derived/Governance Objects). Non-blocking for negative quantity — blocking is owned entirely by the expiration rule, not this one.
