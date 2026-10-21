---
type: Open Items
status: Pending QA review (Jake Teller)
logged: 2026-10-13
---

# Open Items for QA Review

Decisions built into LIMS3 that QA (Jake Teller) should confirm during his system review. Alex logged them on 2026-10-13. None blocks the build. Each links to the note where it was made.

**Results and specifications** ([[Decision - QC Review Build Choices]])
1. Results are compared with the specification using the reported (rounded) value, not the unrounded one.
2. "< LOQ" and ND count as below any maximum (they conform) and fail any minimum.
3. A text limit (e.g. "Absent in 10 g") fails on a "found" value (D*, D).
4. Re-prep replicates: the reviewer picks one prep with a justification, or reports the average.

**Review and signatures**
5. The reviewer must not have performed or witnessed any step of the batch.
6. A failed QC verdict is accepted with a written justification, not by a separate deviation record.
7. One Part 11 signature approves the batch, with a review mark per step (being added).
8. One approval covers every timepoint of a stability or PET batch.
9. A witness needs bench rights in the lab, not the step's department ([[Decision - Chemistry Execution Scope and Rules]]).
10. Lighter Draft signing for test workflows (sign once at submission) is parked ([[Decision - Test Workflow Changes Are Electronically Signed]]).

**Bench records**
11. New values are attributed but not signed; a correction needs a reason; a step's completion is signed ([[Decision - Chemistry Execution Build Choices]]).
12. A weight outside the target range, or an incubator load outside its window, is flagged and explained, not refused ([[Decision - Micro Bench Build Choices]]).
13. Using a lot at the bench reduces its stock; removing it while the step is open returns the stock.

**Logbooks** ([[Decision - Logbook Values Feed Results Through Scanned Materials]])
14. The 21 CFR basis for the review routes: an entry used once is reviewed in the batch, an entry used many times (e.g. a daily control) in its logbook.

**Earlier slices**
15. Password rule, lockout, idle timeout, signature validity window (slice 3.2, see CLAUDE.md).
16. Whether 21 CFR 111 clients need a stricter OOS category.

**WD-3.1 review screen** ([[Decision - QC Review Approves Each Step]])
17. The review opens on "hits above the LOQ": results below the LOQ are hidden until the reviewer switches to all analytes. Should approval require the full list to have been shown, or is the switch enough?

**WD-5: analytical runs and preliminary results** ([[Decision - Analytical Runs, Preliminary Results and Order Statuses]])
18. A run's analytical QC (ICV, CCV) needs to pass or be accepted only when a reported reading comes from that run. Is that acceptable, or must every run's QC be dispositioned?
19. A preliminary (timepoint) release judges no QC: QC is judged at the final review. Alex agreed for now; Jake to confirm. Should batch QC that is already complete be required to pass before a preliminary release?
20. Once a timepoint is released, the steps that fed it are locked (no reopen, no new run, no batch cancel) until the OOS and retest slice. Confirm this is the wanted control.
21. A matrix spike is judged against the reviewer's chosen result of its sample (Alex, WD-5.1). Confirm with QA.
22. Averaging: the unrounded readings are averaged, then rounded as the test says. Picking one of several readings always needs a written justification; averaging all of them needs none.
23. An incubator load outside its window needs the analyst's note and the reviewer's acceptance (Alex, WD-5.1). Confirm the wording QA wants in the justification.

**WD-6: workflow verification** ([[Decision - Workflow Verification]])
24. The automated accounts sign as "Automated verification run" and the person who executes signs "Executed by". Is that acceptable evidence of execution, or must a person witness the run?
25. "Pass with exceptions" (requirements not tested, each justified by QA) opens the gate. Should some requirements (for example the final result calculation) never be allowed to go untested?
26. QC readings are solved at run time so each QC passes; only the verdicts are recorded. Should the protocol also state expected QC values and include a deliberately failing QC?
27. Does a verification need repeating when a version is copied to another lab, or when equipment or lots change? Today only a change to the version's design voids it.
28. Objective evidence (WD-6.1): one full-page screenshot per page the checks point to, stamped and kept with its SHA-256. Is a screenshot of the finished state enough, or does QA want a screenshot at each action (before and after), or a video of the run?
29. The Word document is generated from the record and not stored or signed itself. Is that acceptable for the validation file, or must the signed report be kept as a fixed PDF?

**R-1: Result Finalization and the COA** ([[Decision - Result Finalization and the Certificate of Analysis]])
30. A replacement COA says only "Version 2, supersedes version 1 issued <date>" (Alex does not want "amended" or "retest" on it). Does that meet ISO 17025 7.8.8 for your assessors?
31. One signing act finalizes a group of COAs and records a separate signature on each (the confirmation lists every COA). Acceptable under 21 CFR Part 11?
32. Who may finalize: Project Managers for non-GMP work, QA for GMP work (a Regulated client or a GMP category); never someone who performed, witnessed or reviewed the work. Confirm the GMP categories (Drug product, cGMP, Medical device, OTC drug).
33. The release check's warnings can be released with a written reason (kept with the COA version). Should any warning (e.g. the history check) need QA instead of the Project Manager?
34. The COA states the decision rule as simple acceptance against the client's specification. Confirm the wording, and which labs need measurement uncertainty.

