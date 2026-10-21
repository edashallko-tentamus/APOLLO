---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Inventory Changes Are Electronically Signed

Every create and change in the Inventory module is signed with an electronic signature: the person types their own user ID and password again, and the signature is stored with their full name, the date and time, the meaning and the reason, and is linked from each audit trail entry it covers (Audit trail > Signature). Exception: routine usage (Usage stock movements) is recorded under the signed-in user without a signature; adjustments, disposal and everything else are signed. The meaning is set by the action, not chosen by the signer: Created by, Requested by, Changed by, Approved by, Ordered by, Received by, Adjusted by, Transferred by, Cancelled by, Disposed by, Prepared by, Uploaded by, Verified by. The database enforces it: a change to an inventory table without a valid signature from the same user in the same transaction (less than 30 minutes old) is refused, so no screen, script or upload can bypass it. Demo data and rule tests carry a "Data load script" signature, shown as such in the audit trail. Signature records cannot be edited or deleted. Chosen by Alex Kiddle on 2026-10-12 ("all except routine usage"; meaning "set by the action"). Built in migration 007. To be extended to other modules (orders, results, reports) as they are built.

See [[Electronic Signature]], [[Signature Event]], [[Signature Meaning]], [[GMP Record Change Control Rule]].