---
type: Business Rule
status: Reviewed
---

# Delayed TAT Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Equipment Tag]]
- [[Equipment Impact Assessment]]
- [[Delayed TAT]]
- [[Requested Test]]
- [[Due Date]]
- [[Backlog]]

## Required behavior
Whenever an [[Equipment Tag]] becomes active, an [[Equipment Impact Assessment]] evaluates every Test Pool, Test Batch, Worklist, and Requested Test that depends on the tagged-out Equipment, producing a [[Delayed TAT]] value that recalculates affected [[Due Date]]s and surfaces on Requested Test, Test Pool, and Project. This is display-only — it informs staff and clients of expected delay, it does not itself block anything (blocking is owned entirely by Equipment Tag).

## Value ownership
- Inputs: active Equipment Tag, dependent Requested Tests/Test Pools/Test Batches.
- Outputs: [[Delayed TAT]] (Derived Value), recalculated [[Due Date]]s.
