---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - Media Qualification, Batch Edits and Barcode Labels

Alex Kiddle, 2026-10-13. Built the same day as 0.10.0 (below). His original notes are in `CLAUDE.md`, "Alex's notes for the next slice".

## Media qualification
- Each new Media lot is qualified before use: tested first, then released for use in the lab.
- The testing is media QC: growth promotion (a small known count of the right organisms must grow), a sterility / negative check, and for selective media the inhibitory and indicative checks. These are test workflows built in the designer.
- On the lot, the user selects the tests the media is to be qualified for (for example USP <61> TAMC). These decide the organisms used for growth promotion.
- The qualification **test sample uses the inventory lot's ID** (for example INV-000123), so it is plainly a media sample and not a client sample, and it is **not subject to the batch rules** for client samples: it can sit in a normal batch but does not count toward the batch size or its QC (Alex: option B).
- When QA approves the qualification review, the lot is released automatically, and **only for the selected tests**: the bench refuses it for any other test.

## Adding and removing samples in a batch
- Inside a batch that has not started (no bench step completed after Batching), samples can be added from the backlog and removed (back to the backlog). From the backlog, right-click a sample, "Add to batch".
- **No signature and no reason**: a plain function, still recorded in the audit trail.

## Barcode labels
- Every lab item gets a printable, scannable label: samples, inventory, batches, equipment.
- **1D barcode (Code 128)**: most labs already have 1D scanners. The ID is also printed as text.
- **Printer: Dymo LabelWriter 450**, printed from the browser through the Dymo driver.
  - Sample labels: **2 1/8 x 4 in.**, listing the tests and due dates.
  - All other labels: **1 x 2 1/8 in.**, with the item or equipment name, the inventory expiration date or the calibration expiry date.
- By default, as many labels print as there are units (inventory units, samples, batch containers).

## Built (0.10.0, Claude Code, 2026-10-13)
Migration 023, seed 018. Alex's answer on "outside the batch rules": **B**, the media sample can be in a normal batch but does not count toward the batch size or its QC brackets. Labels may continue on a second label. See `CLAUDE.md`, "0.10.0".

## Build choices (Proposed: not yet confirmed by Alex)
- The media sample is logged at once on an internal order per lot (client "Internal: media qualification"), with no price; its due date follows the qualification test's catalogue TAT; its limits are the qualification test's default specifications.
- Passed = QA approved the batch and no final result "does not conform". A result with no specification does not fail it.
- A failed lot is not put On Hold automatically; the bench refuses it for the failed test. Re-qualifying a failed use is allowed (a new qualification row).
- Media lots already in the system before 023 (and demo media) are treated as qualified for everything. A lot transferred to another lab must be qualified there (tests are per lab).
- Starting a qualification is not signed (the test's own steps and QA's approval are). New permission `inventory.qualify` given to Analyst, Lab Supervisor and QA.
- "Not started" for batch edits = nothing recorded at any step after Batching (values, materials, equipment, files, preparation fields). Adding or removing reopens a completed Batching step, so the analyst signs Batching again.
- Batch entry labels: a sample's tube label carries the sample ID barcode; a QC entry's carries the batch ID. Sample labels fit 6 tests on the first label and 10 on each continuation.
- Receiving an "Other" purchase puts it into inventory by default (Service: not by default); the new item opens in Edit. Actual price is per unit, per receipt.

**2026-10-16 (0.22.0):** media qualification was generalized to any item: [[Decision - QA Testing of Inventory Before Use]]. A failed lot is now rejected for every use until a retest passes.

Related: [[Decision - Chemistry Execution Scope and Rules]], [[Decision - Workflow Designer Micro Definitions]], [[Decision - Micro Bench Build Choices]].
