---
type: Business Object
domain: Commercial
capability: Quoting
object_classification: Governance Object
status: Reviewed
---

# Quote

## Definition
The commercial negotiation: drafted, sent, accepted or rejected, and possibly expired. A Quote is separate from what it produces. Accepting a routine quote creates or updates a [[Project Version]]; accepting a stability quote ([[Quote Type]] Stability Testing) creates or updates a [[Stability Study Version]]. List prices and rush schedules are copied onto the quote when it is issued so later catalog changes never alter an accepted quote.

## As built (migration 029, 2026-10-14)
- A standalone quote is stored as a [[Project]] of kind "Quote" (codes Q-00001) with its [[Project Version]]s; its accepted version is ordered against directly. Prepared By = `project.owner_id`; Sent To = `project_version.sent_to_contact_id`; the client accepts or declines through a link. See [[Decision - Standalone Quotes]] (build choice 9 explains the difference from this definition).

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Quoting]]
- **Object classification:** [[Governance Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Client
- Quote Type
- Valid Until
- Prepared By
- Sent To (Contact)
- Notes

## Derived Values
- Quote Total
- Discount Total ($ and %)
- Rush Schedules Used (listed once at the bottom of the quote with their tiers and quote discounts)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **requested by** [[Client]]
- **has type** [[Quote Type]]
- **presents** [[Quoted Test Configuration]]
- **presents** [[Quote Rush Term]]
- **creates** [[Project Version]]
- **creates** [[Stability Study Version]]

## Governing Rules
- [[List Price Snapshot Rule]]
- [[Analyte Removal Pricing Rule]]
- [[Rush Fee Calculation Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Quote?
- What is blocking or affecting this Quote?
- Which related records explain this Quote?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
