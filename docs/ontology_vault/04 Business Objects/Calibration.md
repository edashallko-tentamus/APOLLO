---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Execution Object
status: Reviewed
---

# Calibration

## Definition
Calibration activity and status for equipment.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Performed Date
- Expiration Date (lab-configurable at entry; once Submission Status is Submitted, changing this value requires QA approval from a different individual than whoever performed the calibration — see [[Decision - Calibration Expiration Requires QA Approval to Change]])
- Submission Status (Draft, Submitted)
- Performed By (link to [[User]] or Service Event provider)
- Result (Pass, Fail)
- Certificate (link to [[Equipment Document]])

## Derived Values
- Is Current (true when this is the most recent Calibration record for its Equipment — Equipment's Current Calibration Date and Current Calibration Expiration Date are derived from whichever record has Is Current = true)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **applies to** [[Equipment]]
- **expiration evaluated by** [[Threshold Rule]] (Days Until/Since — Alert before expiration, Deficient once expired; this threshold value itself is not change-controlled, only Calibration's own Expiration Date is)
- **triggers** [[Equipment Tag]] (Reason: Calibration) automatically once Deficient — not an independent block on Workflow Step Instance; the Tag is the single blocking mechanism, consistent with how Maintenance Schedule triggers a Tag rather than blocking directly
- **documented in** [[Electronic Logbook]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Not governed by the generic [[GMP Record Change Control Rule]] directly — [[Decision - Calibration Expiration Requires QA Approval to Change]] is its own equivalent (and stricter) rule specifically for Expiration Date; other fields fall back to the generic rule

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Calibration?
- What is blocking or affecting this Calibration?
- Which related records explain this Calibration?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
- Governed or affected by [[Equipment Return-to-Service Rule]]
