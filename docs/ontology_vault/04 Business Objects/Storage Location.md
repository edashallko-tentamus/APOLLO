---
type: Business Object
domain: Sample Management
capability: Sample Storage
object_classification: Definition Object
status: Reviewed
---

# Storage Location

## Definition
Hierarchical location used to store Samples, Aliquots, Inventory Lots, or prepared materials.

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Sample Storage]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Location Name
- Location Type (e.g. Room, Freezer, Fridge, Cabinet, Shelf, Bin)
- Parent Location (self-referential — builds the hierarchy, e.g. Room 4 > Freezer 2 > Shelf B)
- Supported Condition (the temperature/condition range this location actually provides, e.g. Ambient, Refrigerated 2-8°C, Frozen -20°C, Frozen -80°C)
- Status (Active, Under Maintenance, Retired)

## Derived Values
- Full Path (derived from Parent Location chain, e.g. "Room 4 > Freezer 2 > Shelf B")
- Condition Mismatch Flag (true when an assigned Sample, Aliquot, or Inventory Lot's required storage condition doesn't match this location's Supported Condition)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **stores** [[Sample]]
- **stores** [[Aliquot]]
- **stores** [[Inventory Lot]]
- **belongs to** [[Storage Location]] (Parent Location, self-referential)

## Governing Rules
- Governed by [[Ontology Principles]]
- See [[Decision - Storage Location and Supplier Defined]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: creating many locations at once.

## AI Questions
- What is the current status of this Storage Location?
- What is blocking or affecting this Storage Location?
- Which related records explain this Storage Location?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
