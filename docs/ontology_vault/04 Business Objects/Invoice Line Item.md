---
type: Business Object
domain: Commercial
capability: Billing
object_classification: Execution Object
status: Reviewed
---

# Invoice Line Item

## Definition
Individual billed service.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Billing]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values (built in I-1, migration 036)
- The requested test it bills (sample, client sample ID, test), the date reported, the due date and days late
- List price, price ordered (from the quote), price billed and why it differs
- Rush ordered and its fee, rush billed (a tier met, or standard) and why
- Retest of (test and OOS investigation), a printed note (retest, not charged, result from a retest, stability pull)
- Amount (price billed + rush fee billed; negative on a credit note)
- A credit line names the line it credits, and whether the work is invoiced again

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
- **belongs to** [[Invoice]]
- **references** [[Requested Test]]
- **references** [[Quote Line Item]]
- **references** [[Quoted Test Configuration]] (replaces retired [[Quote Line Item]])
- **may bill** [[Stability Pull]] (stability is billed per pull)

## Governing Rules
- Governed by [[Ontology Principles]]
- [[Invoice Readiness Rule]], [[Late Rush Billing Rule]], [[Issued Invoice Immutability Rule]], [[Retest Billing Rule]], [[Rush Fee Calculation Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Invoice Line Item?
- What is blocking or affecting this Invoice Line Item?
- Which related records explain this Invoice Line Item?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
