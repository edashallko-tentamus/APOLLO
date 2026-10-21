---
type: Business Object
domain: Commercial
capability: Quoting
object_classification: Definition Object
status: Reviewed
---

# Quoted Analyte Selection

## Definition
An analyte included on a [[Quoted Test Configuration]] for an analyte-priced test. Removing an analyte from the quote removes its price from the line's list price. A lab order can remove further analytes but can never add one that is not selected here.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Quoting]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Analyte
- Included (Yes/No)

## Derived Values
- Analyte List Price (from [[Test-Analyte Availability]])

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[Quoted Test Configuration]]
- **references** [[Analyte]]

## Governing Rules
- [[Analyte Removal Pricing Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Quoted Analyte Selection?
- What is blocking or affecting this Quoted Analyte Selection?
- Which related records explain this Quoted Analyte Selection?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
