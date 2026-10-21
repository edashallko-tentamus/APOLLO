---
type: Business Object
domain: Commercial
capability: Quoting
object_classification: Definition Object
status: Reviewed
---

# Quoted Test Configuration

## Definition
One priced test line on a [[Project Version]] or [[Stability Study Version]]. It starts at the test's current list price (snapshot), carries the quoted quantity and a manually entered final price per sample, and shows the discount in dollars and percent in real time. For analyte-priced tests, analytes can be removed ([[Quoted Analyte Selection]]); the list price recalculates and the negotiated discount percent is kept. Replaces the retired [[Quote Line Item]].

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Quoting]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Test (via [[Test Catalog Entry]])
- Quantity (samples quoted)
- Final Price per sample (manual)
- Selected analytes (analyte-priced tests)
- Rush discount override by tier (optional)
- Special instructions
- Status: Active, Removed

## Derived Values
- List Price (snapshot at quoting)
- Discount Amount ($)
- Discount %
- Line Total
- Standard TAT and Rush Schedule (shown on the line)
- Pricing Review flag: missing final price, above list, discount of 50% or more, zero price

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
- **based on** [[Test Catalog Entry]]
- **selects** [[Quoted Analyte Selection]]
- **creates** [[Requested Test]]
- **billed as** [[Invoice Line Item]]

## Governing Rules
- [[List Price Snapshot Rule]]
- [[Analyte Removal Pricing Rule]]
- [[Quoted-Only Ordering Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Quoted Test Configuration?
- What is blocking or affecting this Quoted Test Configuration?
- Which related records explain this Quoted Test Configuration?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
