---
type: Business Object
domain: Commercial
capability: Service and Test Catalog
object_classification: Definition Object
status: Reviewed
---

# Test-Analyte Availability

## Definition
Which analytes are commercially selectable on a catalog test, and each analyte's price when the test uses the Analyte Selection pricing mode. Prices are entered as a grid with fill down so a 30-element panel is priced in seconds.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Service and Test Catalog]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Analyte
- Analyte Price
- Selectable (Yes/No)

## Derived Values
- None

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **links** [[Test Catalog Entry]]
- **links** [[Analyte]]
- **selected by** [[Quoted Analyte Selection]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Test-Analyte Availability?
- What is blocking or affecting this Test-Analyte Availability?
- Which related records explain this Test-Analyte Availability?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
