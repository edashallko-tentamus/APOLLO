---
type: Architecture Decision
status: Proposed (Claude's build choices, to confirm with Alex and Jake Teller, QA)
decided: 2026-10-14
built: 2026-10-14 (R-2, migration 027, version 0.14.0)
---

# Decision - OOS Investigation Build Choices

R-2 builds the OOS investigation on Alex's decisions: [[Decision - OOS Investigations Use a Procedure Matched to the Work]], [[Decision - An OOS Result Holds Only Itself]], [[Decision - Client OOS Retests Are Re-preps Billed by QA Determination]] and the OOS section of [[Decision - Result Finalization and the Certificate of Analysis]]. Where Alex had not ruled, Claude chose as below.

**Alex's rules, as built**
- **Never opened by itself.** QC Review and the sample page flag a nonconforming result and offer "Open OOS…". Someone opens it after checking the sample details and the specification (they may simply be wrong, often settled with the client first).
- **The procedure** follows the work. GMP samples (a Regulated client or a GMP compliance category) get Full Phase I (21 CFR 211); everything else gets the lab's default, Check and Acknowledge at CFL. Automatic data checks run for both.
- **Only the OOS result is held.** The other tests of the sample may be finalized on a partial COA.
- **The client is emailed on release, not on detection.** The "Out of specification result" Outbox template asks whether the client wants Phase II re-testing. It has a link for each answer: retest, retest in duplicate, test a new sample, hold or return the retained sample, a call with QA, acknowledge. For GMP work the signed Phase I report is attached.
- **Client retests are re-preps from the retained sample.** Billing follows QA's determination: Confirmed OOS or Inconclusive are billable, Lab error is not.
- **No "retest" or "amended" wording on the COA.** The retest's result replaces the original on the next COA version.

**Who does what (permissions)**
- `oos.open` (Analyst, Lab Supervisor, QA): open an investigation. A signature ("Opened by") is required, with an optional note on why.
- Full Phase I runs in three signed steps:
  - The analyst section, signed "Investigated by". Needs `testing.perform`.
  - The supervisor section, signed "Reviewed by". Needs `testing.review`, and the signer must not be the analyst who signed the first section.
  - The QA conclusion, signed "Approved by". Needs `oos.approve`, and the signer must not have signed either section.
- Check and Acknowledge: one reviewer with `testing.review` or QA answers the reviewer checklist and concludes, signed "Approved by".
- **Independence from the bench (Claude's addition).** Nobody who performed or witnessed a step of the batch may sign the supervisor section or the conclusion. This is the same rule as QC Review.
- **Cancel** (signed, with a reason): QA, or whoever opened it. It is for an investigation opened in error. The record is kept, marked Cancelled.
- **Retests and client answers:**
  - Retests are ordered by anyone with `orders.edit`, signed "Ordered by". In practice that is the Project Manager or a Lab Supervisor.
  - A client's answer is marked handled by `orders.edit` or `oos.open`.
  - "OOS investigations" is in the Testing menu for `oos.open`, `oos.approve`, `testing.review` and `reports.finalize`, so Project Managers see it.
- **The checklists and target times** are kept by QA (`oos.configure`, Admin > QA > OOS checklists).

**How it behaves (Claude's choices)**
1. **An open investigation does not block approving the batch** in QC Review. It holds only the release (finalization) of that result.
2. **The conclusion needs the batch approved.** It concludes about the stored result, which the report names.
3. **A checklist "No" needs a comment.** Every active item must be answered Yes, No or N/A.
4. **Target times are in calendar days from opening:** 30 for Full Phase I, 10 for Check and Acknowledge. QA can change them. An overdue investigation is shown in red; nothing is blocked.
5. **"Assignable cause found" invalidates the test's results.** When the lab investigation retest is ordered, all of that test's results are marked Superseded (kept, linked to the investigation), not only the OOS analyte. The retest is a new requested test with the same specification. It is not billable, and it reopens a Reported or Approved order.
6. **"OOS confirmed" releases the result as out of specification.** The client retest can only be ordered after the client has been told, which happens when the result is released on a COA.
7. **QA records the retest determination** only after the client retest is approved in QC Review. The determination sets the retest's billing.
8. **The client's link is valid for 90 days** from the email. Answers are recorded by the system user, with the name the client typed. No client details are shown on the page beyond the sample, test, result and specification.
9. **A retest needs retained material** when the retained quantity is recorded (refused at 0). It does not take quantity off the retain yet.
10. **The automatic data checks** are kept on the investigation and can be re-run until it closes. They go into the report. The checks are:
    - lots in date;
    - instruments calibrated and not tagged out;
    - batch QC;
    - the result worked out again from the readings;
    - analysts in the step's department;
    - raw data attached;
    - the specification;
    - the sample's condition and retained quantity;
    - this client's earlier results.
11. **The investigation report** is a PDF made by the server when the conclusion is signed, stored with its SHA-256. It is attached to the OOS email for GMP work.
12. **Not built:** hypothesis testing as its own step (a re-analysis of the same preparation in a new run before approval works through QC Review's analytical runs; after approval it does not). Phase II as a formal record. Taking retest material off the retain. Corrections to released results other than through a retest.

**Questions for Alex**
- Should an open OOS investigation stop the batch from being approved in QC Review? Claude chose no (choice 1), because the investigation needs the approved result.
- Should a lab investigation retest supersede all of the test's analytes (choice 5) or only the failing one? Claude chose all, because the assignable cause usually affects the whole preparation. About 80% sure that is what labs expect.
- Is 90 days right for the client's link?

See [[OOS Investigation]], [[Retest]], [[Retest Determination]], [[Open Items for QA Review]].
