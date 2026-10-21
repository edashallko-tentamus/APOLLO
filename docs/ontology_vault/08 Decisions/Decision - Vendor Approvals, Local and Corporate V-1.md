---
type: Architecture Decision
status: Approved (Alex, 2026-10-19); build choices Proposed
decided: 2026-10-19
built: 2026-10-19 (migration 050, version 0.28.0)
---

# Decision - Vendor Approvals, Local and Corporate V-1

Builds on [[Decision - Purchasing Slice Scope and Rules]] and [[Decision - Vendor Qualification Blocks Purchasing]] (0.5, migration 011), which gave [[Vendor Qualification]] two scopes (all labs, or one lab) that any lab's QA could record. Resolves the open "Scope" question on the business object.

**Context.** Alex (2026-10-19): "We want the vendor approval to be local and to have the ability to promote it to a corporate approval level." Also: "we want to have QA only approve vendors, not the actual purchase requests." Signed in as QA he found the existing supplier approval, which nothing on screen called a vendor approval.

## Alex's decisions (2026-10-19)

1. **Corporate approvals belong to a new all-labs Corporate QA group** (not any lab's QA, not a named person). A lab's QA approves for its own lab.
2. **A lab can be stricter than corporate, never looser.** It may suspend or reject a corporately approved vendor at its lab; while Corporate QA has a vendor suspended or rejected, no lab can use it or approve it.
3. **Corporate approvals use the shared risk classes**, which Corporate QA keeps and can add to (Alex: "can they have their own classifications that they set?": yes). Labs keep their own classes for local approvals.
4. **Proposing a local approval for corporate approval needs at least one attached document and a shared risk class.**
5. **Approvals name what the vendor is approved for (supply scopes), now.**
6. **QA approves vendors only.** Purchase requests stay with purchasing.approve (Lab Supervisors, General Managers); QA never held it in the standard groups.

## What was built (migration 050, seed 036)

- **Corporate QA:** permission `purchasing.qualify_corporate` (cross-lab), held only through the all-labs group "Corporate QA (all labs)" (with `data.view_all` to look at every lab). A lab's group cannot be given it. Demo person `corp.qa` "Corporate QA (demo)". `purchasing.qualify` is now worded "approve vendors for this lab".
- **Two levels:** an approval is for one lab (lab QA) or corporate, for every lab (Corporate QA). What applies at a lab (`vendor_decision`): a corporate Suspended or Not Approved blocks every lab; then the lab's own Suspended or Not Approved; then a current approval covering what is bought, the lab's own first, else the corporate one. Existing all-labs approvals are corporate approvals from 050 on.
- **Supply scopes:** one shared list kept by Corporate QA: Reference standards, Reference strains, Culture media, Reagents and solvents, Consumables, Equipment, Calibration services, Maintenance and repair, Subcontracted testing, Other services, Other purchases. Each inventory item type belongs to one scope. An approval names its scopes or "Every scope" (approvals made before 050 cover every scope); a suspension or rejection covers the whole vendor. A purchase request line has its scopes: inventory items from their types, equipment "Equipment", services and other purchases the requester's choice (else "Other services" / "Other purchases"). Requesting, approving and ordering are refused unless the vendor is approved for the line's scopes at that lab, with a message naming what is missing.
- **Documents:** questionnaires, certificates (with an expiry), audit reports, quality agreements, attached to an approval when it is made or later; never changed, withdrawn with a reason. The page shows the next certificate expiry.
- **Proposals (VP-00001):** lab QA proposes its current approval (signed "Proposed by") with a shared risk class and at most the scopes it approved, once at least one document is attached; one open proposal per vendor; withdrawn with a reason. Corporate QA approves (signed; never the person who proposed it), at most for what the lab approved, which makes the corporate approval and carries the lab's documents to it, or rejects it with a reason the lab sees (the lab's own approval stands).
- **Notices:** a corporate suspension or rejection tells every lab (with how many of its open requests it stops); a decided proposal tells the proposing lab. QA marks them as read. No emails: users have no email address in the LIMS.
- **Screens:** Purchasing > **Vendor approvals** (was "Suppliers"): every vendor here, its decision at this lab and corporately, its scopes, certificate expiry, stopped requests, filters, the notices and the proposals waiting. The vendor page: Approve vendor… (level, decision, risk class, scopes, documents), Attach document…, Propose for corporate approval…, Approve for every lab… / Reject proposal…, Withdraw proposal…, the approval history, documents and proposals. Purchasing > **Risk classes and scopes**. The request form's "For", and a "For" column on the request lists.

## Build choices (Proposed)

1. Corporate QA holds no lab permissions: it approves vendors and decides proposals, and only looks at the labs (view only).
2. A suspension or rejection is for the whole vendor (no per-scope suspension).
3. Existing all-labs approvals became corporate approvals as they were (made by a lab's QA before 050) and cover every scope.
4. One open proposal per vendor across all labs.
5. Corporate QA may narrow a proposal (fewer scopes, another shared class) but never widen it beyond what the lab approved.
6. Notices are in the LIMS only (users have no email address).
7. A request's scopes are fixed for equipment and inventory items; for services and other purchases the requester picks one when requesting (the Change dialog does not offer it: cancel and request again).
8. Direct corporate approvals (without a proposal) need no document; only proposals do (Alex's answer 4 was about proposing).
9. The demo vendors (approved for all labs at go-live) are corporate approvals for every scope.

## Not built

The hub: under one system per lab, the corporate approved vendor list would live in the central hub and be published to each lab (see the multi-lab architecture discussion); built so that move is a lift, not a redesign. Supplier audits as their own records; questionnaires as forms; reminders before a certificate expires (the page lists and filters them).
