---
type: Architecture Decision
status: Approved in principle (Alex, 2026-10-14); build choices Proposed
decided: 2026-10-14
built: 2026-10-14 (migration 029, seed 022)
---

# Decision - Standalone Quotes

**Alex, 2026-10-14:**
- A standalone quoting module, in the same area as the project quotes, that works the same way as the project quoting tool.
- The difference: projects are groups of tests for a product or a recurring testing bundle; a quote is a one-off answer to a customer.
- A sales person can move between labs to build a quote and send it to the customer while on the phone with them.
- Quotes are listed with Accept and Reject buttons, can be filtered, and show the person who did the quote.
- There is a "My Open Quotes" tab.

**As built**
- **A quote is a project of kind "Quote"**, with its own codes (Q-00001). It uses everything a project quote has:
  - versions and re-quotes;
  - catalogue list prices that cannot be typed, final prices and discounts;
  - analyte trimming, rush terms, specifications and the price checks.
  - An accepted quote's tests can be ordered by the client like a project's (quoted-only ordering is unchanged).
- **Pricing > Quotes** (new) and **Pricing > Projects** (projects only).
  - The Quotes list shows quotes and project quotes together, latest version, newest first.
  - Tabs: **My open quotes** (prepared by me, Draft, Submitted or Quoted) and **All quotes**.
  - Filters: status (Open, Waiting for the client, Accepted, Rejected, Expired, All), type (quotes, projects or both), lab, and prepared by. Search on every column.
  - Each row shows: client, reference, total, status, **Accept… / Reject…** on a quoted row, prepared by, the contact, the labs on it, when it was sent, valid until, and the decision.
- **Prepared by** is the sales person who owns the quote: whoever created it. "Details…" hands the quote to another sales person, and it moves to their "My open quotes".
- **Lab tabs on the quote page:**
  - "Add tests" has one tab per lab plus "All labs". Each lab's own tests plus the tests every lab offers ("Any lab").
  - Search, "+ Add" per test, or several selected and "Add selected".
  - Each line shows its lab. One quote can mix labs, and the PDF groups the lines by lab with a subtotal for each.
  - New lines on a quote start at the list price, so the quote can be sent at once; type over the final price to give a discount.
- **Send to client…:**
  - It issues the quote if it is still a Draft (with a valid-until date, 30 days by default).
  - The server makes the quotation PDF and stores it with its fingerprint.
  - It emails the quote's contact from the "Quotation sent to a client" Outbox template, with an optional message, the PDF attached and a link.
  - The page then shows to whom it was sent and the link, which can be pasted into a chat.
- **The client's link** (`quote-response.html`, no sign-in) shows the quotation and lets the client **accept or decline** it, with their name and an optional note (for example a PO number).
  - Acceptance is recorded for the contact the quote was sent to, marked "online".
  - An expired or already answered quote cannot be answered.
- **Accept… / Reject…** from the list or the quote page record the client's answer when it comes by phone or email. Accept asks who accepted (the quote's contact by default). Reject asks why.

**Build choices (Claude, to confirm)**
1. The quote list includes project quotes (type filter), so one place shows everything waiting for a client. Projects keep their own page.
2. Quotes are not owned by a lab: any sales person with `quotes.edit` in the lab they work in can quote any lab's tests. Sending, accepting and rejecting use `quotes.edit` too (no new permission). *Should sending to a client need its own permission?*
3. The email is listed in the Outbox of the lab the sales person was working in.
4. A quote sent again (to another contact, or after a resend) keeps the same link. Accepting online records the contact it was last sent to.
5. Valid for 30 days by default when sent. After the date the list shows "Past valid date"; the client can no longer accept it online, and the lab can expire it.
6. Rejecting needs a reason; accepting from the list needs the contact who accepted.
7. TPS tests in the demo catalogue (Assay by HPLC, Dissolution, Residual Solvents) have no approved workflow yet: they can be quoted but not ordered until TPS approves their workflows. The picker says "No approved workflow yet".
8. New lines on a standalone quote start at the list price; project lines still start empty (unchanged).
9. **Differs from the ontology.** The vault's [[Quote]] object is a negotiation that, when accepted, creates or updates a [[Project Version]]. As built, a standalone quote *is* a project row of kind "Quote", and its accepted version is what the client orders against. This reuses every pricing and ordering rule unchanged, and nothing about projects changes. [[Quote Type]] (Routine, Stability, Method Development ...) is not used yet; stability quoting will need it. *Claude is about 80% sure this simplification holds up. The case to revisit: a one-off quote that should later become a recurring project. Today that means making a project from scratch.*

See [[Proposal - Quick Design Items for the Next Slice]], [[Decision - All Ordering Is Quoted]].
