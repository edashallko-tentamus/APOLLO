---
type: Business Object
domain: Inventory and Laboratory Resources
capability: In-House Material Preparation
object_classification: Execution Object
status: Reviewed
---

# Preparation Record

## Definition
Actual documented preparation using source inventory lots and quantities.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[In-House Material Preparation]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- To be refined

## Derived Values
- To be refined

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **uses** [[Preparation Formula]]
- **consumes** [[Inventory Lot]]
- **creates** [[Inventory Lot]] (Chemical Type: In-house mixture)
- **may be** [[Worklist Task]]
- **recorded in** [[Electronic Logbook]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: component lots and quantities.

## AI Questions
- What is the current status of this Preparation Record?
- What is blocking or affecting this Preparation Record?
- Which related records explain this Preparation Record?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[In-House Material Preparation Workflow]]
