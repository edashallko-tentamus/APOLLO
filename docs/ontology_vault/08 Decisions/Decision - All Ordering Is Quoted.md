---
type: Architecture Decision
status: Superseded (2026-10-21)
decided: 2026-10-12
---

# Decision - All Ordering Is Quoted

**Superseded 2026-10-21 (version 0.36.0):** Alex: "Something not quoted is automatically list price without warning." Any test of the ordering lab can now be ordered at its list price; an accepted quote line still wins. See [[Decision - Charges, Service Lines, Ordering at List Price and Invoice Corrections]].

A client may only order tests it has been quoted for. Accepting list pricing is itself recorded as a Project (List Price Acceptance), so every Requested Test traces to exactly one accepted quoted line. Clients can browse and request from the public catalogue but must be quoted or accept list price before submitting. Retests have their own sources linked to the original test: Client OOS Retest and non-billable Lab Investigation Retest (see [[Decision - Client OOS Retests Are Re-preps Billed by QA Determination]]). See [[Quoted-Only Ordering Rule]].

See [[Ontology Principles]].
