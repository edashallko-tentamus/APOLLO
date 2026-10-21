---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - QC Review Approves Each Step

Alex Kiddle, 2026-10-13, after clicking through the WD-3 QC Review: "The QA review should approve each step with an approval button once the workflow has terminated." He also asked for a cleaner review layout. Built by Claude Code as WD-3.1 in migration 020. It answers question 3 of the WD-2 to WD-4 questions, and part of question 4.

**Step approvals**
- Once every bench step is completed (the batch is Awaiting Review), the reviewer opens each step as the analyst recorded it, read only, and clicks Approve step.
- Each approval is a recorded mark (who and when), not a signature. This is the deck's slide 16: an affirmative clicked act per step, and one Part 11 signature for the release.
- The reviewer can undo a step approval until the batch is approved.
- Approve batch (signed "Reviewed by") is refused until every step is approved, every QC exception is accepted with a justification, and every reportable reading is chosen.
- Return to the analyst reopens a step and the steps after it. Those steps lose their approval (kept in the audit trail) and are approved again; earlier steps keep theirs.
- The reviewer must not have performed or witnessed any step, as before.

**A QC Review in the middle of a workflow**
- Alex: it covers everything done so far (for example the Day 7 review of USP <51>).
- Not built yet: today every QC Review step completes when the whole batch is approved, so there is no partial or timepoint release. This is to be built with question 4 (releasing timepoints separately).

**Review layout**
- **Results to report:** one row per sample, with its analytes nested under it. Only hits above the LOQ (or qualitative "found" results) are shown, plus anything to act on: a reading to choose, no result, or out of specification. The sample is repeated on every nested row, so a long analyte list keeps its place.
- **QC:** one row per QC entry (for example "Matrix Spike: 4 checks, 3 pass, 1 fail"), with only the failing or waiting checks nested under it.
- A switch on each table shows all analytes.
- A reportable reading picked in a nested row is saved at once.

See [[Decision - QC Review Build Choices]], [[Decision - Workflow Designer Slice Scope and Rules]], [[Electronic Signature]].
