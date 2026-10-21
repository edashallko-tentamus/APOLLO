---
type: Architecture Decision
status: Approved
---

# Decision - Method Is Separate From Test and Test Procedure

Three distinct naming layers, not one:

- **Test Name** — the report-facing, client-orderable, catalog and SKU identity. Lives on [[Test]].
- **Method Name and SOP Code** — the lab's own scientific/technical method identity, and the separate controlled document reference in the QMS outside LIMS. These are two fields, not one, because they commonly differ — a Method Name may reference an external standard (e.g. "USP <232>") while the SOP Code is Tentamus's own internal document control number for how that method is actually performed at this lab. Both live on the new [[Method]] object.
- **Test Procedure** — the actual step-by-step procedural content, belonging to a Test Version, filled in after the Test and its Method already exist. Not the same layer as Method's identity fields.

[[Method]] is reusable — more than one [[Test]] may be built on the same Method (e.g. one analytical method backing several different reported-analyte packages). Test "uses" Method as a direct reference, not a copy.

SOP itself is not a separate object — it's represented as SOP Code plus an optional SOP Document upload or SOP Link, both fields on Method, since a Method commonly has one or the other rather than needing its own object with its own lifecycle.

Analytes and microbiological strains are not modeled as separate reportable types — [[Analyte]] already equivalates them (Reference Standard or Microbiological Strain Chemical Type, both Analyte-Eligible), a decision made earlier in the Inventory work and confirmed, not changed, here.

See [[Ontology Principles]].
