---
type: Architecture Decision
status: Approved (Alex, 2026-10-16); build choices Proposed
decided: 2026-10-16
built: 2026-10-16 (migration 040, version 0.22.0)
---

# Decision - QA Testing of Inventory Before Use

Generalizes [[Decision - Media Qualification, Batch Edits and Barcode Labels]] (0.10.0), which covered Media lots only. Relates to [[Inventory Lot]] and [[Inventory Status]] ("quarantined", "rejected").

**Context.** Alex (2026-10-16), looking through the Inventory module: "we didn't incorporate the addition of inventory items sent for QA testing. Can we create that feature?" Media qualification already tested new Media lots before use (a test sample carrying the lot's ID; QA's approval of its batch releases the lot for named tests). Nothing did the same for reagents, reference standards, raw materials or consumables.

## Alex's answers (2026-10-16)

1. **Where the testing happens: in the lab.** A test from the Workflow Designer, run on a test sample carrying the lot's ID, in the lab's own batches (as media).
2. **What a pass releases: chosen per lot.** Either **every use**, or only **named tests** (as media is qualified for a test's organisms).
3. **Which items: the lab sets defaults.** A default per item type for each lab (Media on, as before), which can be overridden per item when it is received.
4. **A failure: Rejected, can be retested.** The lot is blocked for every use. QA may order a retest, or dispose of the lot or return it to the supplier.

## What was built (migration 040)

- **Lab defaults** (Inventory > QA testing): one row per item type for each lab, "Tested before use" plus a note (e.g. the SOP). Every lab starts with Media on and the others off; a new lab gets the same. Kept by QA (new permission `inventory.qa_configure`, standard group QA), with a Reason for Change, audited.
- **At receipt** the New Inventory Item form shows "Send for QA testing before use", ticked by the lab's default for the item's types. Anyone receiving may tick it for any item; **only QA may untick it** when the lab's default asks for it (the database refuses otherwise). Receive many (paste) uses the lab's defaults. Demo data loaded by seeds still counts as tested.
- **Status of a lot** (`lot_qa_status`): Awaiting QA testing, In QA testing, Released for every use, Released for named tests, Rejected, Rejected (retest under way). Shown on the lot page, as a column and a "QA testing" filter on the inventory list, on the lot's barcode label, and on the QA testing page (lots waiting, being tested or rejected).
- **Send for QA testing…** on any received lot (`inventory.qualify`, as before): rows of *Released for* (Every use, or a test) and *QA test*. One test sample with the lot's ID on the lab's internal order, logged at once; it joins batches outside their size and QC (as media). The table `media_qualification` keeps its name and now holds every lot's QA testing (`use_test_id` empty = every use).
- **QA's approval of the batch decides:** released, unless a final result does not conform: then the lot is **Rejected for every use**.
- **Retest…** on a rejected lot: a new QA test on the same lot sample (`requested_test.retest_of_id`, `media_qualification.retest_of_id`). The lot stays rejected while it runs and is released when a retest passes. The history (Failed, then Passed) is kept. Dispose is the existing action (signed, with a reason; "returned to the supplier" is written as the reason).
- **Waive QA testing…** (QA only, signed, with a reason): for one lot that the lab's default asked to test, before anything was sent for it. A lot that was sent is decided by its result (a rejected lot cannot be waived).
- **Where the rule bites** (`lot_qa_problem`): the bench refuses a lot not released for the batch's test (in its own QA batch it is always allowed); the bench's lot list marks such lots NOT RELEASED with the reason; an in-house mixture takes only lots released for every use; workflow verification runs pick only released lots.

## Build choices (Proposed: not yet confirmed by Alex)

1. **Waiving is QA's alone.** Only `inventory.qa_configure` (standard group QA) can receive an item without the lab's default testing, waive it for a lot, or change the defaults. Lab Supervisors do not hold it by default.
2. **A failure blocks every use**, even a use already released by another QA test of the same lot (stricter than media before 040, where a failure blocked only the failed test). This applies to media lots already in the system that failed a qualification: they now show **Rejected**.
3. **Defaults apply to items received from the change on.** Items already received keep their status; QA sends them, or waives them, from the lot's page.
4. **Recording routine usage outside a test** (Record usage) is not blocked for a lot waiting for QA testing (the QA chemist may record the aliquot taken for the test). Only bench steps and mixtures are blocked.
5. **The lot's own test sample stays one sample**; a retest is a second requested test on it, not a new sample.
6. **Words:** "Media qualification" on screens became "QA testing" and "Lot QA testing" (backlog, batches, order page). New databases name the internal client "Internal: QA testing of lots"; an existing "Internal: media qualification" client keeps its name.
7. **Logbook entries** that name a lot are not checked against its QA testing yet.

## Questions for QA (Jake Teller)

- Which item types each lab tests before use, and the QA test for each (identity, assay, growth promotion, sterility).
- Whether a supplier COA review can stand in for testing (today: QA waives with a reason).
- Whether a failure should block every use (built) or only the failed use.

Related: [[Decision - Media Qualification, Batch Edits and Barcode Labels]], [[Decision - Inventory Slice Build Choices]], [[Open Items for QA Review]].
