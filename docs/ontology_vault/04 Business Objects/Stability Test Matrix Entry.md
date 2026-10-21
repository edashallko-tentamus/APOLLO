---
type: Business Object
domain: Sample Management
capability: Stability Studies
object_classification: Definition Object
status: Reviewed
---

# Stability Test Matrix Entry

## Definition
One cell of the study matrix: the tests (and quantity of material) for one condition at one timepoint, each priced as a [[Quoted Test Configuration]]. Tests often differ by timepoint.

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Stability Studies]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Condition
- Timepoint
- Tests
- Units of material required

## Derived Values
- Cell price

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[Stability Study Version]]
- **references** [[Stability Condition]]
- **references** [[Stability Timepoint]]
- **priced by** [[Quoted Test Configuration]]

## Governing Rules
- [[Stability Material Sufficiency Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Stability Test Matrix Entry?
- What is blocking or affecting this Stability Test Matrix Entry?
- Which related records explain this Stability Test Matrix Entry?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
