---
type: Architecture Decision
status: Proposed
decided: 2026-10-13
---

# Decision - QC Review Build Choices

Built by Claude in migration 018 (WD-3) while Alex was away, on his instruction to make the decisions and list the questions. Each can be changed.

**Who reviews**
- A new permission, testing.review, held by Lab Supervisor and QA.
- The reviewer must not have performed or witnessed any step of the batch. Holding testing.review is not enough.
- One signature approves the whole batch ("Reviewed by"). There is no step-by-step review mark yet. The deck's two-tier review (a review mark per step) is not built.

**Choosing what is reported**
- Every reading is kept. For each sample and analyte the reviewer chooses the reportable reading.
- When there is only one reading, it is chosen automatically.
- Re-prep replicates (prep 1, prep 2) are candidates like readings. The reviewer picks one; nothing is averaged.

**QC**
- A failed QC verdict (or one still Waiting) must be accepted with a written justification before approval. The verdict and the measured value at that moment are kept with it.
- "Not judged" verdicts do not stop approval.
- Spike recovery uses the spiked sample's latest reading, not the reading the reviewer chose for it.

**Approval**
- The chosen results are stored as the test's results (one per sample and analyte) and locked. Retests and OOS come later.
- Each result is compared with the sample's specification on the ordered test:
  - Comparison uses the reported (rounded) value.
  - "< LOQ" and ND count as below any maximum and fail any minimum.
  - A text limit (e.g. "Absent in 10 g") fails on a "found" value.
  - The outcome is Conforms, Does not conform, No specification or Not compared.
- Approval completes every QC Review step of the batch, including the parallel per-timepoint reviews of a stability or PET workflow. Releasing one timepoint on its own is not built.

**Return and cancel**
- Return to the analyst (signed, with what to fix): the chosen step and every step after it reopen. The reviewer's choices and acceptances are kept.
- Cancel a batch (signed, with a reason) needs testing.assign or testing.review. Its samples go back to the backlog; re-preps go back to the top. Stock used stays used.

**The order**
- A lab order moves to In Testing when its first test is batched.
- It moves to Complete when every test on it has approved results. Reported stays for the reporting slice.

**Screens**
- The batch's QC Review tab shows what is left to resolve, the results with their reportable reading, the QC verdicts with Accept buttons, and Approve and Return.
- A QC Review queue sits under Testing.
- The sample page shows the approved results with their specification comparison, plus the batches the sample was in.

**Alex's answers (2026-10-13)**
- Re-prep replicates: the reviewer may pick one prep with a justification, or report the average. Built in WD-5: [[Decision - Analytical Runs, Preliminary Results and Order Statuses]].
- Spike recovery against the spiked sample's latest reading: Alex leans no change; Claude to show an example before deciding. Decided (Alex, WD-5.1): judged against the reviewer's chosen result of the sample (picked or averaged).
- A review mark per step: yes. Built by Claude Code in WD-3.1 (below).
- Timepoints (revised by Alex the same day): a Day 7 result must be approvable and releasable as a preliminary result; the final QC Review then approves the test and it is released on the final report. Built in WD-5.
- QA items are logged in [[Open Items for QA Review]].

**Changed in WD-3.1 (migration 020, Alex 2026-10-13):** the reviewer approves each step with a click before the one signed approval, and the review tables are nested: [[Decision - QC Review Approves Each Step]].

See [[Decision - Chemistry Execution Scope and Rules]].
