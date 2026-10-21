---
type: Architecture Decision
status: Approved in principle (Alex, 2026-10-14); build choices Proposed; pull window default for QA (Jake Teller)
decided: 2026-10-14
built: 2026-10-14 (migration 032, seed 025, version 0.17.0)
---

# Decision - Stability Studies S-1

Builds on [[Decision - Stability Studies Are Quoted Whole and Pulled as Lab Orders]] (approved 2026-10-12).

**Alex, 2026-10-14:**
1. "Add some chambers and you'll need the racks where the sample is identified as well."
2. The ICH storage conditions as a preset list that labs can extend: yes.
3. "Stick with 7 day window but make it configurable. Add it as a Jacob decision." (QA item 41 in [[Open Items for QA Review]].)
4. The cumulative report: one table per test, timepoints as columns, against the specification: correct.
5. "The stability study needs to start as a quote, then submitted, approved quote converts into a study that triggers the samples to be logged in."

**As built**
- **Conditions:** the six ICH Q1A(R2) conditions are preset for every lab (25 °C / 60% RH, 30 °C / 65% RH, 30 °C / 75% RH, 40 °C / 75% RH, 5 °C, -20 °C, with their tolerances). System administrators keep those; each lab adds its own (permission `stability.configure`). A condition used on a quote keeps its temperature, humidity and type (retire it and add a new one instead).
- **Chambers and racks:** a chamber is a piece of equipment set to one condition (its calibration, tags and owners stay in Equipment). Each chamber has racks; study material is placed in a rack at a position (shelf / slot). A chamber holding material keeps its condition; a rack holding material cannot be retired or moved. Admin > Lab setup > Stability chambers also shows the upcoming pulls by chamber (read only).
- **The stability quote (SQ-00001):** a quote of its own kind, so sending, the client's accept/decline link, the Outbox email, Accept / Reject and Pricing > Quotes all work as for other quotes. Its page holds the study design:
  - the lab (the lab the quote was made in, as for every quote since [[Decision - Quote Pricing, Catalogue Updates and Serving Sizes]]: chosen when the quote is made, then fixed; every test of the study is that lab's own), product, lot, the client's protocol, the unit the material is counted in, a planned placement date (puts real dates on the quotation), the yearly price increase and the material reserve;
  - the conditions (chips), the timepoints (T0, then pulls with days early and late; fill down and paste);
  - the tests (one price per test; material per test; whether it is tested at T0);
  - the matrix: a row per test and condition, a tick per pull timepoint.
  - The study total counts each test at every timepoint where it is ticked, with the yearly increase; the quotation PDF shows the matrix per condition, the price per test, the price by study year and the terms.
  - It cannot be issued while anything blocks it: a test in no cell, a condition with no pulls, no T0, a test without an approved workflow, a client with no ordering contact.
- **Accepted (by the lab, or by the client through the link): the study (STB-00001)** is created with its **T0 order** (origin Stability Baseline): the baseline sample is Expected with its T0 tests, so intake can log it in.
- **Place in chambers** (permission `stability.manage`): each condition's material goes into a rack of a chamber set to that condition, in service, with the number of units. The material check compares it with every pull of the design plus the reserve and records any shortfall. The T0 sample is logged in if intake has not. The pulls are scheduled from the placement date.
- **Pulls:** each pull's date is placement + interval; a weekend or holiday moves to the next working day if the window allows, otherwise to the previous one. On its date (hourly job, or when the stability pages open) the pull gets its lab order (origin Stability Pull) with its sample Expected. **Record pull** takes the units out of storage, logs the sample in and records whether it was inside the window (a note is required outside it). The pull's turnaround counts from its scheduled date. Each pull's tests are priced for the study year they fall in.
- **The summary report** on the study page and as a PDF: per condition, one table per test, analytes down, timepoints across (T0 under every condition), against the specification; preliminary results marked, pending timepoints shown.

**Build choices (Proposed, for Alex to confirm)**
1. **"Submitted, then approved"** is read as: the quote is issued and sent to the client (Submitted), and the client's acceptance (online or recorded by the lab) is the approval. An internal price approval before sending is not built.
2. **The study is created at acceptance, the T0 order with it**; pull orders are made on their dates, never earlier.
3. **The T0 sample is logged by intake or at placement**, whichever comes first; placement always records when the material went into the chambers.
4. **Stored material is not a sample:** each condition's material is a labelled stored lot (STB-00001-1) in a rack; each pull makes its own sample and lab order. This keeps the sample IDs, TAT and backlog rules unchanged.
5. **The material check flags a shortfall but does not block placement** (a reason is asked for, as for every placement).
6. **Placement and pulls need a reason, not an electronic signature** (like logging samples at intake).
7. **The pull window default is a lab setting** (Sites and holidays, "Pull window (± days)", 7) that new timepoints start with; each timepoint can change its days early and late. The reserve (10%) is also a lab setting, overridable per quote.
8. **Study years count from acceptance**; a pull exactly on an anniversary is in the next year.
9. **Built in S-2 (0.23.0, [[Decision - Stability Studies S-2]]): amendments, cancellation with material disposition, excursion assessments, the issued report; billing per pull came with I-1. Originally listed as not built yet (S-2):** amendments to a running study (new version), cancellation with material disposition, excursions listing affected studies from logbooks, billing the pulls, the issued (signed) cumulative report, per-timepoint reports beyond the COA each pull gets.

Related: [[Stability Study]], [[Stability Pull]], [[Stability Condition]], [[Open Items for QA Review]].
