---
type: Business Rule
status: Draft
---

# Retained Sample Threshold Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Sample]]
- [[Retained Quantity]]
- [[Aliquot]]
- [[Alert]]
- [[Notification]]

## Threshold
Default Retention Threshold: 20% of Quantity Received.

## Required behavior
Evaluated whenever Retained Quantity is recalculated (i.e., on every Aliquot or Composite Aliquot creation against the Sample). If Retained Quantity falls below the Default Retention Threshold, this rule does NOT block further Aliquot creation or testing. It generates an [[Alert]] and [[Notification]] flagging the Sample so the customer can be contacted to send additional material. Recorded in the [[Audit Trail]] when triggered.

## Value ownership
- Inputs: [[Retained Quantity]] (Derived Value).
- Outputs: [[Alert]], [[Notification]] (Derived/Governance Objects). Non-blocking — no change to Sample or Aliquot availability status.
