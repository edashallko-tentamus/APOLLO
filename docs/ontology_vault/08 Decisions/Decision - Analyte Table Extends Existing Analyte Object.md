---
type: Architecture Decision
status: Superseded
---

# Decision - Analyte Table Extends Existing Analyte Object

> Superseded on 2026-10-12 by [[Decision - Analyte Is Independent Static Master Data]].

The requested "Analyte master data table" (chemical/trade name, report name, CAS number, restricted to Reference Standard and Microbiological Strain) is not a new object — [[Analyte]] already existed in the ontology as "Measurand or reportable constituent" with its fields undefined. This decision fills in those fields and formalizes the gate: an Analyte can only be created from an [[Inventory Lot]] where Chemical Type includes Reference Standard or Microbiological Strain — the same Analyte-Eligible condition already derived on Inventory Lot.

CAS Number and the internal controlled name come from [[Chemical]] via a new **identified by** relationship, rather than being re-entered on Analyte — consistent with the "one record, many roles" principle applied to chemical identity throughout this module. Report Name is new and Analyte-specific: the customer-facing name on a Certificate of Analysis, which may deliberately differ from the internal name.

See [[Ontology Principles]].
