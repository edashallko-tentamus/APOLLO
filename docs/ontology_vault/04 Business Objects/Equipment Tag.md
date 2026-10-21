---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Governance Object
status: Reviewed
---

# Equipment Tag

## Definition
Controlled tag-in/tag-out record governing equipment availability.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
- **Object classification:** [[Governance Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Reason (Maintenance, Repair, Calibration, Qualification)
- Tagged Out By (link to [[User]])
- Tag-Out Signature (link to [[Electronic Signature]] — required to create this record)
- Tag-Out Date/Time
- Tagged In By (link to [[User]])
- Tag-In Signature (link to [[Electronic Signature]] — required to close this record)
- Tag-In Date/Time

## Derived Values
- Is Active (true when Tag-In Signature is not yet recorded — equipment remains unavailable while true)
- Duration (Tag-In Date/Time minus Tag-Out Date/Time, once closed)

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
- **may be created by** [[Maintenance Schedule]] (scheduled tag-out)
- **may be created by** [[Threshold Rule]] (automatic tag-out when Calibration expires — see [[Decision - Calibration Expiration Auto-Tags Equipment]])
- **may be initiated from** [[Maintenance Logbook]] (manual tag-out)
- **documented by** [[Maintenance Event]] (free-form summary and any attached [[Equipment Document]] — attachment is optional, never required to complete Tag-In)
- **may require** [[Release Approval]] before Tag-In, required for Reason: Repair, Calibration, or Qualification — performed by a User holding Role: QA. Not required for Reason: Maintenance. See [[Decision - Return-to-Service Requirements Vary by Reason]].
- **blocks** [[Workflow Step Instance]] while active

## Governing Rules
- Governed by [[Ontology Principles]]
- Not governed by the generic [[GMP Record Change Control Rule]] directly — its own Tag-Out/Tag-In [[Electronic Signature]] fields and [[Equipment Return-to-Service Rule]] are a stricter equivalent

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Equipment Tag?
- What is blocking or affecting this Equipment Tag?
- Which related records explain this Equipment Tag?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Equipment Tag-Out Maintenance and TAT Workflow]]
- Governed or affected by [[Equipment Automatic Tag-Out Rule]]
- Governed or affected by [[Equipment Return-to-Service Rule]]
- Governed or affected by [[Delayed TAT Rule]]
