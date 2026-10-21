---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - Workflow Designer Micro Definitions

Alex Kiddle, 2026-10-13, after the Irvine micro SOP review ([[Context - AAL Irvine Micro SOP Review]]). Built as WD-1.1 (migration 013), before Claude Code tests WD-1.

**Positive control made from strains**
- A QC type in the Batching step can say it is made from strains of the test's organisms.
- At the bench (WD-4) the control's material must be a Microbiological Strain lot of one of the test's organisms; anything else is refused.
- There is one positive control (not one per organism), as Alex understands Irvine practice.
- A test with no microbiological analytes cannot ask for strains.

**Daily controls**
- A QC can run daily: one set per method per day, shared by that day's batches. This is how Irvine runs micro controls.
- Once per batch and every N samples stay for chemistry.

**Each test's own result values**
- Each qualitative analyte lists the values that can be entered, in order, and which of them mean "found".
- The default is Absent / Present (Present means found). Irvine micro uses ND / ND* / D* / D, with D* and D meaning found.
- A split-off on a finding reacts to the "found" values.

**Weights and amounts by product category (optional)**
- A controlled list of product categories (Cosmetic, Dietary Supplement, Food, Raw Material), shared by all labs and kept with the Matrix list. Each matrix may belong to one.
- A Weighing step has three choices:
  - No target: the analyst decides. This is the default, and what chemistry tests use unless they set a target.
  - One target ± tolerance.
  - A weight range per product category.
- A Dilution step can set its amounts per category (e.g. 1 + 9 for cosmetics, 10 + 90 for supplements, 25 + 225 for food).
- **Assignable and optional (Alex):** mostly for micro tests, not needed for chemistry. It is a build-out to try; if the GMs do not like it, it is dropped by not using it.
- Claude's reasoning for offering it: a weight range written in an SOP is a control an auditor can see when the system checks it, and an unprovable one when it lives only in training.

**Demo**
- USP <62> and USP <60> have a version 2 with these settings. It was approved by the demo Lab Supervisor, and version 1 was superseded.

**Not in this change (later slices)**
- Sending a split-off test to an outside lab with customer consent (WD-4).
- Formulas reading QC values, e.g. suitability recovery against the positive control (WD-2).
- Formulas reading logbook values ([[Decision - Logbook Values Feed Results Through Scanned Materials]]).
- The demo USP <61> suitability formula still uses the inoculum count. Irvine calculates recovery against the positive control average, which needs QC values in formulas (WD-2).

See [[Decision - Workflow Designer Slice Scope and Rules]]. QC limits per analyte: [[Decision - QC Criteria Are Set Per Analyte]].
