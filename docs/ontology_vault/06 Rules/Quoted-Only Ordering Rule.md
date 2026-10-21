---
type: Business Rule
status: Approved
---

# Quoted-Only Ordering Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Requested Test]]
- [[Lab Order]]
- [[Quoted Test Configuration]]
- [[Project Version]]
- [[Stability Study Version]]
- [[Test Catalog]]

## Required behavior
Every Requested Test must trace to an Active line on an Accepted, unexpired Project Version or Stability Study Version for the ordering client (or for an ancestor client's project marked Available to Child Clients). Clients may browse and request catalogue tests, but must be quoted or accept list pricing (recorded as a List Price Acceptance project) before submitting. The ordering contact must hold the Ordering role for the client.

Exceptions with their own source, linked to the original Requested Test: Client OOS Retest (priced from the original quote line, billed per [[Retest Billing Rule]]) and Lab Investigation Retest (non-billable, lab users only).

## Value ownership
- Inputs: Accepted quote lines, Client Contact roles
- Outputs: Allow or block Requested Test creation

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
