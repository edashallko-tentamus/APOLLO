---
type: Architecture Decision
status: Proposed
decided: 2026-10-13
---

# Decision - Workflow Designer Build Choices

Claude, 2026-10-13, while building [[Decision - Workflow Designer Slice Scope and Rules]] (WD-1, migration 012). These choices are not yet confirmed by Alex. All are easy to change.

**Versions and approval**
- Draft edits need no signature and no typed reason; the screens record "Draft edited". **Superseded (WD-1.3):** every creation and change is now signed, with a reason for changes: [[Decision - Test Workflow Changes Are Electronically Signed]].
- Renaming a test, or changing its department, after it has an effective version needs a reason.
- Approval is one signed action, "Approved by". The approver needs methods.approve and must not appear anywhere in the version's audit trail (whoever created or changed it or any of its parts). This applies to system administrators too.
- Approval is refused while the database finds any Error.
- Approving takes effect at once, with no future effective date. The previous effective version is superseded, and tests already ordered keep their version.
- A new version is a Draft copy of the effective one. Only one Draft is allowed at a time, and there is no "discard draft" yet.
- Tests made before the designer keep their version 1 Effective without approval.

**What stops approval (Errors)**
- No department or method (SOP).
- No analytes, or a Numeric or Count analyte without a reporting unit.
- The workflow does not have exactly one first step.
- Batching is not first.
- A branch does not end in a QC Review, or the workflow has no QC Review.
- Weighing, Incubation, and Data Entry with an attached export have no equipment type, or not exactly one main type.
- A step's settings are incomplete.
- A formula is malformed, or uses a step that does not come before it, or a value that step does not offer.
- A split-off or hold-point test is missing, retired, this test itself, or another lab's.
- A department with nobody in a group for it, and an unpriced test, are Warnings only.

**Methods (SOPs)**
- A method belongs to a lab: method name, SOP code, SOP link, notes.
- Copying a test to another lab reuses that lab's method of the same name, or copies it.
- SOP document upload exists in the database but has no screen yet.

**Copying**
- A copy to another lab matches departments by code and equipment types by name. Anything unmatched shows as a problem to fix.
- Catalogue prices are copied (not shown in the public catalogue). The copy starts as a Draft version 1.

**Steps and formulas**
- Each step has a short key used in formulas ({weigh.weight}).
- Weighing offers weight. Dilution offers factor and final_volume. Incubation offers duration. Data Entry offers reading. Calculation and Hold Point offer result. Preparation offers its Number fields.
- Formulas allow numbers, + − × / ^ ( ) and log10, ln, exp, sqrt, abs, min, max and power. The database checks and evaluates them, which is the engine for WD-2 and logbooks.
- Removing a step removes its connections.
- A Data Entry step that is a manual observation (no attachment) needs no instrument.
- Split off on a finding can name several Data Entry steps.
- "Laboratory Control Sample" was added to the QC types.
- Result types are Numeric, Qualitative, Count and Text. Text is for identifications.

**Reporting**
- Rounding is round half up, away from zero.
- "< LOQ" uses the LOQ as entered. "ND" below the LOD is a per-version option.

**Specifications**
- One per analyte: minimum, maximum and/or text, a unit, and who set it.
- Specifications are locked once the quote is issued, and kept when a quote is re-versioned.
- Changing one on an ordered test needs a reason; quote changes record "Quote edited".
- The lab's suggested limit on each analyte is offered (a button), never applied by itself.

**Demo content**
- Incubation times and temperatures follow the USP chapters as commonly applied. Each lab confirms them against its SOPs; the USP <60> times are the least certain.
- The combined USP <61>/<62> test reports S. aureus, P. aeruginosa and C. albicans once, as their <61> recovery. An analyte appears once per test, which is a reason to design packages.
- USP <51> results are per timepoint log reductions. How each timepoint's result is reported is left for reports.

**Open for later slices**
- Who may do a step is checked at execution (WD-2) through department groups. Analyst Qualification (training) is not modelled yet.
- Acceptance and decision rules beyond the Batching criteria and split-off findings are WD-2 and WD-3.

**Changed in WD-1.2 (migration 014)**
- QC criteria are set per analyte in a full table: see [[Decision - QC Criteria Are Set Per Analyte]]. The one-default-plus-exceptions layout above remains only in versions approved before it.
