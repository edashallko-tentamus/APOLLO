---
type: Architecture Decision
status: Alex's notes Accepted; Claude's build choices Proposed (to confirm with Alex and Jake Teller, QA)
decided: 2026-10-14
built: 2026-10-14 (migration 028, seed 022, version 0.14.1, Claude Code)
---

# Decision - Report Finalization Follow-up

Alex's notes after clicking through [[Decision - Result Finalization and the Certificate of Analysis]] and [[Decision - OOS Investigation Build Choices]].

**Alex's decisions**
- **Name:** the module is "Report Finalization".
- **Tabs:**
  - "Report Finalization Queue": everything waiting.
  - "Finalization worklist": what a person has claimed. Ownership stops anyone else finalizing it.
  - "Batched Finalization": groups in progress (Alex's answer).
  - Claude added a fourth tab, "Issued COAs": the archive of finalized and sent COAs.
- **COAs are listed on the lab order** as well as on the sample.
- **Queue highlighting:**
  - priority samples with due dates approaching, at the test level;
  - OOS results highlighted, in their own filterable column linking to the investigation.
- **Release check:** the OOS block links to the OOS.
- **Wet signatures:**
  - Each person who signs COAs has a copy of their handwritten signature, uploaded by a lab administrator (Alex's answer).
  - The COA prints the signature with the printed name, the date and the title under the line.
  - An electronic signature without the handwritten copy is not enough.
- **Report ID:** the sample ID followed by R1, R2 … per version, with the version number beside it ("COA-" dropped).
- **Serving size:**
  - on the lab order's samples (the sample submission);
  - a test workflow setting adds results per serving as an extra column (Alex's answer).
- **Uncertainty:**
  - per analyte in the test designer, beside LOQ and LOD;
  - as ± a value in the result's unit, or ± % (Alex's answer);
  - switched on or off for reporting.
- **Notes:** all COA notes go in one Notes section, numbered. A note on an analyte or test gets its number beside that row.
- **PDF viewer:** a bigger COA, smaller side panes, the whole page visible.
- **OOS loop:**
  - The OOS email goes with the COA that releases the confirmed result: on release, not on detection, as decided before.
  - The sample page records the client's Phase II decision, either a retest ordered or no retest. That closes the loop, and then the final COA is sent.

**Build choices (Proposed)**
1. **Claims are not signed:**
   - Claiming or releasing changes no record of the work. Both are audited (who, when) but carry no electronic signature.
   - Finishing every test in a group closes it ("Done").
2. **Taking back someone else's claim:** a lab administrator (admin.users) does it, with a reason. Nobody else can release another person's claim.
3. **Review without claiming:** unclaimed tests can still be reviewed and finalized from the queue. Claiming is how a person reserves work, not a required step.
4. **Signatures:**
   - Recorded by a lab administrator of a lab where the person works (admin.users), or by a system administrator. This includes their own signature, because Alex is the only administrator today.
   - The image is a PNG or JPEG up to 1 MB. The title is required.
   - Recording one is signed "Recorded by".
   - Replacing one needs a reason, and the old image is kept (GxP: never deleted).
   - The automated verification accounts are exempt.
5. **Is the COA final?**
   - A COA is marked final only when every test is finalized **and** no confirmed OOS on the sample is still waiting for the client's Phase II decision.
   - "No retest" makes the queue offer "Final COA due". It issues a new version with the same results, marked final, and a reason is required.
   - A Phase II retest records "Retest ordered" automatically. Its result then makes the next version.
6. **"No retest"** is recorded with a signature ("Recorded by"), saying how the client decided. It also adds a system note to the sample.
7. **Notes:** sample-level notes have a number but no marker. A note on a result marks that row, and a note on a test marks the test's heading.
8. **Uncertainty:**
   - printed as "± x" to the reported result's decimals;
   - "%" is a percentage of the result;
   - an analyte has to have an uncertainty before "Report ±" can be switched on;
   - carried to new versions.
9. **Per serving:**
   - converted with the unit tables: ppm, ppb, %, X/Y units and "per 100 g";
   - 3 significant figures;
   - "<" results stay "<";
   - a test that reports per serving on a sample with no serving size is a release-check Warning, not a Block.
10. **Design fingerprint:** "report per serving", the uncertainties and "Report ±" are not part of a test version's design fingerprint for workflow verification ([[Decision - Workflow Verification]]), because they change reporting, not the workflow. To confirm with QA.
11. **Report ID:** the internal COA code (COA-…) stays in the database and on the public verification page's records. The client sees the report ID.
12. **Demo signatures:** fictional demo signatures for the demo Project Manager, QA Reviewer and Lab Supervisor. Alex's own account has none until an administrator records it (he cannot issue COAs until then).
