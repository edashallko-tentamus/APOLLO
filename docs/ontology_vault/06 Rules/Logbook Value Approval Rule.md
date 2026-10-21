---
type: Business Rule
status: Built 0.18.0; Proposed build choices, see [[Decision - Electronic Logbooks L-1 and L-2]]
---

# Logbook Value Approval Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Logbook Entry]]
- [[Inventory Lot]]
- [[Calculation]]
- [[Analyte Result]]

## Required behavior
A value a logbook entry publishes (an inoculum's CFU added, a culture's passage) feeds a result only through the lot scanned at a step, only for the analytes the lot names, and only once the entry is approved: QA approval in the logbook, or the batch review for a logbook reviewed in the batch. Until then the result waits. A lot whose entry is past its validity window is refused at the scan. When a lot has several usable entries, the approved one is used, otherwise the analyst chooses; the system never guesses. Release is blocked while a used entry is not approved.

## Value ownership
- Inputs: the published value, the entry's status and validity ([[System Value]], [[Derived Value]]).
- Outputs: the calculated result and what it waits for ([[Derived Value]]).

## Source
- [[Decision - Electronic Logbooks L-1 and L-2]]
