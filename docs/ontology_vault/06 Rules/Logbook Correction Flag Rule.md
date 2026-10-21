---
type: Business Rule
status: Built 0.18.0; Proposed build choices, see [[Decision - Electronic Logbooks L-1 and L-2]]
---

# Logbook Correction Flag Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Logbook Entry]]
- [[Analyte Result]]
- [[Reason for Change]]

## Required behavior
A stored result keeps the logbook values it used. When that entry is corrected later (with a reason), every result that used it is flagged, showing the values used and the corrected ones; the result is never changed. A reviewer (QC Review rights) who did not make the correction resolves each flag with a note. The result's release is blocked while a flag is open, and while the corrected entry waits for QA again.

## Value ownership
- Inputs: the correction ([[User Value]]), the values used ([[System Value]]).
- Outputs: the flag ([[Governance Object]]), its resolution note ([[User Value]]).

## Source
- [[Decision - Electronic Logbooks L-1 and L-2]]
