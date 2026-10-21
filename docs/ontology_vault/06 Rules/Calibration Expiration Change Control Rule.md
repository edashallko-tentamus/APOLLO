---
type: Business Rule
status: Draft
---

# Calibration Expiration Change Control Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Calibration]]
- [[Electronic Signature]]
- [[Permission]]

## Required behavior
A Calibration record's Expiration Date is freely fillable while Submission Status is Draft. Once Submitted, changing it requires the acting [[User]] to hold the relevant QA approval [[Permission]] (via a directly assigned [[Role]] or via [[Team]] membership — see [[Decision - Roles and Permissions Are Additive and Group-Assignable]]) and to be a different individual than whoever performed the original calibration. A fresh [[Electronic Signature]] is required at the moment of the change.

## Value ownership
- Inputs: acting User's Permission set, identity check against the original performer.
- Outputs: permits or blocks the field change; recorded in the [[Audit Trail]] regardless of outcome.
