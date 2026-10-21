---
type: Architecture Decision
status: Proposed
decided: 2026-10-12
---

# Decision - AI Reads Uploaded Supplier COAs and Proposes Values

When a [[Supplier COA]] is uploaded, an embedded AI agent reads it and proposes the lot's values (manufacturer lot, expiration or retest date, purity/potency, concentration, manufacturer). The proposals are shown beside the document for a person to confirm or correct; nothing is saved until a person confirms. The audit trail records which values the AI proposed, which were changed, and who confirmed (see [[AI Audit Record]]). Requires an AI service key approved by IT, since the document leaves the lab's system to be read; without a key, the same screen works as manual entry beside the COA.

See [[Ontology Principles]].
