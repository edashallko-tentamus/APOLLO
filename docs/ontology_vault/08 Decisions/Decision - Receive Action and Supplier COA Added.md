---
type: Architecture Decision
status: Approved
---

# Decision - Receive Action and Supplier COA Added

Clarifies the receiving flow and resolves last review's flagged duplication — it wasn't an error, it was two legitimate paths that hadn't been distinguished:

1. **Normal path:** [[Supply Purchase Order Line]] creates a pending [[Inventory Lot]] at approval (Purchase Status: Approved). A Receive action on that pending lot's detail screen creates a [[Received Item]], which **fulfills** the existing lot — filling in actual received quantity, manufacturer lot, expiration date, and flipping Purchase Status to Received. It does not create a second lot.
2. **Unexpected/off-system path:** an [[Inventory Receipt]] with no prior Supply Purchase Order Line **creates** a new Inventory Lot directly, already at Received status, since it's already physically present with no pending record to fulfill. This is the same flexibility path as directly logging an inventory item without going through Purchasing at all.

A Receive button is added to the Inventory Lot detail screen (and correspondingly the reorder/duplicate row actions on the list screen), enabled only while Purchase Status is Ordered.

[[Supplier COA]] is added as a new object — deliberately not reusing [[Certificate of Analysis]], which is this lab's own outgoing client-facing report. A Supplier COA is the incoming document from a vendor certifying a specific received lot, and becomes the source for that lot's Purity/Potency and Concentration values rather than those being entered independently. Whether Supplier COA should be required (blocking Receive) for Reference Standard / Microbiological Strain lots — the ones that matter most for reportable results — is not decided here; flagged as an open question.

See [[Ontology Principles]].
