---
type: Proposal
status: Proposed (for Alex and Jake Teller); added to the next slice (0.37.0) on Alex's request, 2026-10-28; not built
raised: 2026-10-28
---

# Proposal - Lab-Added Verification Requirements

Relates to [[Decision - Workflow Verification]]. Source: Alex's chat "APOLLO due date document" (2026-10-28) and the project doc `Notes - TAT Due Dates and Verification Requirements (2026-10-28)`.

**Context.** Alex asked whether workflow verification is an AI module, and whether someone can edit the verification document to add URS/FRS sections that the system then adds to its checks. The answer is no on both counts:
- The protocol is written by ordinary server code (`server/verification.js`) from the test version's design. The expected results come from a second, independent calculation. The same design always gives the same protocol.
- The Word document is generated on request, is not stored and is never read back. Editing it changes nothing in the system.
- **Confirmed in the code (2026-10-28):** requirements and checks are written only inside `create_verification()` (migration 024), from the list the server builds from the design. The trigger `verification_tables_rules()` refuses any other write ("Workflow verifications change only through their protocol, run and report"). No route or screen lets a person add a requirement. QA can only justify a requirement that was Not tested when signing the report.

## Recommendation

Add a **Lab-added requirements** grid to the protocol page. Do **not** read edits back from the Word file: those would have no signature, no reason for change and no audit entry, so a Part 11 auditor would see two versions of the protocol.

1. **When.** Rows can be added, changed or withdrawn only while the protocol is a Draft (status `Protocol draft`), before QA approves it. QA's existing protocol approval then covers them with the same signature.
2. **What a row holds.** URS or FRS; the requirement text; for an FRS, the URS it serves; the check: what to do, the expected result, and the evidence expected. Every change needs a reason (canned Methods reasons). The author and the time are recorded, and the audit trail keeps every change.
3. **Manual checks only, for now.** A requirement typed in free text cannot be turned safely into automated steps. Anything the run should do automatically belongs in the design (a new Draft version, which already forces a new verification through the design fingerprint). A lab-added check is done by a person after the automated run. They record the actual result and Pass or Fail, attach the evidence (screenshot, PDF or file), and sign "Performed by". It is recorded once and never changed, like the automated checks.
4. **Outcome.** A lab-added check counts like any other check. Not recorded means Not tested, so the report needs QA's justification for it and the outcome is "Pass with exceptions". A Fail fails its requirement and the verification.
5. **Independence.** The person who records a manual check cannot be the QA signer of the report, as for the executor today.
6. **A new protocol for the same Draft** (written after a design change) copies the lab-added rows across, marked "carried over", so the lab does not retype them. QA approves them again with the new protocol.
7. **On the document and the page.** The rows print in the URS and FRS sections and the checks table, marked "Lab-added", with the author and the evidence link. They appear in the traceability table like the others.
8. **Permissions.** No new permission: adding and changing rows and recording manual checks need `methods.design`, and QA approves with `methods.verify`, as today.

## Build outline (when Alex says go)

- **Migration:**
  - `verification_requirement`: add `origin` ('Design', 'Lab') and `carried_from_id`.
  - `verification_check`: add `method` ('Automated', 'Manual'), `evidence_document_id`, `recorded_by`, `recorded_at` and `record_signature_id`.
  - New functions `add_lab_requirement`, `change_lab_requirement`, `withdraw_lab_requirement` (Draft only, reason required) and `record_manual_check` (signed, once, after the run).
  - `finish_verification_run` leaves manual checks open; replace `sign_verification_report` so manual checks are recorded or justified.
  - `create_verification` carries the lab rows over.
- **Server:** routes on `routes_verification.js`; `verification_report.js` prints the marks.
- **Screen:** the grid on the protocol page, and a "Record result…" button on each manual check after the run.
- **Tests:** a rule test file and a browser suite.

## Questions for Alex and Jake Teller

1. Manual checks only for now (recommended), or do you want a small list of automated check types the lab can pick from?
2. Who may record a manual check: anyone with `methods.design`, or only someone who did not write the row?
3. Should carried-over rows need a fresh reason, or only QA's new approval (recommended)?
