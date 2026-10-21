---
type: Business Object
domain: Quality Review and Reporting
capability: Deviations and Investigations
object_classification: Governance Object
status: Reviewed
---

# OOS Investigation

## Definition
Investigation of an out-of-specification result. **Not opened automatically** (Alex, 2026-10-13): QC Review and the sample page flag a result that fails its Specification and offer "Open OOS…", because the sample details or the specification are sometimes wrong and are corrected first. Opening is signed. Follows one of two [[OOS Procedure]]s: Full Phase I (21 CFR 211) or Check and Acknowledge. Automatic data checks run in both. The OOS result is held (not the rest of the sample) until the investigation is closed and signed.

## Ownership
- **Core domain:** [[Quality Review and Reporting]]
- **Capability:** [[Deviations and Investigations]]
- **Object classification:** [[Governance Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Analyst section (data preservation confirmed; method followed; raw data, chromatograms or spectra reviewed; prep observations; transcription checked)
- Supervisor section (discussion with analyst; method performance vs historical data; review of automatic checks)
- Reviewer section (Check and Acknowledge: one reviewer answers the checklist and concludes)
- Checklist answers per item: Yes, No (comment required) or N/A; items kept by QA per procedure and section
- Hypothesis testing (optional re-analysis of the same preparation in a new analytical batch; both results kept, never averaged)
- Conclusion: Assignable Cause Found or OOS Confirmed, with written justification
- Assignable cause (required to invalidate)

## Derived Values
- Procedure applied (from client GMP flag, else site default)
- Automatic checks with pass/fail: standard and reagent lots in date and released; instrument calibrated and not tagged out at time of analysis; analyst trained or SME; calculations recomputed from raw data; batch QC and system suitability passed
- Status: Open, Analyst signed, Supervisor signed (Full Phase I), Closed, Cancelled (opened in error; kept)
- Code OOS-000001; target date from the procedure's close-within days (QA setting)
- Opened at, closed at, configurable target times

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **investigates** [[Result]]
- **follows** [[OOS Procedure]]
- **may affect** [[Sample]]
- **may affect** [[Requested Test]]
- **may affect** [[Equipment]]
- **may create** [[Retest]] (lab investigation retest, non-billable)
- **blocks** [[Report Release]] of the OOS result only
- **signed by** [[Electronic Signature]] (opened by; analyst, supervisor, QA; cancelled by)
- **receives** client responses (through the link in the OOS email)
- **produces** an investigation report (PDF, SHA-256)

## As built (R-2, migration 027, 0.14.0)
- `oos_investigation`, `oos_client_response`, `oos_checklist_item`, `oos_procedure_setting`; screens `#/oos`, `#/oos/<id>`, `#/oos/config`; the client's page `oos-response.html`.
- Build choices: [[Decision - OOS Investigation Build Choices]] (Proposed).

## Governing Rules
- [[OOS Investigation Rule]]
- [[Report Release Blocking Rule]]
- [[Partial Reporting Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- Which automatic checks failed for this OOS?
- Has an assignable cause been documented?
- Is this OOS result holding any report?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
