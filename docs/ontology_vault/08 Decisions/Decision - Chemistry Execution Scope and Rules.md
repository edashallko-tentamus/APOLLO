---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - Chemistry Execution Scope and Rules

Alex Kiddle, 2026-10-13, approving the scope of WD-2 (the second Workflow Designer slice). Built in migration 016.

**Scope**
- The backlog (pool) per department. Re-preps come first, then rush, then by due date.
- Autobatch fills a batch up to the test's maximum and adds its QC. The analyst can also batch only selected backlog rows.
- Each analyst has a worklist.
- The bench screens are Weighing, Preparation, Dilution, Data Entry, Calculation and Hold Point. Equipment and materials are gated: they must be usable.
- Results are calculated live. QC is judged per analyte.
- A finished batch waits for QC Review (WD-3). Micro steps come in WD-4.

**Re-analysis and re-prep (Alex's answer 1)**
- Each is asked for as single, duplicate or triplicate. The question appears when the Re-analysis or Re-prep button is pressed.
- Re-analysis reads the same preparation again. Every reading is kept and the reviewer chooses what is reported.
- Re-prep sends the sample back to the top of the backlog. Its entry in the old batch is superseded but keeps its data.
- Both are signed and need a reason.

**Signatures and witnesses (Alex's answer 2)**
- A step is completed with one signature for the whole batch ("Performed by").
- Each step has a witness setting in the designer: None, Optional or Required.
- At the bench, a "Witnessed" checkbox opens one dialog. The account owner and a witness each sign there, with their own user ID and password. The witness is a user in the system.

**Permissions (Alex's answer 3)**
- testing.perform goes to Analyst and Lab Supervisor. It also needs membership of the step's department group.
- testing.assign goes to Lab Supervisor.
- Whoever builds a batch is assigned to it.

**Spikes (Alex's answer 4)**
- A spike is recorded as an inventory lot plus the volume added.
- The amount spiked is calculated from the lot's analyte concentrations.

**Instrument data (Alex's answer 5)**
- Instrument exports are attached to the step as raw data. They are not parsed.
- Readings can be pasted from the instrument's Excel export.

**WD-2.1 (Alex, 2026-10-13, built in migration 017)**
- A witness needs bench rights (testing.perform) in the lab but does not have to be in the step's department.
- Using a lot at the bench reduces its quantity on hand.
- How it was built (Claude's choices, to confirm): every material recorded at a step is a Usage movement on the lot, naming the batch and entry. The amount used is required for every material, per selected row, in a unit that converts to the lot's unit. Removing a material while its step is open puts the stock back (a linked correcting movement); once the step is completed, the usage stands.

See [[Decision - Chemistry Execution Build Choices]], [[Decision - Workflow Designer Slice Scope and Rules]], [[Decision - QC Criteria Are Set Per Analyte]], [[Test Batch]], [[Workflow Step Instance]].
