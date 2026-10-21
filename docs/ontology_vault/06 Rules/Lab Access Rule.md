---
type: Business Rule
status: Approved
---

# Lab Access Rule

## Rule type
[[Definition Object]]

## Applies to
- [[User]]
- [[Laboratory Site]]
- [[Lab Order]]
- [[Sample]]
- [[Requested Test]]
- [[Matrix]]

## Required behavior
- A user can create or change a [[Lab Order]], [[Sample]] or [[Requested Test]] only in a [[Laboratory Site]] they are assigned to.
- Only administrators can create or change sites, site holidays, the [[Matrix]] list and lab assignments.
- The user who creates a site is assigned to it automatically.
- Assigning or removing a lab needs a Reason for Change and is audited.
- Enforced in the database, so no screen, import or integration can bypass it.
- Cross-site oversight (view only, proposed) comes from a [[Role]]; see [[Decision - Cross-Site Access Comes From Roles]].

## Value ownership
- Inputs: user's lab assignments, administrator flag
- Outputs: allow or refuse the change

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
