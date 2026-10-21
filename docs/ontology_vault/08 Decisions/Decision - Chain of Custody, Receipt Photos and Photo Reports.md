---
type: Architecture Decision
status: Approved (Alex, 2026-10-20); build choices Proposed
decided: 2026-10-20
built: 2026-10-20 (migration 051, seed 037, version 0.29.0)
---

# Decision - Chain of Custody, Receipt Photos and Photo Reports

Builds [[Chain of Custody]] and [[Custody Event]] (capability [[Chain of Custody]]), photos on the [[Sample]], and new layouts of [[Report Template]] for the [[Certificate of Analysis]].

## Alex's requests (2026-10-20)

1. **A chain of custody document is made with sample submission.** When the samples are received, the person receiving them signs it and their signature is placed in a Received area.
2. **The chain of custody is also the sample manifest** ("either make the chain of custody a sample manifest as well or make a separate document"; no preference: one document, Claude's recommendation, as is usual for testing labs).
3. **Photos at sample receipt**, and report layouts using **one photo** and **two photos**, 4:3.
4. **A QR code on the report.**

## What was built

- **One chain of custody per order** (COC-<order code>), made when the order leaves Draft (Submit, or logging a Draft). It keeps the manifest as submitted. Printed (landscape PDF) it lists every sample: client sample ID, matrix and lot, containers, quantity, preservation, the tests requested, and once received the lab's sample ID, the receipt it came in on, its condition and temperature. It has blank "Relinquished by (client)", "Received by (courier)" and "Relinquished by (courier)" boxes for signatures on paper, and a QR code that opens the order in the LIMS.
- **Receive and sign** (order page, primary button): the ticked samples, when they arrived, delivered by, tracking number, temperature, condition, custody seals (Intact, Broken, None), a note; then the receiver's signature ("Received by"). The receiver needs a handwritten signature and title on file (as for COAs). The samples are logged (sample IDs; the clock starts); the receipt's time, temperature and condition go onto samples that have none of their own. The chain of custody as it then stands, with the receiver's signature image in its own "Received by the laboratory" block, is kept as a PDF with the receipt. Each delivery is its own receipt. Receipts are never changed.
- **The paper copy** the client signed is attached as a scan ("Attach signed paper copy…").
- **Signed receipts only** (Sites, "Signed receipt", system administrators): the database then refuses logging any other way, and "Log samples without signing" disappears. Off for every lab until switched on.
- **Photos:** from the order grid's Photos column or the sample page; taken with the camera or chosen; cropped to 4:3 (the centre) in the browser and checked again by the server and the database; at least 400 x 300; never changed (caption and place on the report can change; retired with a reason). One photo can be "Report photo 1" and one "Report photo 2".
- **Photo layouts:** "Certificate of Analysis with 1 photo" and "with 2 photos" for every lab (RT-002, RT-003), chosen per test in the designer or as a lab's default like any template. The photos print under the client and sample details on the first page of the part. The release check blocks a report whose layout needs a photo the sample does not have.
- **QR code** beside the verification code on every COA (all layouts), encoding the public verification link.

## Build choices (Proposed)

1. One document is both the chain of custody and the sample manifest.
2. The client and couriers sign on paper; the lab's receipt is signed in the LIMS; the scan of the paper copy is attached.
3. Unsigned logging stays possible until a lab switches "Signed receipt" on (all labs off).
4. Each delivery of a partly received order is its own receipt and Received block.
5. A receiver must have a handwritten signature and title on file.
6. Photos are cropped to the centre at 4:3, landscape; no editing in the LIMS.
7. The photos print under the sample details on page 1 of the part (3.4 in. wide for one, 3.05 in. each for two).
8. The QR code on the COA opens the public verification page; on the chain of custody it opens the order in the LIMS (staff only).
9. No new permission: receiving, photos and the paper copy are orders.edit (as logging was).
