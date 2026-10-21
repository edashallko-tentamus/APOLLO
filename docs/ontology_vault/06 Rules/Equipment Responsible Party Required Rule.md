---
type: Business Rule
status: Draft
---

# Equipment Responsible Party Required Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Equipment]]
- [[Team]]
- [[User]]

## Required behavior
An [[Equipment]] record cannot be saved without at least one responsible party assigned, across any combination of [[Team]] and [[User]] — e.g. "HPLC Team" and an individually named user can both be assigned to the same Equipment simultaneously. A permission-only group like "Lab Supervisor" is itself a Team (see [[Decision - Team Reused for Equipment Ownership and Notification Routing]]), so this still resolves to just two owner types, not three. Attempting to save Equipment with zero responsible parties is blocked with an error, not a soft warning.

## Value ownership
- Inputs: the set of assigned Team/User/Role owners.
- Outputs: blocks save when empty (hard block, not a Threshold Rule flag — this is a data-completeness gate, not a status trend).
