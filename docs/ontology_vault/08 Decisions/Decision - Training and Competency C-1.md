---
type: Architecture Decision
status: Approved (Alex, 2026-10-20); build choices Proposed
decided: 2026-10-20
built: 2026-10-20 (migration 053, version 0.31.0)
---

# Decision - Training and Competency C-1

Builds [[Training Competency and Authorization]]: [[Analyst Qualification]], [[Competency Requirement]] (as the rules), [[Demonstration of Competency]] and [[Competency Attempt]] (as competency attempts), [[Competency Evaluation]], and [[SME Status]] (as department trained), following [[Decision - Four Tests May Grant SME Status]].

## Alex's decisions (2026-10-20)

1. **Block, with a per-lab switch:** someone without a current qualification for a test cannot do its bench steps; each lab turns this on when its records are ready.
2. **Either route, QA approves:** training samples run through the real workflow and compared with known values, or a record of training done outside the LIMS with its evidence. The trainer evaluates; QA signs.
3. **Configurable rules, per lab and per department:** "If an analyst has performed 4 different tests within a department they are considered trained." What that unlocks: any test of the department, and training others: "Both but make it configurable." Counted on qualified tests.
4. **A rolling counter** kept up to date, and **a training report** per person: what they trained on and their last competency sample.
5. **Initial and continuing competency** are kept apart.

## What was built

- **Permissions:** training.view (QA, Lab Supervisor, General Manager), training.record (QA, Lab Supervisor), training.approve (QA), training.configure (QA, Lab Supervisor). Everyone sees their own training.
- **Rules (Rules tab):** the lab's rule and each department's own: department trained after N tests (4), may do any test of it, may train others, continuing competency every N months (12), Due soon N days before (30), optionally at least N runs in M months, which routes are accepted.
- **Qualifications** (AQ-): per person and test, from an initial competency or as Legacy; Current, Due soon, Lapsed (continuing competency overdue, or too few runs where the rule asks), Withdrawn (QA, signed, with the reason).
- **Competency attempts** (TA-): Initial or Continuing; by **record** (what was done, when, evidence attached) or by **training samples** (an internal order, TRN- samples run like any sample, the known values ± % as their specification so QC Review shows whether each result is within them). A trainer evaluates (Pass, Conditional pass with what it is conditional on, Fail with why; signed "Evaluated by"; never the trainee; training samples only once all have final results). QA approves or rejects (signed; never the trainee or the evaluator). Approving a pass grants the qualification (initial) or keeps it up (continuing).
- **Department trained:** enough current qualifications in the department; it can let the person do any of its tests and evaluate others there.
- **The rolling counter:** batches in which the person signed a bench step of each test (12 months and all), and the last run.
- **Legacy qualifications** (QA, signed): whoever signed a bench step of a test at the lab in the last 12 months.
- **The gate** (Sites, "Training gate", system administrators; off): signing a bench step needs a current qualification, or department trained where it unlocks the test; a batch holding only the person's own open training samples is allowed.
- **Screens:** Testing > Training and competency (People, Competency, Rules; Grant legacy qualifications…); a person's page (departments, qualifications, competency, work done, Training report PDF, Start competency…); an attempt's page (evidence, training samples and results, Evaluate…, Approve… / Reject…, Withdraw…).

## Build choices (Proposed)

1. The gate is at signing a bench step: typing data is not blocked; witnesses and QC reviewers are not checked against qualifications.
2. Legacy qualifications: anyone who signed a bench step of the test at the lab in the last 12 months; their last run counts as their last competency.
3. A trainer is training.record, or department trained where the rule lets them train.
4. Training samples are ordinary samples in batches (internal client, no price, not billed, not reported).
5. Continuing competency restarts its due date from QA's approval.
6. Department trained counts only current qualifications (a lapsed one stops counting).
7. Qualifications are per test, not per test version or workflow step.

**0.32.0 (Alex, 2026-10-20):** each department now sets its own count. Every department has its own rule, made from the lab's, and a new department gets one; the lab's rule is for tests with no department. See [[Decision - Department Training Counts, METRC IDs and Client Licenses]].
