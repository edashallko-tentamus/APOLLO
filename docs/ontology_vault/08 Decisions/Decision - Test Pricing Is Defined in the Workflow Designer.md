---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Test Pricing Is Defined in the Workflow Designer

Step 1 of the Test Workflow Designer sets pricing: Base Price Only, Base + Preparation Fee, or Analyte Selection (each analyte priced, toggleable, with fill down; base and prep fee added if set). These are one formula. Pricing, standard TAT, cutoff time and rush schedule are stored on [[Test Catalog Entry]], outside the validated [[Test Version]], so a price change never forces a new test version or requalification. The designer populates a [[Test Catalog]] that can be downloaded or published live for tests marked Show in Public Catalogue.

See [[Ontology Principles]].
