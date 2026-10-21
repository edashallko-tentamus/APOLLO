---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Analyte Is Independent Static Master Data

[[Analyte]] is a basic, static master table in Scientific Reference Data, independent of Inventory. Inventory draws from it: Reference Standard and Microbiological Strain lots list the analytes they certify with concentration and unit. The earlier gate (an Analyte could only be created from an Inventory Lot) broke on ordinary reported parameters such as pH, moisture and total aerobic count, which have no reference standard lot. Fields: Analyte Code, Analyte Name, Report Name (defaults to name), Analyte Class (Chemical, Microbiological, Physical/General), CAS Number (Chemical only, check digit validated), Synonyms, Status.

What moved: the guarantee that a reported analyte is backed by a traceable standard moves to the test workflow, where a step requires selecting a standard lot that contains the analyte.

Supersedes [[Decision - Analyte Table Extends Existing Analyte Object]].

See [[Ontology Principles]].
