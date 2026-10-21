---
type: Business Object
domain: Commercial
capability: Billing
object_classification: Execution Object
status: Reviewed
---

# Invoice

## Definition
Billing record for laboratory services.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Billing]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values (built in I-1, migration 036)
- Lab order (one invoice belongs to one lab order; an order may have several partial invoices), client, lab
- Kind: Invoice or Credit note (a credit note names the invoice it credits and why)
- Status: Draft (held by the person checking it), Issued, Discarded (a released draft, kept)
- Number (INV-<lab>-000001 / CN-<lab>-000001, given at issue), draft code (DR-000001)
- Invoice date (today in the lab; a catch-up invoice: the Friday of the week its work was reported), due date (payment terms), PO number, note printed, internal note
- Bill-to name and address (the client's legal name and billing address at issue)
- Catch-up flag, the PDF (SHA-256), signature ("Invoiced by" / "Credited by"), sent to the client, queued for accounting

## Derived Values
- List value, discounts, rush fees, invoice total
- Credited (by credit notes)
- Balance due (QuickBooks keeps payments; not in the LIMS yet)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **issued to** [[Client]]
- **contains** [[Invoice Line Item]]
- **references** [[Project]]
- **references** [[Purchase Order]]

## Governing Rules
- Governed by [[Ontology Principles]]
- [[Invoice Readiness Rule]], [[Invoice Claim Rule]], [[Late Rush Billing Rule]], [[Issued Invoice Immutability Rule]], [[Retest Billing Rule]]
- [[Decision - Invoicing I-1]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Invoice?
- What is blocking or affecting this Invoice?
- Which related records explain this Invoice?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
