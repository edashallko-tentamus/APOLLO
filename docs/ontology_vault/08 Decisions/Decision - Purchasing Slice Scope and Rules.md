---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - Purchasing Slice Scope and Rules

Alex Kiddle, 2026-10-13, answering the design questions for the Phase 1 Purchasing slice. Builds on [[Decision - Vendor Qualification Blocks Purchasing]], [[Decision - Purchase Status Lives on Inventory Lot]] and [[Decision - Lab Supervisor Approves Reorders Until Purchasing Exists]] (now replaced by the approval queue).

- **One [[Vendor Qualification]] for all Tentamus North America labs**, with a lab-specific decision when one lab needs it (resolves the open scope question). QA approves it with a signature.
- **Risk classes are a static table** that sets how often a supplier is re-qualified: shared classes (Class I 3 years, Class II 2 years, Class III 1 year by default) plus each lab's own (for example a Class IV re-qualified every 5 years). More classes give a lab finer risk control. Each review can override the expiry.
- **Go-live:** every supplier already in use gets a one-time "approved (legacy)" record valid 12 months, so ordering does not stop on day one.
- **Prices and a second approval:** requests carry an estimated price; each lab can set an amount above which a General Manager must also approve (default: none).
- **Purchase orders stay in finance.** The LIMS groups approved requests by supplier, records the finance PO number and the supplier's confirmation, and does not replace the finance system.
- **Receiving per line, partial receipts allowed** (the rest stays open as a back-order), with a problem recorded (damaged, temperature excursion, short shipped, wrong item) and the packing slip attached. Alex: "happens all the time".
- **Order lines can be inventory items, equipment or services.** Receiving equipment creates its record in the register, tagged out for qualification. The supplier list replaces the free-text calibration vendors.
- **Who may do what:** request: anyone; approve: Lab Supervisor and General Manager; order: Lab Supervisor, General Manager and a new standard **Accounting** group; receive: anyone; suppliers: QA and General Manager; qualify suppliers: QA.

See [[Ontology Principles]].
