---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Units and Unit Conversions Are Controlled Tables

Every unit used in the system (quantities and concentrations) comes from a controlled [[Unit of Measure]] table, kept under Admin > Units: mass, volume, count, mass per volume, mass per mass, volume per volume, parts per (ppm, ppb, ppt), molar and normal, and activity (CFU, IU). A separate Unit conversions table holds the equivalencies ("1 From = Factor x To"). Conversions work in both directions and chain (µg/mL to mg/L to g/L), so one line per pair is enough. All calculated concentrations use only these two tables. QA and administrators maintain both; every change is audited with a reason. A unit already used on inventory keeps its code (set it Inactive and add a new one). Units and conversions delivered with the system are attributed to an inactive System user in the audit trail. Requested by Alex Kiddle after reviewing slice 3; ownership (QA and administrators) chosen by Alex. Built in migration 006.

See [[Ontology Principles]].
