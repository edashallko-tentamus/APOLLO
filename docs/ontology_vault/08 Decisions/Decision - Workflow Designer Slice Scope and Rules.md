---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - Workflow Designer Slice Scope and Rules

Alex Kiddle, 2026-10-13, designing the Test Workflow Designer with Claude. Built as WD-1 in migration 012.

**Four slices**
- WD-1 Designer: test definitions, versions, analytes, workflow steps, formulas, approval.
- WD-2 Chemistry execution: batches and the bench screens.
- WD-3 QC Review.
- WD-4 Micro steps and links.
- Then reports and the CoA, OOS, and stability. Logbooks follow, built on the same calculation engine (see [[Decision - Logbooks Wait for the Workflow Designer]]).

**A test belongs to a lab**
- The workflow, and so the test, can be copied to another lab. That lab gets its own Draft to approve.
- There is a Duplicate button, so labs can use existing tests as quick templates.
- Tests made before the designer stay shared by all labs.
- A lab's test can only be ordered at that lab.

**Specifications**
- A specification can be set in a project (quote) and on a single ordered test. Limits on the quote carry to every order made from it.
- A test with no specification is unspecified: the client gets the result as it is. Specifications record who set them (Lab, Client or Client portal).
- The client portal will let clients set their own limits, so the lab is absolved of some liability.

**Permissions**
- These are independent permissions configured into groups; the groups define the roles. The approach does not change.
- methods.design: Analyst, Lab Supervisor and QA.
- methods.approve: Lab Supervisor and QA. Nobody approves a version they worked on.

**Departments**
- Who may do a step is department based.
- A group can be marked as one of the lab's departments (Admin > Groups and permissions). Its members are that department's people. This is configurable per lab.
- Each step is done by the test's department unless the step names another.

**Equipment**
- A step names equipment types, not units.
- One type is the main instrument; others are alternatives. Data Entry is the main instrument step.
- The actual unit is chosen at the bench and must be in calibration.

**Rounding**
- Rounding and significant figures are part of step 1 of the wizard.
- The default is 3 significant figures, round half up. Each analyte can override it.

**Demo tests**
- Heavy metals by ICP-MS.
- USP <62> specified microorganisms: Salmonella, E. coli, Pseudomonas aeruginosa, Staphylococcus aureus and Candida albicans.
- USP <60> Burkholderia cepacia complex.
- USP <61> and USP <62> method suitability, as two tests plus one combined. Packages are not designed yet, so the combined test stands in for them.
- USP <51> antimicrobial effectiveness, Category 2, in this slice.

See [[Decision - Workflow Step Types Cascade Under One Definition Object]], [[Decision - Workflow Designer Build Choices]].
