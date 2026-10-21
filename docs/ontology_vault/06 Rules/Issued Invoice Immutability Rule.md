---
type: Business Rule
status: Approved in principle (Alex, 2026-10-15); details Proposed
---

# Issued Invoice Immutability Rule

An issued invoice or credit note is never changed: numbered at issue (gapless per lab), its PDF attached once in the issuing transaction, signed. Corrections are credit notes (signed, with a reason), which credit whole lines once and either send the work back to be invoiced again or close it.

Enforced in the database (migration 036). See [[Decision - Invoicing I-1]]. Applies to [[Invoice]] and [[Invoice Line Item]].
