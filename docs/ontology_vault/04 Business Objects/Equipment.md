---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Definition Object
status: Reviewed
---

# Equipment

## Definition
Laboratory instrument or equipment resource used by workflows, analyses, and logbooks.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Internal Name
- Serial Number
- Manufacturer
- Department (from the lab's [[Department]] list; required, see [[Decision - Equipment Belongs to a Department and Analysts Edit It]])

## Derived Values
- LIMS Equipment ID (system-generated on creation, not user-entered)
- Current Calibration Date (from the most recent [[Calibration]] record — not a directly editable field, see [[Decision - Calibration History Preserved as Events]])
- Current Calibration Expiration Date (from the most recent [[Calibration]] record)
- Calibration Status (Conforms, Alert, Deficient — see [[Threshold Rule]] instance for calibration expiration)
- Availability (derived from whether an active [[Equipment Tag]] exists — Equipment Status is not independently settable, see [[Decision - Equipment Status Is Derived]])

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **has** [[Equipment Type]]
- **has status** [[Equipment Status]] (derived, see Derived Values)
- **has** [[Equipment Tag]]
- **has** [[Calibration]] (multiple — one record per calibration event, history preserved)
- **has** [[Qualification]]
- **belongs to** [[Department]]
- **owned by** [[Team]] (multiple — e.g. "HPLC Team," or a permission-only group like "Lab Supervisor")
- **owned by** [[User]] (multiple — e.g. a named individual like a General Manager)
- **required to have at least one** owner across Team or User — enforced by [[Equipment Responsible Party Required Rule]]
- **has** [[Maintenance Schedule]]
- **has** [[Maintenance Logbook]]
- **used by** [[Workflow Step Instance]] (the Workflow Designer names a main instrument and possibly several; owners and department suggest alternative routes, later other labs: [[Decision - Equipment Slice Scope and Rules]])
- **used by** [[Analytical Run]]
- **may trigger** [[Equipment Impact Assessment]]
- **may be covered by** [[Electronic Logbook]] (checks and readings; a failing entry flags the batch steps that used it)
- **may be a stability chamber holding** [[Stability Condition]] (an excursion lists every affected study and stored sample)

## As built (0.18.0, logbooks, migrations 034 and 035)
- An equipment logbook (balance check, pipette check, temperature log) lists the units it covers, with limits per unit. A stability chamber's limits come from its condition and tolerance.
- **A failing check flags, it does not tag out.** Every batch step that recorded the equipment, or held an incubator load in it, from the last passing check before the failure to the next passing one, is flagged in QC Review; the reviewer accepts each flag with a justification before approving. See [[Logbook Failure Flag Rule]].
- The equipment page shows its logbooks, what is due, its recent entries and any failure still open.
- A sample weight aliquot records the balance it was weighed on, with the balance's calibration at the time (shown in QC Review).
- See [[Decision - Electronic Logbooks L-1 and L-2]].

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]] — covers the base Equipment record (Serial Number, Manufacturer, Department, responsible parties); the Tag-Out/Tag-In workflow has its own separate signature and QA-approval requirements, unchanged by this

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Equipment?
- What is blocking or affecting this Equipment?
- Which related records explain this Equipment?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Equipment Tag-Out Maintenance and TAT Workflow]]
- Governed or affected by [[Auto-Batching Rule]]