**R-2: OOS investigations** ([[Decision - OOS Investigation Build Choices]])
35. Checklist wording and target times (Full Phase I 30 days, Check and Acknowledge 10 days, calendar) are placeholders from the vault: replace them with the OOS SOP's.
36. Who signs: analyst section (bench rights), supervisor section (QC Review rights, not the analyst, not anyone who did bench work in the batch), QA conclusion (independent of both sections). Check and Acknowledge: one reviewer (QC Review rights or QA), independent of the bench work. Confirm, and whether 21 CFR 111 dietary supplement work needs Full Phase I.
37. An open OOS does not stop QC Review approving the batch (only the release of that result is held). Acceptable, or should approval wait for the investigation?
38. "Assignable cause found" invalidates all of that test's results when the lab investigation retest is ordered (kept as Superseded, linked to the investigation). Confirm, and confirm the retest replaces them on the next COA version with no "retest" wording.
39. Hypothesis testing (re-analysis of the same preparation) is not a separate step yet: before approval it is an analytical run in QC Review. Does the SOP need it recorded on the investigation?
40. The client retest's billing follows QA's determination after the retest is approved (Confirmed OOS or Inconclusive: billable; Lab error: not billable, rush included). Confirm, and who may record it (QA only today).
41. Stability pull window: 7 days early and late by default (Alex, 2026-10-14), kept as a lab setting and changeable per timepoint. Confirm the default, whether it should differ for long intervals (for example ± 14 days from 12 months), and whether a pull outside its window needs more than a note (a deviation). See [[Decision - Stability Studies S-1]].

**L-1 / L-2: electronic logbooks** ([[Decision - Electronic Logbooks L-1 and L-2]])
42. QA approves logbook entries daily or weekly, per logbook (Alex). Confirm which logbooks need daily approval, and whether a late approval should block anything (today it is only shown as overdue).
43. A failing equipment check flags every batch step that used the equipment from the last passing check until the next one; the QC reviewer accepts each flag with a justification. Confirm the window, and whether QA (not the QC reviewer) must accept flags on GMP work.
44. A failing check does not tag the equipment out. Should a failure of certain checks (a balance outside its limit) tag it out automatically, as an expired calibration does?
45. Demo limits are placeholders: balance checks 0.05 % (analytical) and 0.1 % (top-loading); pipette accuracy and CV per ISO 8655 by size; USP <51> inoculum 1 x 10^7 to 1 x 10^9 CFU/mL; USP <61>/<62> challenge not more than 100 CFU; culture passage at most 5. Replace them with the SOPs' values.
46. Sample weights are reviewed inside the batch that uses them, by a reviewer who did not weigh them (21 CFR 211.194(a) second-person review; already raised with [[Decision - Logbook Values Feed Results Through Scanned Materials]]). Confirm.
47. A correction to a logbook entry after a result used it flags the result for a reviewer who did not make the correction; the result is not changed and its release waits. Confirm who should resolve it for GMP work (reviewer or QA).
48. Logbook design changes on a Draft take a reason, not a signature; QA's approval of the design is signed. Acceptable under Part 11, or must every design change be signed (as test workflows are)?
49. Stability chamber excursions are listed on the study but not assessed in the system. Is a recorded impact assessment per study needed before S-2? (Answered by Alex and built in S-2, 0.23.0: QA assesses each excursion per study, signed.)
50. QA testing of inventory before use ([[Decision - QA Testing of Inventory Before Use]]): which item types each lab tests before use, and the QA test for each (identity, assay, growth promotion, sterility).
51. A lot that fails QA testing is rejected for every use until a retest passes, even uses another QA test of the same lot released. Confirm, or block only the failed use.
52. QA can waive QA testing for one lot (signed, with a reason; e.g. after reviewing the supplier COA). Is a COA review an acceptable substitute, and for which item types?

