---
type: Business Rule
status: Approved
---

# OOS Investigation Rule

## Rule type
[[Definition Object]]

## Applies to
- [[OOS Investigation]]
- [[OOS Procedure]]
- [[Result]]
- [[Report Release]]
- [[Client]]
- [[Laboratory Site]]

## Required behavior
- A result failing its Specification opens an OOS Investigation automatically.
- Procedure: Full Phase I (21 CFR 211) for Regulated (GMP) clients at any site; otherwise the site's default procedure.
- Automatic checks (lots, calibration and tag-out, training, recalculation, batch QC and system suitability) run for every procedure.
- The OOS result cannot be released until the investigation is closed and signed. Other completed results are unaffected (see [[Partial Reporting Rule]]).
- Assignable cause found: the result is invalidated (retained, never deleted) and the lab retests at no charge (Retest source Lab Investigation). OOS confirmed: QA releases the result.
- Re-analysis results are kept alongside the original; results are never averaged and the original is never replaced without an assignable cause.
- Regulatory detail follows FDA's OOS guidance (revised 2022) and the lab's OOS SOP, owned by QA.

## Value ownership
- Inputs: Result, Specification, client GMP flag, site default procedure, automatic check data
- Outputs: OOS Investigation, release block, invalidation

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
