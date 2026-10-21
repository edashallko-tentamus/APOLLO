---
type: Business Object
domain: Master Data and Configuration
capability: Scientific Reference Data
object_classification: Definition Object
status: Reviewed
---

# Unit of Measure

## Definition
Controlled measurement unit.

## Ownership
- **Core domain:** [[Master Data and Configuration]]
- **Capability:** [[Scientific Reference Data]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Unit Name
- Unit Symbol
- Convertible To (other Unit of Measure records this unit can mathematically convert to — admin-controlled equivalency table, used to constrain the Unit field on In-house mixture Inventory Lots to mathematically valid selections)

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
- **used by** [[Test-Analyte Configuration]]
- **used by** [[Analyte Result]]
- **used by** [[Inventory Lot]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: unit equivalency table.

## AI Questions
- What is the current status of this Unit of Measure?
- What is blocking or affecting this Unit of Measure?
- Which related records explain this Unit of Measure?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