**S-2: stability amendments, cancellation, excursions, issued reports** ([[Decision - Stability Studies S-2]])
53. Who may cancel a stability study (built: Lab Supervisor and General Manager, signed with a reason; the material's fate recorded per condition).
54. An excursion assessed "Client to decide": does the client's answer need its own record in the system (today the justification holds it)?
55. Excursion assessments on GMP studies: QA only? (Built: stability.assess, standard group QA.) And the pulls concerned: material pulled after the last passing reading before the excursion, plus those still to come. Confirm.
56. The issued stability report follows the COA's independence rule (not someone who performed, witnessed, reviewed or approved the work it includes) and GMP rule (reports.finalize_gmp for Regulated clients). Confirm for 21 CFR 211.166 study reports.

**T-1: trending and control charts** ([[Decision - Trending and Control Charts T-1]])
57. Signal rules: Western Electric R1 to R5 plus "outside the limits" by default on every chart, or fewer rules for some charts (fewer false alarms)?
58. Is a monthly PDF of every watched chart, with each signal's review, acceptable evidence of trend review (ISO/IEC 17025 7.7.1, 21 CFR 211.180(e))? Should reviewing a signal be signed?
59. Frozen control limits (from a baseline period): who may freeze them (built: Lab Supervisor, QA), and does a frozen baseline need a second person's approval?
60. USP <51> controls counted 0 are now judged on their count when the log is undefined (Alex, 2026-10-15; built 0.24.0). Confirm for the method's records.

**T-1.1: QA approval of trend charts and limits for tests** ([[Decision - Trend Chart QA Approval and Limits for Tests]])
61. Is ± 3 sigma from a frozen baseline an acceptable basis for a test's QC acceptance limits, with the test version's signed approval as the review?
62. Minimum baseline before limits may be carried into a test (built: 20 points for an individuals chart).

**Sensor feed (0.25.0)** ([[Proposal - iMonnit Sensor Feed for Logbooks and Workflows]])
63. Is an hourly summary (lowest, highest, average) plus every spell outside the limits enough as the logbook record, with each raw reading kept in the LIMS's reading table and in iMonnit?
64. The silence that must be explained (built: 30 minutes by default, per sensor), and whether a sensor's own calibration status should stop its readings counting.
65. May QA let a new sensor link fill in up to 7 days of earlier readings?
66. iMonnit as a supplier system: its audit trail, access control and Part 11 claims (supplier assessment before production).

**V-1: vendor approvals, local and corporate (0.28.0)** ([[Decision - Vendor Approvals, Local and Corporate V-1]])
67. Who sits in Corporate QA, and is one corporate signature enough to approve a vendor for every lab (built: one signature, never the proposer)?
68. Are the supply scopes the right list for supplier qualification under ISO 17025 (6.6) and 21 CFR 211.84 / 111, and should a suspension be per scope?
69. The approvals made for all labs before 050 became corporate approvals for every scope: confirm, or have Corporate QA re-approve them with scopes.
70. What evidence a proposal needs (built: at least one document) and whether a certificate's expiry should stop purchasing by itself (built: shown and filtered, not enforced).

**Chain of custody, receipt photos and photo reports (0.29.0)** ([[Decision - Chain of Custody, Receipt Photos and Photo Reports]])
71. Is the lab's electronic receipt (signed with user ID and password, the handwritten signature image placed on the form) acceptable alongside the client's wet signature on paper, and must the scan of the paper copy always be attached?
72. Should every lab require signed receipts (built: a lab setting, off until switched on)?
73. Photos on a report: how they are taken and kept (built: cropped to 4:3, never changed, retired with a reason), and whether a photo report needs QA review of the photo itself.

**W-1: waste classifications (0.30.0)** ([[Decision - Waste Classifications W-1]])
74. The starter list and its codes (US RCRA) for the lab's EHS contact to confirm, and who keeps the list (built: inventory.lists).
75. Should an item with "classify from the SDS" be blocked from use until classified (built: listed, not blocked)?

**C-1: training and competency (0.31.0)** ([[Decision - Training and Competency C-1]])
76. The default rules: department trained after 4 tests; continuing competency every 12 months; Due soon 30 days before; no minimum of runs.
77. Legacy qualifications for whoever signed a bench step in the last 12 months: enough as the starting record, or should each be reviewed?
78. The gate at signing a bench step: should witnesses and data entry be checked too?
79. Training samples' acceptance (built: the known value ± a percentage per analyte) and the number of samples (built: the trainer chooses, 1 to 10).
80. Who may evaluate (built: training.record, or department trained where the rule lets them train) and QA's approval of every competency.


**SEC-1: security hardening (0.33.0)** ([[Decision - Security Hardening SEC-1]])
81. The account lock: 5 wrong passwords lock an account until an administrator unlocks it. Someone who knows user IDs can lock people out on purpose. Keep it, or unlock by itself after a set time (the per-computer pause already slows guessing)? Single sign-on would replace both.
82. The per-computer limits (20 wrong passwords in 15 minutes; 120 requests a minute to the client pages): suitable, and should a pause be written to the sign-in history?
83. Two database accounts for GxP data (an owner that applies the updates, an app account that cannot delete or change tables, triggers, functions or the audit trail): who holds the owner password (IT), and is it part of the IQ?
84. The internal switches the app uses for its own steps can be set by whoever holds the app account's password. Acceptable with that password held by IT only, or must they be closed (a larger change)?
85. The audit trail pages show a lab's people their own lab's entries and shared records (clients, the catalogue); all-labs groups see every lab. Is that the right reach, and should the central Audit trail page also need audit.view?
86. Uploaded files are stored as uploaded and judged by their content when shown (only real PDFs and pictures open in the browser; everything else downloads). Acceptable, or should uploads of other types be refused?
