---
type: Architecture Decision
status: Approved (Alex, 2026-10-20); build choices Proposed
decided: 2026-10-20
built: 2026-10-20 (version 0.32.0, migration 055)
---

# Decision - Department Training Counts, METRC IDs and Client Licenses

Relates to [[Decision - Training and Competency C-1]] (the training rules), [[Decision - Chain of Custody, Receipt Photos and Photo Reports]] (the photo dialog, the chain of custody) and [[Decision - Result Finalization and the Certificate of Analysis]] (the COA).

**Context.** Alex (2026-10-20), after trying 0.31.1: "The training module looks pretty good but I want each department to set the amount of trained tests not for the whole lab. COC looks good. No suggestions at this time. However, on the lab order page we need to put a place for the METRC ID in cannabis samples. I also want to make sure that the client profile contains a section that can add licenses with expiration dates. This should be additive and able to be recalled within the system. When clicking to add photos, the photos that are already attached should show up."

## Alex's decisions (2026-10-20)

1. **Training: each department sets its own count.** Every department has its own rule (tests to be department trained, what that unlocks, continuing competency). The lab's rule remains only for tests that belong to no department.
2. **METRC ID: optional, format checked.** A field on each sample. When filled in, it must be a METRC package tag. It prints on the COA "when present".
3. **Client licenses: type, number, issuer, dates, file.** A license has a type, a number, the issuing authority, the issued and expiry dates, and an optional scanned copy. They are added over time and never replaced.
4. **Recalled in the system:**
   - the lab order names one of the client's licenses (picked from them);
   - the COA prints it;
   - expiring and expired licenses are warned about.
   Alex did not choose "Block orders if expired": an expired license is flagged, not refused.
5. **Photos:** "Add photos" shows the photos already attached.

## What was built (0.32.0)

- **Department rules.** 055 gives every department a rule copied from its lab's rule, and a new department gets one the same way. The Rules tab lists every department plus "Tests with no department" (the lab rule); nothing is added there by hand. Saving a department's row changes only that department.
- **METRC ID.**
  - `sample.metrc_id` is stored in capitals with spaces removed. It must be `1A` followed by 22 letters or digits (24 characters).
  - It appears as the last column of the order's samples grid and on the sample page. It also appears on the COA ("METRC ID", sample block) and on the chain of custody's manifest, in each case only when filled in.
- **Client licenses.**
  - `client_license` (LIC-00001) holds the fields above plus a note.
  - Editing is limited to people with master.clients (the client list's own permission).
  - A correction asks for a Reason for Change. A renewal is a new license, and the old one is retired with why: Replaced by a renewal, Expired not renewed, Entered in error, or Surrendered or revoked.
  - A retired license is kept unchanged and is no longer offered.
  - The state is shown as Current, Expiring soon (within 30 days), Expired or Retired.
- **Recall.**
  - **Client page:** a Licenses card, plus a "Licenses to renew" warning.
  - **Intake > Client licenses:** every client's licenses, with expired and expiring ones listed first.
  - **The lab order:**
    - "Edit order" > Client license offers the client's current licenses, marking those expiring or expired.
    - The order header shows the chosen license, in red when expired.
    - A license of another client, or a retired one, is refused.
    - An order keeps a license that is retired after it was chosen.
  - **The COA:** a "License" row in the client block, e.g. "Cannabis distributor C11-0000123 (California DCC)".
- **Photos.** The photo dialog lists the photos already attached, each with its report place and caption. Choosing "Report photo 1" (or 2) for a new photo says it takes the place of the one marked now; the server moves the place, as before. Captions, places and retiring are still changed on the sample page.

## Build choices (Proposed)

1. "Expiring soon" means within 30 days, counted on the server's date (not yet the lab's time zone). This is a fixed number, not a setting.
2. The METRC field does not depend on the matrix or category. Any sample may have one, because the lab has no "cannabis" flag yet.
3. The METRC ID and the license are not checked by the COA's read-back (no `data-check`). They print as stored.
4. The license on an order is optional, even for cannabis clients. Nothing at intake requires one.
5. No new permission: licenses use master.clients, the order's license and the METRC ID use orders.edit, and department rules use training.configure.
6. Only the license printed on the COA is chosen per order. A client with several licenses (e.g. distributor and manufacturer) chooses one per order.
