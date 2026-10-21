---
type: Business Rule
status: Reviewed
---

# Expired Inventory Blocking Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Inventory Lot]]
- [[Expiration Status]]
- [[Use Eligibility]]
- [[Material Usage Record]]
- [[Inventory Hold]]

## Required behavior
Blocks the creation of a [[Material Usage Record]] — i.e., blocks adding an Inventory Lot to a test workflow or batch — when Expiration Status makes the lot ineligible. This is a hard block, unlike [[Resource Consumption Negative Flag Rule]], which flags rather than blocks. This rule must be implemented through controlled configuration, evaluated consistently, and recorded in the [[Audit Trail]] when it changes a regulated state.

## Value ownership
- Inputs may include [[User Value]], [[Derived Value]], and [[System Value]].
- Outputs are generally [[Derived Value]] or [[Governance Object]] decisions.
