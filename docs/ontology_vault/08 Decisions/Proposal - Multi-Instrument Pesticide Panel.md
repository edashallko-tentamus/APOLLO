---
type: Proposal
status: Tabled (Alex, 2026-10-19: "Let's table this for now and I will meet with the lab to get these items confirmed before we build"; nothing built)
decided: 2026-10-19 (Alex's answers below)
---

# Proposal - Multi-Instrument Pesticide Panel

Alex, 2026-10-19: "how do we want to handle tests that use multiple instruments? Let's think about a pesticide method that uses LCMSMS Positive mode and LCMSMS Negative mode and GCMSMS data ... Do we build out the workflow to have 3 parallel tests, or should they be 3 different tests that combine to an ordered Test as Pesticide panel? ... the first step of a pesticide panel as a split off ... Or do we make it a test package?" He attached the instrument exports of batch #3662 (Pos 3662.xlsx, Neg 3662.xlsx, GC 3662.xlsx).

## Alex's answers (2026-10-19)

- One extraction feeds the instruments (this lab; another lab could differ).
- LC-MS/MS positive and negative: "looks like the same run". The files show the same instrument (SCIEX Triple Quad 6500+, 6500-1) and the same injection list, but two acquisitions about 12 hours apart (Positive 10/15/2026 4:07 PM, Negative 10/16/2026 3:50 AM): two reading imports in one LC batch.
- Each pesticide is reported from one technique (the files confirm it), except **chlorpropham**, measured by LC positive and GC: **report LC positive for now**.
- **TPP and TDCPP** are the internal standard and surrogate; not configured yet; they should appear as identified recoveries.
- The instrument software calculates the final results today (to change later to raw data); treat its output as raw data for now.
- The note "Positive if peak area > 10000" at the top of the LC exports: unknown use (perhaps over calibration). To ask the lab.
- The COA: one section per instrument.

## What the files show (batch #3662)

| | LC-MS/MS positive | LC-MS/MS negative | GC-MS/MS |
|---|---|---|---|
| Compounds | 349 (quantifier -1, qualifiers -2, -3) | 90 | 96 |
| Injections | 34: 7-point curve (0.5 to 100 ppb), ICV, MB, LCS, MS and MSD of 26-012335-0001, CCV, 19 samples | the same | 7-point curve (1 to 200 ppb), ICV, LCS, MB, MS, 3 CCVs with solvent blanks, 18 samples |
| Layout | one text column per row, "Sample; Analyte; ...; Calculated Concentration; Retention Time" | the same | wide: one row per compound, RT / Final Conc. / Accuracy per injection |

- Not every sample gets every technique: 26-012543-0001 is on both LC runs, not on GC.
- About 40 % of LC rows read "< 0"; some read "degenerate", "no root", "two roots" or "N/A". Proposed: "< 0" = not detected; the curve failures = readings that are not results (0.21.0), which hold the result until re-read or reviewed.
- The LC export's header does not match its rows (the "Analyte Peak Area" column holds the standard's lot, "1745_10.08.26 exp: 10/22/26"): the lab confirms its export template before an importer is written.
- Samples in one prep batch have different weights and matrices (5 g potato, 10 g soil, 2 g corn and supplements; dSPE clean-up on the supplements).

## Proposed design

1. **The client orders one thing**: "Pesticide panel (QuEChERS)", one quote line, one price, one due date (a package, 0.26.0, or a single test that orders the rest: to settle).
2. **A prep test** (QuEChERS extraction, clean-up, the prep QC: method blank, LCS, matrix spike and duplicate) records an **extract** for each sample and each prep QC: a vial with its own barcode carrying the sample weight, final volume and any dilution (the logbook aliquots' mechanism, L-2: a scanned item gives values to the formulas).
3. Its last step orders **the instrument tests** each sample needs (split off, without consent): **Pesticides by LC-MS/MS** (two reading imports, Positive and Negative, in one batch) and **Pesticides by GC-MS/MS**. They keep the panel's due date.
4. **Instrument batches** are made of extracts; by default the same extracts as the prep batch (this lab's practice), but another lab may combine prep batches. The prep QC extracts are read and judged on each instrument, traced back to the prep batch. Instrument QC: the curve (accuracy per level), ICV, CCVs, solvent blanks.
5. **Importers** for the SCIEX export (Pos and Neg) and the GC export: the quantifier transition is the result; qualifiers kept; "< 0" not detected; curve failures not results. No typing or pasting of 500 transitions.
6. **Internal standard and surrogate** (TPP, TDCPP): recoveries per injection, judged against limits, shown in QC Review; not reported as results.
7. **Chlorpropham**: reported from LC positive; the GC reading kept as information.
8. **The COA**: one section per instrument test.

## Open

- Which "> 10000" rule the lab applies, and whether it marks over-calibration.
- Limits for the internal standard and surrogate recoveries, the curve accuracy, the CCVs.
- When the instrument output becomes raw data (areas): the LIMS calculates from the curve, weight, volume and dilution.
- Package or parent test for the order.

## Alex's further answers and the plan (2026-10-19, later)

- **"> 10,000":** "set > 10,000 as an error". Claude Code questioned it: the exports' note reads "Positive If Analyte Peak Area > 10000 / Negative If <= 10000", which looks like the lab's detection rule (detected only above 10,000), and treated as an error every real detection would be flagged; the exports also carry no peak area column. Proposed: a setting on the test ("peak area above X = ..."), its meaning confirmed by the lab.
- **Internal standard (ISTD):** 50 to 150 % of area counts recovered. To confirm: against what (the mean ISTD area of the calibration standards, or the last CCV).
- **Surrogate:** 80 to 120 % recovery.
- **Which is which:** assumed TPP = internal standard (in all three files), TDCPP = surrogate (LC only). To confirm.
- **The order:** the client orders a parent test (as decided earlier).
- **May not be permanent:** "The pesticides slice may need to scrap and work on more with the laboratory ... We will want to keep the surrogate and internal standard (ISTD) regardless."
- **Plan when it resumes:** Part A (permanent): internal standards and surrogates for any test (designer: which, with limits; bench: area and recovery per injection; QC Review: judged like QC, never reported). Part B (removable): the parent test with extracts, the LC-MS/MS and GC-MS/MS instrument tests, the importers, in their own migration and files so they can be taken out without touching Part A.
- **Tabled** until Alex has met the lab: the "> 10,000" meaning, the ISTD reference, TPP / TDCPP roles.

## Related

- [[Decision - Test Packages and Dated Price Changes P-1]]
- [[Decision - Logbook Values Feed Results Through Scanned Materials]]
- [[Decision - Matrix-Driven Bench, Presumptive Alerts and Invalid Readings]]
- [[Decision - Analytical Runs, Preliminary Results and Order Statuses]]
