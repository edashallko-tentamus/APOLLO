---
type: Business Rule
status: Draft
---

# GMP Record Change Control Rule

## Rule type
[[Definition Object]]

## Applies to
- Every [[Business Object]] with User Values (i.e. any record a human creates or edits) — universal default, not an enumerated list
- [[Electronic Signature]]
- [[Audit Event]]
- [[Reason for Change]]
- [[Permission]]

## Required behavior
Creating any record with User Values requires the acting User to hold a dedicated Permission (one per object type, admin-composed like any other Permission) and to provide an [[Electronic Signature]] at the moment of save. Once created, the record is locked: any subsequent change requires the same Permission, a fresh Electronic Signature (not reused from earlier in the session), and a [[Reason for Change]] captured on the resulting [[Audit Event]]. Reason for Change applies only to modification, never to initial creation.

This is the universal default. Where an object already has its own more specific, bespoke signature workflow — [[Equipment Tag]]'s Tag-Out/Tag-In signatures, [[Calibration]]'s QA-approval-to-change-Expiration-Date rule — that specific rule remains authoritative and is not replaced by this one; this rule is the fallback for everything that doesn't yet have a bespoke workflow of its own.

Applies with no exclusions, including Threshold Rule configuration values (calibration alert window, inventory percentage thresholds, purchase-order-age threshold) — an earlier version of this rule excluded those on the reasoning that a monitoring trigger differs from a record of fact; that exclusion was reconsidered and reversed. See [[Decision - GMP Record Change Control Generalized]].

## Value ownership
- Inputs: acting User's Permission set (per object type), a fresh Electronic Signature per action.
- Outputs: on create, an Audit Event with no Reason for Change required; on modify, an Audit Event with Reason for Change required. Blocks the save if Permission or Signature is missing.

## Sandbox implementation (slice 3.2, 2026-10-12)
Reasons for Change are picked from canned reasons per module or typed (Other): [[Decision - Reasons for Change Are Picked From Canned Reasons per Module]]. Inventory changes also carry an electronic signature: [[Decision - Inventory Changes Are Electronically Signed]].
