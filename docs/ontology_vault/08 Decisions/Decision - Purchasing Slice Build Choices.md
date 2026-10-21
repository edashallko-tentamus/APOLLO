---
type: Architecture Decision
status: Approved in part
decided: 2026-10-13
---

# Decision - Purchasing Slice Build Choices

Claude, 2026-10-13, while building [[Decision - Purchasing Slice Scope and Rules]] (migration 011). **Alex confirmed 2026-10-13:** no self-approval (system administrators included); one approval for requests without a price; a lab's own supplier decision overrides the all-labs one at that lab; calibration companies stored by name for now. The rest are not yet confirmed and are easy to change.

**Approval**
- Nobody approves their own request, and the second approver must be a different person from the first. This applies to system administrators too.
- The second approval is its own permission, purchasing.approve_over, held by the General Manager group.
- A request with no price needs only one approval (its amount is unknown); the queue shows "No price".
- Changing a request after its first approval sends it back to Requested.

**Inventory items**
- An inventory purchase is still requested from Inventory (a new item as a request, or Reorder). Each such request gets its purchase request line automatically, and the two move together.
- The lot page's Approve and Mark as ordered buttons now go through Purchasing. Ordering from the lot page makes a purchase order for that one line.
- inventory.request and inventory.approve were retired; every group that held them now holds purchasing.request and purchasing.approve.
- A partial receipt completes the lot with what arrived. The rest becomes a back-order lot (Ordered) on the same request.

**Suppliers**
- Supplier details (name, account number, contact, address) are kept by purchasing.suppliers (QA and General Managers), on the existing Inventory > Suppliers and manufacturers list.
- A qualification for all labs needs the qualify permission in the lab being worked in. A lab's own latest decision overrides the all-labs one at that lab, in either direction.
- Qualifications cannot be edited: record a new one, or withdraw one entered in error (signed, with a reason).
- Shared risk classes are kept by system administrators; each lab's QA keeps its own.
- Legacy go-live approvals use Class II for 12 months.
- Calibration and service companies are picked from the supplier list, but the name is stored as text on the calibration record (not a link) for now.

**Other**
- Received equipment arrives tagged out for qualification (tag source "New equipment") and needs a type, department and responsible group at receipt.
- Receipts cannot be changed; correct stock with an inventory adjustment.
- One currency (USD). The purchase order page prints, but there is no formal PO document (finance issues it).
- The Accounting group can request, receive and order.

See [[Ontology Principles]].
