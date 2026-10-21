---
type: Architecture Decision
status: Approved in principle (Alex, 2026-10-15); build choices Proposed; tax and payment details for finance to confirm
decided: 2026-10-15
built: 2026-10-15 (migration 036, seed 029, version 0.19.0)
---

# Decision - Invoicing I-1

Builds on [[Decision - Invoicing Is Done in the LIMS]]. Objects: [[Invoice]], [[Invoice Line Item]]. Rules: [[Invoice Readiness Rule]], [[Invoice Claim Rule]], [[Late Rush Billing Rule]], [[Issued Invoice Immutability Rule]], [[Retest Billing Rule]], [[Rush Fee Calculation Rule]]. Capability: [[Billing]].

**Alex, 2026-10-15 (answers to the invoicing questions):**
- "Let's do invoicing first ... I want the invoices backdated or set to have been invoiced the month that the COA was sent to the client. We want invoicing to be flexible - any completed work can be invoiced at any time. ... Perhaps a partial invoice is the best way to approach this?"
- "Do the backdating on the week the work was completed - that mimics how we currently invoice on a weekly basis and when the dashboard is populated it can show a weekly fluctuation."
- 1 "Correct" (completed = the test's COA issued to the client). 2 "Agreed" (partial invoices per lab order, with an order billing summary; the client portal later shows each test's charge and the order's total).
- 3 "We do this manually so that invoices are checked for the proper discount. One of our systems has a cool feature where it tells the user if a rush was late, by how many days and gives them the opportunity to bill based on the closest TAT rush fee. I like that feature." And: "someone manually reviews invoices and pushes them to the client/quickbooks. Much like the QA Finalization module, the user reviewing should group what they want to review first and claims them."
- 4 "Yes, if a re-test was ordered it should show that clearly." 5 "Yes each lab is its own quickbook company." 6 "Agreed" (net 30 default per client, no sales tax; finance to confirm). 7 "Agreed" (corrections by credit note; an issued invoice is never edited).
- Permission: the Accounting group and General Managers.

## What was built (migration 036)

- **Billing menu:** Ready to invoice, My draft invoices, All drafts, Invoices and credit notes, QuickBooks queue, Settings; an invoice page; a Billing card on the lab order page.
- **Ready to invoice** ([[Invoice Readiness Rule]]): every test whose results have been on an issued COA, not yet invoiced, at the lab. Not listed: internal work (media qualification, workflow verifications), cancelled tests, a retest whose billing waits for QA's determination. A test replaced by a lab investigation retest is complete when its retest is reported. Each row shows the date reported, the price as ordered (list, discount, rush fee) and, for a rush reported after its due date, how many working days late.
- **Claiming** ([[Invoice Claim Rule]]): the reviewer selects work and claims it; each lab order's work goes onto their own Draft invoice for that order (DR-000001), made if needed and extended on the next claim. Nobody else claims that work, changes the draft or issues it; the holder releases it (the work goes back to Ready to invoice), or a lab administrator takes it back with a reason. Claiming is not signed (it only says who is checking), like Report Finalization.
- **Checking a draft:** each line keeps the price ordered (from the quote), the price billed and the list price. **Price…** corrects the price billed (never above list; a reason printed under the line). **Rush…** ([[Late Rush Billing Rule]]) shows every rush tier on the client's quote with the due date it would have given from the test's Day 0 and whether it was met; the reviewer may bill the tier ordered, a tier whose turnaround was met (the closest is pointed out), or standard, never a dearer tier than ordered, with a reason printed under the line. Lines can be taken off (back to Ready to invoice). The PO (from the order) and a note printed on the invoice can be changed; an internal note is not printed.
- **Retests** are their own lines, labelled "Retest" and shaded, naming the test they repeat and the OOS investigation, who ordered them, and "not charged" when QA found a lab error. A test whose result came from a retest says so.
- **Issuing** (signed "Invoiced by", invoicing.issue, the holder only; one signature for the drafts selected): numbered per lab and kind with no gaps (INV-CFL-000001; credit notes CN-CFL-000001), dated today in the lab's time zone, due after the client's payment terms (net 30 by default), billed to the client's legal name and billing address. In the same transaction the PDF is made from the record and attached (once), emailed to the client's Billing contacts (else the order's contact; Outbox in the Sandbox) and queued for the lab's accounting company.
- **QuickBooks Online:** one accounting connection per lab (each lab is its own company), Not connected until a system administrator sets it up with IT. Each issued invoice or credit note is queued with the payload QuickBooks Online's API takes (Invoice or CreditMemo: DocNumber, TxnDate, DueDate, CustomerRef, SalesTermRef, BillEmail, lines booked to the lab's product/service with the service date). A client's customer ID in each lab's company is kept in a mapping table, filled when the connection is built. Nothing is sent from the Sandbox. QuickBooks Desktop and SAP can be added as other providers.
- **Credit notes** ([[Issued Invoice Immutability Rule]]): from an issued invoice, all its lines not yet credited or the lines selected; signed "Credited by", with the reason printed; "Invoice the work again" (default) sends the work back to Ready to invoice to be invoiced correctly, otherwise the credit is final. Emailed and queued as a CreditMemo. A line is credited once; a credit note is not credited.
- **Order billing:** each test of the order, its billing state (In the lab, Waiting for QA, Ready to invoice, On a draft, Invoiced, Credited, Not billed, Cancelled), charge and invoice, with totals invoiced, ready and still in the lab.
- **Catch-up** (Alex: backdated to the week the work was completed): work completed (COA issued) before the current week is invoiced once, one invoice per lab order per week, dated the **Friday** of that week; issued as a data load (system), not emailed, not queued for QuickBooks, and marked catch-up on the screen and the PDF. This week's work waits in Ready to invoice. Runs once in seed 029; a system administrator can run it again (it never invoices work twice).
- **Settings:** clients' payment terms (Accounting and General Managers; grid with fill down), the lab's accounting company and the payment details printed on invoices (system administrators).
- **Permissions:** `invoicing.issue` (Accounting, General Manager), `invoicing.view` (Account Manager, Project Manager, plus the issuers). Demo user `billing` "Accounting (demo)" in CFL's and TPS's Accounting groups.

## Build choices (Proposed, for Alex to confirm)

1. **Completed = first issued COA carrying the test.** A client who takes no partial reports is invoiced when the COA that carries the test is issued. Re-issued COA versions do not make work billable again.
2. **One draft per lab order per person;** two reviewers can hold different work of one order.
3. **Invoice numbers are given at issue** (gapless per lab), so a discarded draft leaves no gap. Drafts carry DR- codes.
4. **Catch-up dates are the Friday of the COA's week** (Monday to Sunday weeks), and only weeks before the current one; rush billed as ordered (nobody reviewed lateness then).
5. **Catch-up invoices are not emailed or queued** (that work was invoiced outside LIMS3).
6. **A late rush may be billed at the tier ordered, any tier met, or standard; never dearer than ordered;** a reason is required unless billed as ordered. Lateness is counted in working days for business-day tests.
7. **Price corrections never go above list price** and need a reason when they differ from the order.
8. **A percentage rush fee follows the price billed.**
9. **Credit notes are whole lines** (no partial amounts on a line); "Invoice the work again" is the default.
10. **No sales tax, USD only;** payment details text is a lab setting (placeholder until finance provides it).
11. **Payment terms are a client setting** (one for all labs) kept by invoicing.issue holders, not by master.clients.
12. **Invoices are emailed to the client's Billing contacts**, else the order's contact.
13. **Invoice PDF:** the lab's name and address, no logo yet.

## Not built yet
- The QuickBooks Online connection itself (OAuth, sending, retries, customer matching): needs the companies, credentials and IT.
- Payments received and balances (QuickBooks keeps them; they could be read back for dashboards).
- The client portal view of charges and invoices.
- Stability pulls priced by study year are invoiced as ordered (the pull orders carry their prices; S-2).
