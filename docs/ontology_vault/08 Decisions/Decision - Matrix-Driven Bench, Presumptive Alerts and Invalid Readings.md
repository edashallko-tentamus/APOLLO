---
type: Architecture Decision
status: Approved in principle (Alex, 2026-10-15); build choices Proposed
decided: 2026-10-15
built: 2026-10-15 (migration 039, version 0.21.0)
---

# Decision - Matrix-Driven Bench, Presumptive Alerts and Invalid Readings

Builds on [[Decision - Workflow Designer Micro Definitions]] (product categories, weights and enrichment amounts per category), [[Decision - Analytical Runs, Preliminary Results and Order Statuses]] (analytical runs), [[Decision - Micro Bench Build Choices]] (incubator loads, split-off requests).

**Context.** Colleen Villanueva (Director, Food & Life Sciences, Midwest & Eastern Regions) asked for a demo of the Salmonella BAX Q7 screen with reflex to confirmation (SOPs MC-12.06 rev 1 and MC-12.04 rev 1, paper log MCF-034). She wants: login by matrix (food, sponge, stick, dry pet food) driving enrichment volume and incubation window; media lots, incubator, time in and out; a BAX batch with per-shift QC; an indeterminate or signal error forcing a re-run; a presumptive positive auto-notifying the customer distribution list with an audit trail; the confirmation steps in the LIMS instead of on paper; a final COA for a negative and a confirmed positive. Mapping the SOPs onto LIMS3 0.20.1 found three of these only half supported. Claude proposed three features (F1 to F3).

**Alex, 2026-10-15:** "build the missing items as you suggested".

## What was built (migration 039)

- **F1, the matrix drives the bench.** A sample's product category is its matrix's (Admin > Matrices).
  - Weighing "a range per product category": each sample is checked against its own category's range (outside is flagged, not refused, as before). A category can be **Not weighed** (sponge and stick swabs): the step no longer waits for its weight or a balance. **Prep QC (controls) are not weighed** is a step setting.
  - Dilution amounts per category (already stored since WD-1.1) are now used at the bench: an Expected column per sample, one button fills each sample's own amounts, a different amount is flagged.
  - Incubation: an **acceptable window per product category** (e.g. dry pet food 22 to 26 h while food keeps 20 to 24 h). A load holding several categories is judged against the window they all share (the latest shortest, the earliest longest); controls use the step's window.
- **F2, presumptive positive alert.** A Split off Test step can be set to **Alert the client**. When the analyst completes it, each request raised on a finding emails the client's **Positive alerts** contacts (a new contact role), else its Receives Report contacts, else the order's contact, once. The Outbox keeps each email with who completed the step and when; the batch's split tab and the sample page show "Client alerted". Nothing is sent from the Sandbox (Outbox only).
- **F3, readings that are not results.** Per qualitative analyte, a list of values that are **not results** (e.g. Indeterminate, Signal error). They are never a candidate for the reported result and cannot be chosen; the bench marks the row "Re-run required"; QC Review lists them; the batch cannot be approved until the sample has a valid reading in a later analytical run. A control read so is "Invalid" (not pass or fail) until read again; a failure on that re-read needs the reviewer's acceptance.

## Build choices (Proposed)

1. A load holding samples of several categories is judged against the window they share; a lab that wants each category judged alone loads them separately.
2. Controls are judged against the step's window, not a category's.
3. The alert is sent when the Split off step is completed (signed by the analyst), before QC Review: MC-12.06 8.5.3 says "immediately notify". It is not sent again if the step is reopened and completed again.
4. Recipients: Positive alerts contacts, else Receives Report, else the ordering contact.
5. The alert is sent only for a "On finding" split-off, never for verification batches or media qualification samples.
6. A value that is not a result cannot also mean "found", and at least one value must be a result.
7. Re-running a reading from a new lysis is an analytical run with a note (no separate "re-lyse" choice).
8. No new permission: the settings are design work (methods.design), the alert follows the analyst's step, contact roles are set as before.
9. The design fingerprint (workflow verification) includes the values that are not results only when a test has some, so earlier verifications stay valid.

## Not built (later, with Colleen's lab)

- Ending a sample early when no suspect colonies grow (every step still runs for every sample in the batch).
- "Re-lyse" as its own re-run choice; hold-time checks (enrichments up to 4 h, PCR tubes 10 to 30 min before loading).
- The test portion on the COA (e.g. "Negative in 25 g", "Negative per sponge"); reading the Q7 export directly; a true "per shift" QC frequency.

## Points for Colleen (found while mapping her SOPs)

- MC-12.06 8.5.3 says confirm "upon request by the customer"; her email says "reflex". The Split off step's "Customer consent required" setting decides which.
- MC-12.06 8.1.5 uses BHI, which section 4.0 does not list. MC-12.04 4.4 "Bismuth sulfate agar" should read bismuth sulfite agar. MC-12.04 7.1.3 and 7.1.4 split one sentence.
- Neither SOP states control acceptance criteria; the BHI step has no time or temperature tolerance; the two SOPs give 35 ± 1 °C and 35 ± 2 °C for the same incubator.
