---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Chemical List Retired, Inventory Items Name Their Analytes

Supersedes the separate [[Chemical]] list ([[Decision - Chemical List Is Maintained by Supervisors, QA, GMs and Administrators]]). Keeping a Chemical entry and an inventory entry for the same material was double work for staff. Each [[Inventory Lot]] now carries its own name and CAS number (check digit validated), and is linked to one or more [[Analyte]]s from the Analytes table, each with a concentration and unit (a multi-element standard has one line per element). A Reference Standard or Microbiological Strain must name at least one analyte; that is what makes it analyte-eligible. CAS is filled in from a single analyte when left empty. Existing lots kept the chemical's name, CAS and analyte; the old Chemical records stay in the database (never deleted) but are no longer used by the screens. Requested by Alex Kiddle after reviewing slice 3. Built in migration 006.

See [[Ontology Principles]].
