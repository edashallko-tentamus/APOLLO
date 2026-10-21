---
type: Architecture Decision
status: Approved
---

# Decision - Composite Aliquot Aggregates From Aliquots, Not Samples

[[Composite Aliquot]] is composed of multiple existing [[Aliquot]] records, each already traceable to one parent [[Sample]], rather than referencing Samples directly. This preserves per-Aliquot quantity tracking and traceability resolution (which specific portion of which Sample contributed) without altering [[Decision - Sample Subdivides Only into Aliquots]].

See [[Ontology Principles]].
