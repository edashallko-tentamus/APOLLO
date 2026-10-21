---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Client OOS Retests Are Re-preps Billed by QA Determination

Definitions: re-analysis puts an already-prepared test sample back on the instrument in a new analytical batch (a lab investigation tool); re-prep prepares a new test sample from scratch and analyzes it in a new batch. A confirmed OOS release emails the client a Request Re-prep link; client retests are always re-preps, from retained sample, with Standard or rush TAT, defaulting to the OOS analytes. QA records the determination: Confirmed OOS or Inconclusive is billable, Lab Error is non-billable including rush. A differing result alone never establishes lab error, which avoids testing into compliance. Originals are never overwritten. This also resolves the open item on non-billable internal retests.

See [[Ontology Principles]].
