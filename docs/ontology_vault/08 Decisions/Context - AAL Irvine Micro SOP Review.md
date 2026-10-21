---
type: Context
status: Context only (not decisions)
reviewed: 2026-10-13
---

# Context - AAL Irvine Micro SOP Review

Claude, 2026-10-13. Review of the Irvine (Adamson Analytical Laboratories, AAL) microbiology SOPs Alex shared, for context only. Alex: "use it as context, not for final decisions". Nothing below changes the design until it is discussed; SOP text is summarised, not copied.

**Reviewed (28 SOPs, scanned, read by OCR):**
- Neutralizer efficacy (suitability).
- P/A methods: B. cepacia, C. albicans, A. brasiliensis, Z. rouxii.
- Coliforms, bile-tolerant gram-negative, heterotrophic plate count, CertaBlue.
- 3M Petrifilm counts and real-time PCR (Salmonella, Listeria).
- Positive and negative controls, microbiology batch, the QCS program, investigation of results.
- Digital capture of plates, air quality, labels, PET sample management, aseptic technique, sharps.

**Referenced but not in the folder:**
- I-0004 Microbial challenge (PET).
- I-0006 TPC and yeast and mould.
- I-0007 and I-0016 media preparation and QC, including growth promotion.
- I-0021 Monthly positive culture preparations and generations.
- The USP <62> methods for E. coli, Salmonella, S. aureus and P. aeruginosa.
- C-2015 OOS.

## What it means for the design (for WD-2 to WD-4, and the OOS slice)

1. **Micro controls are daily and per method, not per batch.**
   - Each day: one positive control per method, from the reference strain on that method's selective agar (e.g. E. coli ATCC 8739 on MacConkey for USP <62>).
   - Negative control plates (neutralizer broth streaked).
   - A negative control sample run alongside the batch for every method on it.
   - The batch QC model (per batch) needs a "daily control set" scope shared by that day's batches.
2. **Strains are the controls' material.** Working cultures come from monthly generations of seal-stock plates (I-0021). Strain lots need generation/passage tracking and a link to their parent.
   - Reference strains: E. coli 8739, S. aureus 6538, P. aeruginosa 9027, C. albicans 10231, A. brasiliensis 16404, B. subtilis 6633, S. Typhimurium 14028 and B. cepacia 25416.
3. **Sample amount depends on the product category; the dilution is always 1:10.**
   - Cosmetics: 1 g in 9 mL.
   - Dietary supplements: 10 g in 90 mL.
   - Food: 25 g in 225 mL.
   - Weighing and Dilution defaults need to vary by product category (matrix), with a ±10% weight allowance.
4. **Qualitative results have four values, not two:**
   - ND: not detected.
   - ND*: not detected, other organisms present.
   - D*: possible growth detected.
   - D: detected, only after identification.

   Each test needs its own result vocabulary. D* is what triggers confirmation and identification.
5. **Identification is sent out** (to the BAV lab or another certified lab) with the customer's consent. Split off must support a subcontracted test and a consent step; in-house MALDI-TOF does not apply at Irvine.
6. **Suitability (neutralizer efficacy) is one SOP across many methods, each with its own organisms.**
   - Recovery = sample average / positive control average × 100 (50 to 200% for USP <51> and <61>; at least 50% for the ISO methods).
   - On failure, the work is repeated at higher dilutions (10^-2, 10^-3).
   - Formulas need QC values (the positive control's count) as tokens. A failure needs a "repeat at the next dilution" rule.
7. **Daily Quality Control Samples (QCS, ISO 17025):**
   - Frozen aliquots of four strains are plated daily.
   - Recovery is calculated on a log scale against a "true value" (the mean of the first 20 results).
   - Results are plotted on control charts with UCL and LCL. A result outside them must be raised before results are reported.
   - This is a lab-level program with trending, not part of one test.
8. **PET:**
   - A plate count prescreen (fewer than 10 CFU) must pass before the challenge starts, and the customer may stop the test.
   - Start is scheduled 1 to 2 weeks after receipt, and timepoint dates are tracked.
   - Methods: USP <51>, ISO 11930, PCPC M3/M5/M6, EP/BP, JP.
   - Needs a prerequisite-result gate (Hold Point with a condition) and a timepoint schedule.
9. **Bench records:**
   - The media lot is recorded per sample.
   - Photos of the daily control plates and of positive sample plates are kept, so Data Entry attachments include images.
   - Counts have countable ranges (15 to 150 on Petrifilm), TNTC and estimated counts.
   - Labels carry the sample number, dilution and barcode.
10. **Investigations:**
    - Phase I by the analyst, then Phase II (client request or lab error).
    - A retest by a different analyst, in duplicate where possible.
    - Numbering OOS-YY-NNN, shared by all departments. QA decides whether the client is told.

## Checks against the demo tests (WD-1)
- **USP <60>:** enrichment 30-35 °C for 2 to 3 days and BCSA for 48 to 72 h match the demo.
- **USP <62> C. albicans:** enrichment 3 to 5 days matches. At Irvine the confirmation runs on chromogenic agar before identification.
- **Salmonella:** the strain is S. Typhimurium ATCC 14028.
- **USP <61> suitability:** recovery is against the positive control average, not the inoculum count. The demo formula should change when this is taken up.

See [[Decision - Workflow Designer Slice Scope and Rules]], [[Decision - Workflow Designer Build Choices]].
