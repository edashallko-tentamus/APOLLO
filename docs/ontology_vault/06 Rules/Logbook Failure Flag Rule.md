---
type: Business Rule
status: Built 0.18.0; Proposed build choices, see [[Decision - Electronic Logbooks L-1 and L-2]]
---

# Logbook Failure Flag Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Logbook Entry]]
- [[Equipment]]
- [[Workflow Step Instance]]
- [[Technical Review]]
- [[Stability Study]]

## Required behavior
A logbook entry about a piece of equipment that fails its limits (or a Pass/Fail field set to Fail) is recorded with its reason, asked for before signing. It does not tag the equipment out. Every batch step that recorded the equipment, or held an incubator load in it, from the last passing entry before the failure until the next passing entry (or until now) is flagged. The flag shows in QC Review and in a timepoint review; the reviewer accepts each flag with a justification, kept with their name, before the batch or timepoint can be approved. A stability chamber reading outside its condition is listed on every study stored in it at the time.

## Value ownership
- Inputs: the entry's values and limits (per unit, or from the chamber's condition) ([[User Value]], [[Derived Value]]); equipment use recorded at the bench ([[System Value]]).
- Outputs: the entry's result and the flags ([[Derived Value]]); the reviewer's acceptance ([[User Value]]).

## Source
- [[Decision - Electronic Logbooks L-1 and L-2]]
