---
type: Architecture Decision
status: Approved (Alex, 2026-10-21); build choices Proposed
decided: 2026-10-21
built: 2026-10-21 (version 0.36.0, migration 058)
---

# Decision - Charges, Service Lines, Ordering at List Price and Invoice Corrections

Relates to [[Decision - Invoicing I-1]], [[Decision - Standalone Quotes]], [[Decision - Test Packages and Dated Price Changes P-1]]. Reverses [[Decision - All Ordering Is Quoted]].

**Context.** Cecilia Colesanti's call with Alex (2026-10-21) asked for: percentage discounts on quotes; the invoice details at the top of the invoice; a paid status; correcting the PO number on an invoice already sent; miscellaneous charges (kits, shipping, report fees); service lines on tests and clients; an easier way to find a test to order; and ordering a test the client was not quoted for. Alex's answers the same afternoon:
- "What if when a test is added the dialogue box brings up a list of service lines and the user clicks through what can be ordered? By breaking it down to the filtered Service Line>Service Line Type>Department>material/matrix."
- "Something not quoted is automatically list price without warning."
- "Ordering: Agreed with all. Unquoted tests: agreed; use the lab established rule for subcontracting right? Not just the 20/30 rule; agreed; agreed. go"

## Decision (Alex)

1. **Discounts as a percentage** on quote lines and packages: typing a % sets the final price; one % can be applied to every line.
2. **Invoice details first** on the invoice page, with a **payment status** (Unpaid, Overdue, Paid, Credited). Payment is recorded by hand until QuickBooks reports it.
3. **The PO number of an issued invoice can be corrected**: signed, with a reason; the client is sent a corrected copy. The amounts still change only through a credit note.
4. **Miscellaneous charges** are their own catalogue (Charge items), not hidden tests: they go on orders, on quotes at a price per client, and on draft invoices; they are billable as soon as they are added and never appear on a COA. A Discount charge is taken off.
5. **Service line > service line type > department** on every test; service lines on the client's profile. The order's test picker drills down through them (the client's quoted tests and service lines first) or searches everything. Material/matrix as a fourth level comes later.
6. **Any test of the lab can be ordered at its list price** without a quote and without a warning. An accepted quote line for that test always wins.
7. Subcontracting follows each lab's own settings (Sites: in-network discount and markup), not a fixed 20/30.

## Build choices (Proposed)

1. **Percent discounts** are rounded to the cent and only change the final price; nothing new is stored.
2. **Paid status**: `paid_on`, a note, who recorded it and when, changed only by `record_invoice_payment` (invoicing.issue, a reason; not in the future, not before the invoice date; clearing allowed). "Credited" when credit notes cover the total; "Overdue" after the due date on the lab's calendar.
3. **PO correction**: `correct_invoice_po` (signed "Corrected by", reason required) changes only the PO on the issued invoice and writes an `invoice_correction` row (old and new PO, reason, signature, the QuickBooks payload to send). The corrected copy is a new PDF with a banner ("CORRECTED COPY: the PO number has changed from X to Y"), attached to the correction and emailed ("Invoice Corrected") to the billing contacts; the original PDF is never replaced. Not offered on catch-up invoices.
4. **Charge items** belong to a lab (catalog.edit) or to every lab (system administrators). Kinds: Kit, Shipping, Report fee, Surcharge, Discount, Other. The price is never negative; a Discount's amount is stored negative on orders and invoices.
5. **Charges on quotes** (`quoted_charge`) lock with the version and are copied to its next version. On an order, a charge takes the client's price from their most recently accepted, unexpired quote (a parent's when shared), else the catalogue price; another price needs a reason.
6. **Charges on orders** (`order_charge`, OC-) may name a sample. They are ready to invoice at once, claimed like tests (one draft per order per person), and credited like tests. A charge on an invoice is changed there or with a credit note, never on the order. A charge can be added straight onto one's own draft (it is recorded on the order too).
7. **Service lines and types** are shared by every lab (catalog.edit), seeded with Cannabis, Dietary supplements, Food, Environmental and Pharmaceutical and their types, for Cecilia and the labs to rename. A test's type is set in the catalogue editor or by fill down on Test catalogue > Service lines. Client service lines: master.clients.
8. **Ordering at list price**: `order_catalogue_test` uses the client's quote line when there is one, else orders the test with `catalogue_order` set: list price (analyte tests with every analyte), the standard turnaround, a rush at the schedule's full surcharge (no quote discount). The order screen says "List price" on such lines; there is no warning. A test of another lab still cannot be ordered on this lab's order ("order it at that lab"); a test with no approved workflow cannot be ordered.
9. **No new permission.** Charge items and service lines: catalog.edit. Order charges: orders.edit. Quoted charges: quotes.edit. Charges on drafts, payments and corrections: invoicing.issue.

## Not built

- The material/matrix level of the picker (Alex: later).
- Ordering another lab's test on this lab's order (cross-lab orders); the subcontract price on quotes already uses the lab's own settings.
- QuickBooks reading payments back (paid status stays manual).
