---
type: Business Rule
status: Approved
---

# Stability Material Sufficiency Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Stability Study]]
- [[Stability Test Matrix Entry]]
- [[Stability Condition]]
- [[Sample]]

## Required behavior
At placement, the material required by every remaining pull in the matrix plus a reserve is compared with the quantity received for each condition. A shortfall is flagged immediately, not discovered at a late pull. Each pull reduces the stored study sample's quantity.

## Value ownership
- Inputs: Units required per matrix cell, quantity received
- Outputs: Shortfall flag, material remaining

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
