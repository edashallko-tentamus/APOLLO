---
type: Business Object
domain: Master Data and Configuration
capability: Business Rules
object_classification: Definition Object
status: Draft
---

# Threshold Rule

## Definition
Admin-configurable rule applying a three-tier threshold (Conforms / Alert / Deficient) to any numerical or unit-bearing field in the system, generating a color-coded status (green / orange / red) and, for Alert and Deficient, an Alert and Notification. Formalizes a pattern that already existed as three separate one-off rules ([[Retained Sample Threshold Rule]], the Inventory Amount check, and the Expiration proximity check) into one configurable engine, so future thresholds don't require a new rule object each time.

## Ownership
- **Core domain:** [[Master Data and Configuration]]
- **Capability:** [[Business Rules]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Target Field (which numerical/unit-bearing field this rule evaluates — e.g. Inventory Lot.Quantity On Hand, Sample.Retained Quantity, Supply Purchase Order Line.Days Since Submission, Analyte Result.Value)
- Units (link to [[Unit of Measure]] — required for Absolute Max-Min and Target ± Tolerance %; not applicable for Percentage of Base or Days Until/Since)
- Threshold Type, one of:
  - **Percentage of Base** — one-sided percentage of a reference/base value (e.g. Alert at 20% of Received Quantity)
  - **Absolute Max-Min** — fixed numeric bounds in Units (e.g. Deficient below 0)
  - **Target ± Tolerance %** — a nominal Target Value with a symmetric percentage band in Units (e.g. spike recovery 100% ± 15%, or a prepared concentration target ± 5%) — this is the mode that ties into control charting and result trending
  - **Days Until/Since** — proximity to or elapsed time from a date (e.g. Alert 2 months before expiration, Alert 1 month after order submission)
- Target Value (nominal/expected value — only used when Threshold Type is Target ± Tolerance %)
- Tolerance Percentage (the ± band width — only used when Threshold Type is Target ± Tolerance %)
- Alert Threshold (the orange boundary — used by Percentage of Base, Absolute Max-Min, and Days Until/Since; Target ± Tolerance % derives its boundary from Target Value and Tolerance Percentage instead)
- Deficient Threshold (the red boundary — optional; a rule may define only an Alert tier, as with purchase-order overdue, which has no red state yet)
- Blocking (yes/no — whether Deficient blocks the action outright or only flags it; non-blocking is the default, consistent with [[Decision - Inventory May Become Negative]])

## Derived Values
- Status (Conforms, Alert, or Deficient — computed against the current value of Target Field)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **is a** [[Notification Rule]]
- **evaluated against** [[Inventory Lot]]
- **evaluated against** [[Sample]]
- **evaluated against** [[Supply Purchase Order Line]]
- **evaluated against** [[Analyte Result]] (Target ± Tolerance % mode — control charting and trending, not the pass/fail determination)
- **informs** [[Specification]] (optional — a Specification may reference a Threshold Rule for its warning-zone/trending math; [[Specification Evaluation]] remains the authoritative pass/fail gate and is not replaced by this)
- **triggers** [[Alert]] (on Alert or Deficient status)
- **triggers** [[Notification]] (on Alert or Deficient status)

## Governing Rules
- Governed by [[Ontology Principles]]
- See [[Decision - Threshold Rule Engine Formalized]]
- Governed by [[GMP Record Change Control Rule]] — creating or editing a Threshold Rule instance (including its Alert/Deficient threshold values) requires Permission + Electronic Signature; editing also requires Reason for Change. No exclusion — this was considered and reversed.

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: threshold settings across fields.

## AI Questions
- What is the current status of this Threshold Rule?
- Which records are currently in Alert or Deficient status under this rule?
- What is blocking or affecting this Threshold Rule?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
