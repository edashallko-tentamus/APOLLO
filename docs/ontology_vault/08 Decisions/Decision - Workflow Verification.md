---
type: Architecture Decision
status: Approved in principle (Alex, 2026-10-13); build choices Proposed (to confirm with Jake Teller, QA)
decided: 2026-10-13
updated: 2026-10-13 (WD-6.1)
---

# Decision - Workflow Verification

Alex Kiddle, 2026-10-13: "a test validation check for a completed workflow - ideally it would involve an automated test sample that runs through the entire process and a validation document is provided with URS and FRS being satisfied, there needs to be objective evidence". Built by Claude in the cloud as WD-6 (migration 024, seed 019, version 0.11.0).

**Alex's decisions**
- Built in a new migration, not by changing 021 and 022 (numbered 024, after Claude Code's 023).
- QA signs the protocol and the report.
- The gate applies to every test version.
- It does not wait for the reporting slice: phase 1 (protocol, automated run, report in the app) now; phase 2 Playwright screenshots; phase 3 Word export.

**How it works**
- On a draft version's Review tab the designer writes the protocol (signed "Prepared by"). The server builds it from the design: URS (what the lab needs) and FRS (one per step, per QC criterion, the specification comparison, order statuses), the samples (typical, below the LOQ, outside the specification, below the LOD when ND applies), every value the run will enter, and the expected results.
- The expected results come from a second calculation written independently of the database engine (its own formula reader, exact decimals, rounding, LOQ and LOD reporting, conformance). Two implementations must agree: unrounded to 9 significant figures, reported results and conformance exactly.
- QA approves the protocol (signed; never its author). The designer executes it (signed "Executed by"): automated accounts do every step through the same rules as the bench and review screens, and the run challenges the controls (data missing, self-review, approval before step approvals).
- Each check records what the system produced. A check the run could not reach is Not tested, with the reason, never skipped.
- QA signs the report (signed; never the executor) and justifies each requirement not tested. Outcome: Pass, Pass with exceptions, or Fail.
- The version's design has a fingerprint; any change after the protocol voids it. With the lab setting "Verify workflows" on, a version is approved only with a signed, passing verification of exactly its current design.
- It verifies the configured workflow of one test version. It is not method validation and not the validation of LIMS3.

**Build choices (Claude, to confirm)**
- Three automated accounts (Verification analyst, witness, reviewer): no password, cannot sign in, never in a group, rights only at the verification's lab and only during its run. The analyst also holds review rights so the "did the bench work, cannot review" check is refused for that reason. Signatures say "Automated verification run".
- The run's samples are on an internal order (client "LIMS3 Workflow Verification (internal)") with codes VER-000001-1, not the lab's sample numbers. Its batches stay out of the lab's lists, the backlog and inventory stock, and share daily QC only within the same verification.
- QC readings are set at run time so each QC meets its criteria (recoveries solved from the standard or spike recorded). QC verdicts are recorded; QC arithmetic is not independently recomputed.
- "Pass with exceptions" (requirements not tested, each justified by QA) opens the gate; "Fail" never does.
- The gate is a lab setting, on for CFL and TPS. Versions approved before keep their approval.
- A new protocol cancels the version's earlier ones not signed off. The whole run is one transaction (the app waits a few seconds); if the run itself breaks, nothing is kept.

**What the first runs found (2026-10-13, demo tests)**
- Heavy Metals, USP <61>, both USP <62> tests and Vitamin C stability: Pass.
- MALDI-TOF: Pass with exceptions (no MALDI-TOF instrument at CFL). USP <60>: Pass with exceptions (no strain lot of its organism).
- **USP <51>: Fail, a real defect.** A negative control counted 0 goes through log10(count x factor): the calculation errors, the step treats it as "waiting for data", so "Initial: log count" can never be completed with a clean negative control; its Absence QC also shows Waiting. For Alex to decide (suggested: judge micro controls on the raw reading; a QC entry's calculation error does not block the Calculation step).

**WD-6.1: objective evidence and the Word document** (Claude in the cloud, migration 025, version 0.12.0; Alex: "there needs to be objective evidence so screenshots are something that we would love to have", "Make the next slice for the verification piece please")
- After the run, the server opens every page the checks point to in a headless browser, signed in as the person who executed the run: the verification order, each step of each batch, the batch's Results and QC, each sample's approved results. Each page is a fresh load, stamped across the top (verification, E-number, page, time, person), and kept as a full-page PNG with its SHA-256. Each check names its screenshots (E-01...).
- The database checks each image against its SHA-256 and keeps it unchanged (no edit, no delete). The capture is signed "Evidence captured by", once per verification. QA signs the report only once the evidence is captured.
- "Word document" downloads the protocol and report with every screenshot in Appendix A. It is made from the record when asked; nothing is stored, so the record in LIMS3 stays the master.

**WD-6.1 build choices (Claude, to confirm)**
- The capture starts by itself right after the run, under the executor's signature for the run (the same password check, a second signature event "Evidence captured by"). If it fails, the designer or QA retries it with "Capture the evidence" (signed).
- Screenshots are taken by the server as the executor, not by the automated accounts, so they show exactly what that person can see.
- One screenshot per page (a check that a page shows is linked to it), not one per check. Pages that could not be captured are listed on the record and in the report.
- The Word document is generated, not stored or signed itself: the signatures are on the record it is made from.

See [[Open Items for QA Review]] (items 24 to 29), [[Decision - Analytical Runs, Preliminary Results and Order Statuses]], [[Decision - Media Qualification, Batch Edits and Barcode Labels]].
