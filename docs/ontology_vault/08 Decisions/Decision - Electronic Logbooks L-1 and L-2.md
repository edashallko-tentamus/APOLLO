---
type: Architecture Decision
status: Approved in principle (Alex, 2026-10-14); build choices Proposed; QA items 42 to 49 for Jake Teller
decided: 2026-10-14
built: 2026-10-15 (migrations 034 and 035, seeds 027 and 028, version 0.18.0)
---

# Decision - Electronic Logbooks L-1 and L-2

Builds on [[Decision - Electronic Logbooks Are Computational]], [[Decision - Logbooks Wait for the Workflow Designer]] and [[Decision - Logbook Values Feed Results Through Scanned Materials]] (all Approved). Objects: [[Electronic Logbook]], [[Logbook Template]], [[Logbook Entry]]. Rules: [[Part 11 Logbook Rule]], [[Logbook Failure Flag Rule]], [[Logbook Value Approval Rule]], [[Logbook Correction Flag Rule]], [[Aliquot Weight Review Rule]]. Capability: [[Electronic Logbooks]].

**Alex, 2026-10-14 (22:31), answering the L-1 / L-2 proposal:**
- "Build both of them and I'll test the whole module in the morning. Make it 1 slice or 2 slices if you prefer."
- 1. "agreed but add the pertaining logbooks for USP 61 and 62 tests and USP 51"
- 2. "I think it should be flagged and a reason is prompted at failure. Flag happens at QC review steps with that equipment."
- 3. "Yes"
- 4. "QA should approve the logbooks weekly or daily just depends..."

Built as one module, version 0.18.0: L-1 (logbooks, migration 034) and L-2 (logbook values feed results, migration 035).

## L-1: logbooks (migration 034)

