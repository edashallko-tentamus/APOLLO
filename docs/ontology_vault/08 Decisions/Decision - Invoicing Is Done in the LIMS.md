---
type: Architecture Decision
status: Approved (Alex, 2026-10-15); I-1 built 2026-10-15 (see Decision - Invoicing I-1)
decided: 2026-10-15
---

# Decision - Invoicing Is Done in the LIMS

Alex Kiddle, 2026-10-15: "LIMS will do all the invoicing and we will have to make an API that talks with quickbooks to push it to the accounting side. Accounting will provide POs for ordering but the invoicing and invoices need to be sent to the client from LIMS."

**What this means**
- Invoices are made in the LIMS and sent to the client from the LIMS (not by accounting).
- Each invoice is pushed to accounting (QuickBooks) through an API, to be built.
- Purchasing is unchanged: accounting issues the PO numbers for what the lab buys ([[Decision - Purchasing Slice Scope and Rules]]); the LIMS records them.
- What is invoiced comes from records the LIMS already holds: quoted prices and discounts, rush surcharges, the OOS retest billing determination ([[Decision - Client OOS Retests Are Re-preps Billed by QA Determination]]), serving tests at catalogue price, and each stability pull at its study year's price ([[Decision - Stability Studies S-2 Scope]]).

**Accounting platforms (Alex, 2026-10-15):** QuickBooks Online is the network's preferred platform and is built first. Connections to QuickBooks Desktop and SAP may be needed later, so the push is built behind one connector per platform. Until IT connects it, invoices queue in the LIMS (as emails go to the Outbox).

**Order (Alex, 2026-10-15, revised):** invoicing first, then dashboards (revenue counts when an invoice is issued), then S-2.

**Alex, 2026-10-15 (afternoon)**
- **Flexible:** any completed work can be invoiced at any time; invoicing does not wait for the lab order to be finished.
- **Client portal (later):** the client sees an invoice per test, essentially, and the total of the invoices for each lab order.
- **Alex asked:** partial invoices, or one invoice per lab order updated as testing is completed? (Claude's recommendation, to confirm: partial invoices per lab order, since an issued invoice is never changed.)
- **Existing work when invoicing is first run:** invoices are dated in the month the COA was sent to the client.

**Settled (Alex, 2026-10-15, evening), built as I-1:** see [[Decision - Invoicing I-1]]. Partial invoices per lab order; completed = the test's COA issued; manual review with claims (like Report Finalization); late rush billed at the closest tier met; retests shown clearly; each lab its own QuickBooks company; net 30, no sales tax (finance to confirm); corrections by credit note; Accounting and General Managers; catch-up backdated to the Friday of the week the work was completed (this replaces "the month the COA was sent").

**Was open (now answered in I-1 except where noted)**
- When an order is invoiced (at the COA, per sample, per test, monthly per client), and credit notes and corrections.
- Who in IT and accounting owns the connection.
- Client billing contacts, payment terms, tax, and the invoice layout.
- Replaces the earlier note "Tabled: tie POs to the accounting software later through an API" for the sales side only.
