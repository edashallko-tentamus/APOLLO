---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Derived Value
status: Reviewed
---

# Equipment Status

## Definition
Current status such as available, in use, reserved, tagged out, under maintenance, under calibration, awaiting parts, restricted, out of service, or retired.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
- **Object classification:** [[Derived Value]]
- **Value model:** [[Value Ownership]]

## User Values
- (none — this is fully derived, never set directly; see Derived Values)

## Derived Values
- Status value: Tagged Out (when Reason: Maintenance), Under Calibration (when Reason: Calibration), Under Repair (when Reason: Repair) — set by whichever [[Equipment Tag]] is currently active. Available when no active Equipment Tag exists. Retired and Out of Service are set independently by an administrative action, not derived from a Tag.

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
- **controls** [[Availability Status]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Exempt from [[GMP Record Change Control Rule]] — fully derived from the active Equipment Tag, never set directly, nothing user-entered to protect

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Equipment Status?
- What is blocking or affecting this Equipment Status?
- Which related records explain this Equipment Status?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
- Governed or affected by [[Equipment Automatic Tag-Out Rule]]