- **A logbook** (LB-0001) belongs to a lab. Settings, not versioned (a change keeps its reason in the audit trail): kind, what each entry is about (a piece of equipment, an inventory lot, a sample, or nothing), how often entries are due (Daily, Weekly, Monthly, As needed), how often QA approves them (Daily or Weekly, per logbook: Alex's answer 4), signed or only recorded, reviewed in the logbook or in the batch that uses it, how long an entry may be used (hours), and whether each entry makes an inventory lot.
- **Its design is versioned.** Fields in order: Number, Text, Choice, Pass/Fail, Date/time, Equipment, Lot, Calculated. A field can have lower and upper limits, limits per piece of equipment, be required, carry a formula (`{nominal_g}` for a field before it, `{culture_lot.passage}` for a value published on a Lot field's lot) and be **published** (a value other records can use, L-2). Version 1 starts as a Draft; QA approves a Draft (signed, permission `logbook.review`, never someone who designed it). After that a change is a new version, approved again; entries keep the version they were made with.
- **Equipment covered:** an equipment logbook lists its units, with limits per unit (the analytical balance 0.05 %, the top-loading balance 0.1 %). A stability chamber's temperature and humidity limits come from its condition and tolerance, so they never disagree with the study.
- **Recording entries:** Testing > Logbooks > Record entries. A grid with one row per unit (or empty rows), paste from Excel and fill down; calculated values and Pass / Fail are previewed and worked out again by the database on save. One signature records every row (when the logbook signs). Equipment and lots used in an entry must be usable (available and in calibration; received, Available and in date). An entry cannot be in the future.
- **A failing entry (Alex's answer 2):** the entry is recorded, Fail, with the values outside their limits. **The reason is asked for before signing** ("re-checked, adjusted, taken out of use, supervisor informed"). It is not refused, and the equipment is not tagged out by it.
- **The flag (Alex's answer 2):** every batch step that used the equipment from the last passing entry before the failure until the next passing entry (or until now) is flagged. The flag appears in **QC Review** (and in a timepoint review) as "Equipment flagged by its logbook": the reviewer accepts each one with a justification, kept with their name. The batch (or the timepoint) cannot be approved until every flag is accepted. The failing entry's page lists the batches it flags, and the equipment page shows the open failure.
- **Stability excursions:** a chamber reading outside its condition is listed on every study stored in that chamber at the time (Chamber excursions card on the study page).
- **QA approval (Alex's answer 4):** QA > Logbook review lists every entry waiting, late ones first; QA ticks entries and approves them with one signature. Due by: the next day for a Daily logbook; by the end of the following week for a Weekly one. Late entries are shown as overdue (nothing is blocked). Nobody approves an entry they recorded or corrected. QA can return an entry for correction.
- **Corrections and voids:** a correction needs a reason (and a signature when the logbook signs); the old values stay in the audit trail; an approved entry that is corrected goes back to QA. Voiding is for entries made in error and needs a reason; an entry used at the bench or by a result cannot be voided (it is corrected instead).
- **Permissions:** `logbook.record` (Analyst, Lab Supervisor, Intake), `logbook.design` (Lab Supervisor, QA), `logbook.review` (QA).

## L-2: logbook values feed results (migration 035)

- **Published values in formulas:** a Calculation can read `{inoc.cfu_added}`: a value published by the logbook entry of the lot scanned at the step `inoc`. The designer offers the lab's published values on the steps that take materials. A lot that names organisms serves only those analytes (the S. aureus inoculum gives the S. aureus recovery).
- **At the bench:** adding a lot that carries logbook values records its entry with the material (shown on the step: `INV-000041 · LBE-000083`). The approved usable entry is taken; when there are several and none or more than one is approved, the analyst chooses. **A lot past its validity is refused** ("usable until ..."). A result waits for QA: "Waiting for QA to approve LBE-000083". The Calculation step cannot be completed until it is approved.
- **Lots made by logbooks (Alex's answer 1):** an inoculum entry makes its lot (INV-), named after the organism and the culture it came from ("Challenge inoculum: Staphylococcus aureus (from INV-000028)"), carrying the culture's organisms, usable for the logbook's validity hours. The lot page shows the entry and its values.
- **The result keeps the values it used.** When a used entry is corrected later, every result that used it is **flagged** (what it used and the corrected values) and the result is not changed. A reviewer (QC Review rights) who did not make the correction resolves the flag with a note. The entry page lists the results that used it.
- **Sample weights logbook (pre-analytical):** intake weighs aliquots and labels each with its entry code (LBE-). At the Weighing step, **Scan aliquot** fills the sample's weight and records the balance it was weighed on. A typed weight cannot replace it (scan another aliquot instead). These entries are reviewed in the batch, not by QA in the logbook: QC Review lists every aliquot of the batch's samples (used or not, repeat weighings, who weighed, the balance and its calibration then). The reviewer may not be the person who weighed or corrected an aliquot used. Approving the batch marks the aliquots it used as reviewed.
- **Release check:** the COA release check blocks a test whose result used a logbook entry that is not approved (or reviewed in its batch), or has an open correction flag.
- **Workflow verification:** the protocol picks, for each analyte, a usable approved lot at the lab whose entry publishes the value, and the run scans it. When no lot gives a value, the protocol says so (record and approve one, then write the protocol again).

## Demo data (seeds 027 and 028)

- **Equipment checks (027):** LB-0001 Daily balance check, LB-0002 Monthly pipette check (gravimetric; P10 #3 failed 12 days ago), LB-0003 Temperature log (fridge, incubator, the four stability chambers; a fridge excursion 3 days ago, chamber 1 at 28.1 °C 2 days ago, which shows on STB-00001). Six days of entries; QA approved those before this week.
- **Micro (028, Alex's answer 1):** LB-0004 Reference cultures (passage, at most 5); LB-0005 USP <61>/<62> challenge inoculum (not more than 100 CFU; makes a lot, usable 24 h; S. aureus, P. aeruginosa, B. subtilis, C. albicans and A. brasiliensis approved, E. coli waiting for QA); LB-0006 USP <51> inoculum standardization (about 1 x 10^8 CFU/mL; all five organisms, approved); LB-0007 Daily positive and negative controls; LB-0008 Sample weights (pre-analytical; aliquots of MV-2201 and TUR-2202 for the USP <62> backlog).
- **Version 2 drafts:** USP <61> suitability (recovery = CFU recovered / `{inoc.cfu_added}` x 100) and USP <51> (initial count from `{inoc.cfu_per_ml}`). Left as Drafts because CFL requires a workflow verification. The USP <61> verification passes. The USP <51> one still fails on the defect found in WD-6 (a negative control counted 0 goes through log10): not a logbook problem, and still waiting for Alex's decision.

## Build choices (Proposed, for Alex to confirm)

1. **One module, two migrations** (034 then 035, after Claude Code's 033), delivered as 0.18.0.
2. **A failing check flags; it does not block or tag out** (Alex's answer 2). The window runs from the last passing entry before the failure to the next passing one. Steps count when they recorded the equipment, or held an incubator load, inside the window.
3. **The reviewer accepts each flag** in QC Review (QC Review rights, the same independence rules); QA is not asked separately.
4. **Design changes on a Draft need a reason, not a signature**; QA's approval of the design is signed. (Test workflows sign every Draft change, WD-1.3; Alex prefers lighter Draft signing, so logbooks start there.)
5. **Entries are signed by default**, switchable per logbook to "recorded" (no signature).
6. **QA due dates:** Daily = by the next day; Weekly = by the end of the following week. Overdue is shown, not enforced.
7. **Validity counts from the entry time.** An inoculum lot's expiry date is the last day of its validity.
8. **Several usable entries on one lot:** the approved one is used; otherwise the analyst chooses (never a guess).
9. **A correction after use flags results; it never changes them.** Whoever corrected the entry cannot resolve its flags.
10. **An aliquot's weight cannot be typed over**; a repeat weighing is a new aliquot scanned in its place, and both stay visible to the reviewer.
11. **Excursions are listed on the study, not assessed in the system yet** (an excursion assessment record is for S-2).
12. **Demo limits are placeholders** for QA to replace: balance 0.05 % and 0.1 %, pipettes accuracy ± 0.8 % (P10 ± 1.2 %) and CV 0.3 % (P10 0.8 %), in the style of ISO 8655, the USP <51> inoculum range 1 x 10^7 to 1 x 10^9 CFU/mL, not more than 100 CFU for USP <61>/<62>, passage at most 5.

## Not built yet

- Excursion assessments on a stability study (S-2).
- Logbook templates shared between labs (each lab designs its own today).
- Due reminders by email; dashboards of overdue entries outside the logbook pages.
- Daily controls feeding the batch QC directly (the demo LB-0007 is a record only; the batch still runs its own daily controls).
