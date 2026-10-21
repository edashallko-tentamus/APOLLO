---
type: Business Object
domain: Commercial
capability: Quoting
object_classification: Definition Object
status: Reviewed
---

# Quote Rush Term

## Definition
The rush terms on a quote: one row per tier of each [[Rush Fee Schedule]] used by the quote's tests, each with its own discount percent. A Same Day tier can stay at full price while a 5 Day tier is free (100% discount). A single test line may override a tier's discount.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Quoting]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Rush Fee Schedule
- Rush Fee Tier
- Rush Discount %

## Derived Values
- Surcharge (snapshot from tier)
- Discounted Surcharge shown in dollars per test

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to** [[Project Version]] or [[Stability Study Version]]
- **references** [[Rush Fee Tier]]

## Governing Rules
- [[Rush Fee Calculation Rule]]
- [[List Price Snapshot Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Quote Rush Term?
- What is blocking or affecting this Quote Rush Term?
- Which related records explain this Quote Rush Term?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
