---
type: Business Object
domain: Commercial
capability: Service and Test Catalog
object_classification: Definition Object
status: Reviewed
---

# Test Catalog Entry

## Definition
The commercial definition of a [[Test]]: pricing, turnaround and rush terms. Entered in step 1 of the Test Workflow Designer wizard but stored outside the validated [[Test Version]], so a price change never creates a new test version or triggers requalification. List Price = Base Price (if set) + Preparation Fee (if set) + the sum of selected analyte prices (analyte-priced tests only).

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Service and Test Catalog]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Display Name
- Description
- Pricing Mode: Base Price Only, Base + Preparation Fee, Analyte Selection
- Base Price
- Preparation Fee
- Standard TAT (number; the maximum days)
- TAT Unit: Business Days, Calendar Days
- Cutoff Time (logged after this, Day 0 moves to the next working day)
- Rush Fee Schedule
- Rush tiers requiring intake approval (defaults from the schedule; overridable per test)
- Show in Public Catalogue (Yes/No)
- Matrices
- Sample requirements

## Derived Values
- List Price (full analyte set)
- Rush availability
- Commercial availability

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **references** [[Test]]
- **prices analytes through** [[Test-Analyte Availability]]
- **uses** [[Rush Fee Schedule]]
- **belongs to** [[Test Catalog Category]]
- **listed in** [[Test Catalog]]
- **may belong to** [[Test Package]]
- **used by** [[Quoted Test Configuration]]

## Governing Rules
- [[TAT Clock Start Rule]]
- [[Rush Approval Rule]]
- [[List Price Snapshot Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Test Catalog Entry?
- What is blocking or affecting this Test Catalog Entry?
- Which related records explain this Test Catalog Entry?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
