---
type: Business Rule
status: Built 0.18.0; Proposed build choices, see [[Decision - Electronic Logbooks L-1 and L-2]]
---

# Aliquot Weight Review Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Aliquot]]
- [[Logbook Entry]]
- [[Workflow Step Instance]]
- [[Technical Review]]

## Required behavior
An aliquot weighed in a sample weights logbook is scanned at a test's Weighing step, which fills the weight and the balance; a typed weight cannot replace it. It is reviewed in the batch that uses it, not by QA in the logbook: QC Review lists every aliquot of the batch's samples (used or not, repeat weighings, who weighed, the balance and its calibration then). The reviewer may not be the person who weighed or corrected an aliquot used. A corrected or voided aliquot used in the batch blocks its approval. Approving the batch marks the aliquots it used as reviewed. Basis to confirm with QA: 21 CFR 211.194(a).

## Value ownership
- Inputs: the aliquot's weight and balance ([[User Value]]).
- Outputs: the weight used at the bench ([[Derived Value]]); the review in the batch ([[Governance Object]]).

## Source
- [[Decision - Electronic Logbooks L-1 and L-2]]
