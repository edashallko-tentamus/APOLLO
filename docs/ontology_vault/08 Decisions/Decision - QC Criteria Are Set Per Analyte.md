---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - QC Criteria Are Set Per Analyte

Alex Kiddle, 2026-10-13, after clicking through WD-1 and comparing it with his deck "Testing, Batching & Workflow" (Testing_Workflow_Build_Out.pptx, slides 6, 15 and 17). Built by Claude Code as WD-1.2 in migration 014. Supersedes the "exceptions-only storage" of the deck's QC criteria model, and brings in the "show-all-analytes editing view" the deck had deferred.

**What Alex asked for**
- The Batching settings for QC need a QC-specific criterion for each analyte, not one criterion for all of them.

**Alex's answers**
- **Full table, prefilled.** Each QC type shows every analyte of the test in its own row under each of its criteria. The default is set once and fills every row; any row can be changed (e.g. mercury 70 to 130 % while the panel holds 75 to 125 %). Fill down and paste from Excel work in each table.
- **A QC can leave analytes out.** An "Applies" tick per analyte per criterion; an unticked analyte is not judged by that QC and the bench will not ask for its value (e.g. a spike that only carries some analytes).
- **At execution there is a verdict per analyte** against its own limit (deck slide 15: "CCV-2 Lead 87 % flagged · Cd, As pass").

**Revised on screen (Alex, same day, after seeing it)**
- The full tables made the Batching step too long. Each criterion is now one line: the criterion and its default.
- Its exceptions are listed under it, for example "Mercury: 70 to 130" or "Mercury: not judged".
- The per-analyte table is folded away by default and opens with "Show all analytes" to change any analyte.
- Storage and rules are unchanged: every analyte still has its own row.

**Also brought in line with the deck (Alex chose all three)**
- Hide LOQ and Hide LOD per analyte, besides Hide analyte (slide 4). Hiding the analyte makes its own limit boxes not apply.
- A Weighing target's tolerance in % or in the weighing unit (slide 7).
- Calculation values are picked by name ("Sample weight · Weigh"), with operator, function and constant buttons (slide 14). Typing the formula is still possible, and the database still checks it.

**Build choices (Claude, not yet confirmed by Alex)**
- Each criterion keeps a default. It prefills the table, and an analyte added to the test later uses it until it is set. Changing the default moves every analyte still on the old default.
- Versions approved before this change keep "default plus exceptions" and are not rewritten. One database function, qc_criteria, reads both layouts and gives the limit for every QC, criterion and analyte. It is what the bench (WD-2) will judge against, and the Review tab shows it as "QC acceptance per analyte".
- What stops approval:
  - an analyte that applies without its limit
  - a minimum above the maximum
  - a criterion that applies to no analyte.
- A limit for an analyte no longer on the test is only a warning, and it is ignored.
- Hide LOQ and Hide LOD are stored; reports (not built yet) will use them.

**Demo**
- Heavy Metals by ICP-MS version 2 is left as a Draft for review and approval. Mercury has its own limits, the matrix spike duplicate does not judge mercury, the weighing tolerance is 0.5 g ± 10 %, and the LOD is hidden on the report.

See [[Decision - Workflow Designer Slice Scope and Rules]], [[Decision - Workflow Designer Build Choices]], [[Decision - Workflow Designer Micro Definitions]].
