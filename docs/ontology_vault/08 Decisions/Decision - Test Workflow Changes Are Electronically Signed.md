---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - Test Workflow Changes Are Electronically Signed

Alex Kiddle, 2026-10-13: "add sign off to test workflow creation and changes". Built by Claude Code as WD-1.3 in migration 015. It replaces the earlier build choice that Draft edits are unsigned and need no reason ([[Decision - Workflow Designer Build Choices]]). It follows the Inventory pattern ([[Decision - Inventory Changes Are Electronically Signed]]) and the build-out deck's universal change control: every record with user values, formulas included, takes permission, signature and reason to create or edit.

**What is signed**
- **Created by**, with no reason asked:
  - a new test, a new version, a duplicate, or a copy to another lab
  - a new step, analyte or method (SOP).
- **Changed by**, with a Reason for Change:
  - any change to a Draft: the test and reporting settings, analytes, steps, their equipment types and connections, and removing a step
  - changes to the lab's Methods (SOPs) list.
- The Methods canned reasons include "Draft being developed (before approval)", so while a Draft is built the reason is one pick.
- **Approved by**: approval was already signed, by someone who did not work on the version.

**How it is enforced**
- The database refuses an unsigned creation or change of a test version, its analytes, steps, step equipment types and step connections, and of a method (SOP).
- On the shared test record, the same applies when a lab's test is created or its department or lab changes.
- The signature must be the signer's own, made for that save (less than 30 minutes old). It is stored with the meaning, the action and the reason, and every audit trail entry links to it.
- Tests made before the designer (shared by all labs), and renames from the Test catalogue, keep their Reason for Change rule as before.
- Demo data and rule tests sign as a data load script.

**What this means for the analyst building a test**
- Every save in the designer asks for the user ID and password, and changes also ask for a reason. This is deliberate (an affirmative act per change). If it proves too heavy while a Draft is being built, a lighter option is a single signature when the Draft is submitted for approval, with draft saves only attributed. That is a decision for Alex and QA, and has not been built.
- **Alex, 2026-10-13: the lighter option makes more sense, but leave it for now.** To revisit (with QA) when the designer is next changed, or before validation.

See [[Electronic Signature]], [[GMP Record Change Control Rule]], [[Decision - Workflow Designer Slice Scope and Rules]].
