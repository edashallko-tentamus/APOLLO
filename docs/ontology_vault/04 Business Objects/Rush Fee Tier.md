---
type: Business Object
domain: Commercial
capability: Service and Test Catalog
object_classification: Definition Object
status: Reviewed
---

# Rush Fee Tier

## Definition
One rush option within a [[Rush Fee Schedule]], for example Same Day, Next Day, 48 Hour, 5 Day. A test's standard TAT is the maximum; each tier makes a faster TAT available for a surcharge.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Service and Test Catalog]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Tier Name
- Rush TAT (number)
- TAT Unit: Business Days, Calendar Days
- Surcharge Type: Percent of price, Flat amount
- Surcharge Value
- Requires Intake Approval (default for tests using the schedule)
- Approval Escalation After (hours)

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
- **belongs to** [[Rush Fee Schedule]]
- **selected on** [[Requested Test]]
- **quoted through** [[Quote Rush Term]]

## Governing Rules
- [[Rush Fee Calculation Rule]]
- [[Rush Approval Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Rush Fee Tier?
- What is blocking or affecting this Rush Fee Tier?
- Which related records explain this Rush Fee Tier?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
