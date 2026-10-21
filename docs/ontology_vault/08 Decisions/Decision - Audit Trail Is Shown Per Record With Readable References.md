---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Audit Trail Is Shown Per Record With Readable References

Every audit entry carries a readable label (for example the sample ID, or "Heavy Metals on CFL261012001") and a link to the page of the record it belongs to, so each screen can show its own audit history and the central [[Audit Trail]] page links back to the record. Changes to tests, analytes and rush decisions on a sample appear on that sample's page; this introduces a Sample page. Built in migration 004 (`audit_record_ref`).

See [[Ontology Principles]].
