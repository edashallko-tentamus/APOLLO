---
type: Architecture Decision
status: Approved (Alex confirmed the build choices, 2026-10-13)
decided: 2026-10-13
---

# Decision - Analytical Runs, Preliminary Results and Order Statuses

Alex Kiddle, 2026-10-13, after reviewing WD-2 to WD-4. Built by Claude in the cloud as WD-5 (migration 021, seed_016, seed_017).

**Alex's answers**
- Re-prep or re-analysis replicates: the reviewer either picks one result with a written justification, or reports the average.
- Several analytical runs: a reading step gets an "Add analytical run" button, each run has its own tab, and a tick box at review chooses the result across runs.
- Labels: a re-analysis is RA1-, RA2-... and a re-prep RP1-, RP2-... in front of the sample ID (e.g. RA1-CFL261013005). Duplicates are numbered 1 and 2, and the numbering continues upward.
- Day 7 results (USP <51>, stability) are approved and released as preliminary results. The final QA review notes each step review as normal and the test is released on the final report.
- Customer consent on a split-off is a setting of the Split off step in the designer, switched on or off.
- Order statuses: Complete waits until the order goes out. In Review and Approved replace it; Reported comes with reports. ([[Decision - Order Status Waits for the Report]])

**How it was built (Claude's choices, to confirm)**
- Analytical runs
  - Run 1 is the reading step itself. "Add analytical run" (signed "Requested by", with a reason) reads the ticked samples again, single, duplicate or triplicate, in run 2, 3...
  - The new run gets one reading of every analytical QC entry of the batch (ICV, CCVs, blanks marked Analytical), judged in that run. A prep QC is judged in a later run only if it was ticked.
  - Each run has its own raw data file and instrument (both required, as for run 1).
  - Re-analysis (WD-2) is now the same action.
- Which QC counts at review
  - The analytical QC of a run counts only if a reported reading comes from that run. Failing QC in a run nobody reports from does not need accepting.
  - A prep QC's first run always counts, because it judges the preparation.
  - A matrix spike is judged against the reviewer's chosen result of its sample (changed in WD-5.1, below).
- Pick or average
  - The reviewer ticks one reading to pick it, with a justification whenever the sample has more than one reading.
  - Or ticks several to report their average. A justification is needed when some readings are left out.
  - The average is of the unrounded values, then rounded as the test says. Only numeric readings can be averaged.
- Preliminary results
  - A QC Review step set to Timepoint, coming before the final result, is a timepoint review.
  - It can be released on its own once every step before it is completed and each has the reviewer's step approval.
  - It is signed "Reviewed by" and releases the Calculation results before it (e.g. day 0 and day 7) with stage Preliminary.
  - The steps that fed it are then locked: they cannot be reopened or read again, and the batch cannot be cancelled. Corrections to released results come with the OOS and retest slice.
  - The final approval copies each preliminary result into a Final one, unchanged (linked to it), and stores the rest.
  - A timepoint's results are not compared with the specification (the specification is for the final result).
  - QC is judged at the final review, not at the timepoint.
- Order statuses
  - In Testing: a test is batched.
  - In Review: no test is left at the bench (each is approved or in a batch waiting for review), and at least one waits.
  - Approved: every test has final results.
  - Orders recorded as Complete are recalculated (seed_016).
- Split off consent
  - "Customer consent required" on the step. When it is off, completing the step orders the test at once from the client's accepted quote, as a system action of the approved workflow.
  - When the test is not on an accepted quote, the request waits as "To order".
  - Steps designed before the setting existed keep asking for consent. New steps start with it off.

**Alex's confirmation (2026-10-13)**
- All five build choices above are agreed. QC not judged at a preliminary release is agreed for now and left with Jake Teller (QA) to confirm.

**WD-5.1 (Alex, 2026-10-13; built in migration 022)**
- Spike recovery: a matrix spike (and its duplicate) is judged against the reviewer's chosen result of the spiked sample, the reading picked or the average. Until the reviewer chooses, it uses the sample's reading in the same run, and the verdict says so. Claude read Alex's "Agreed" as agreeing with this recommendation (flagged to him).
- Incubator loads outside their window or temperature: the analyst explains each in the load's note (as before), and the reviewer must also accept each with a justification before the batch, or the timepoint it feeds, can be approved. The acceptance keeps what was out at the time; if the load is later corrected, it must be accepted again.

**Not built yet**
- Report printing with "Preliminary: not a final result". The label shows on the sample page and in review.
- A run's QC judged against a calibration (only check standards, blanks and spikes, as before).
- Analytical runs at more than one reading step for QC: QC and runs follow the batch's last reading step.

See [[Decision - QC Review Build Choices]], [[Decision - QC Review Approves Each Step]], [[Decision - Micro Bench Build Choices]], [[Open Items for QA Review]].
