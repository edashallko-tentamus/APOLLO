---
type: Business Object
domain: Master Data and Configuration
capability: Scientific Reference Data
object_classification: Definition Object
status: Draft
---

# Chemical

> **Retired 2026-10-12**: inventory items carry their own name and CAS and link to [[Analyte]]s instead (see [[Decision - Chemical List Retired, Inventory Items Name Their Analytes]]). Existing records are kept, unused.

## Definition
Controlled chemical/reference material definition, identified by CAS Number. One Chemical record represents one substance regardless of the role(s) it plays when received as inventory — the same Chemical (e.g., Methanol) may be received and used as a Solvent on one lot and a Reference Standard on another. Role is a property of the Inventory Lot (Chemical Type), not of this definition. Replaces the former separate Reagent, Reference Standard, and Solvent definition objects.

## Ownership
- **Core domain:** [[Master Data and Configuration]]
- **Capability:** [[Scientific Reference Data]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- CAS Number
- Controlled Name
- Synonyms
- Whether governed by admin-only or lab-open naming (undecided — see [[Decision - Chemical Inventory Unified Under Inventory Lot]])

## Derived Values
- To be refined

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **used by** [[Inventory Lot]]
- **required by** [[Test Material Requirement]]
- **identifies** [[Analyte]] (when the Chemical is used as a Reference Standard or Microbiological Strain)
- **maintained by** Lab Supervisors, QA, General Managers and administrators (see [[Decision - Chemical List Is Maintained by Supervisors, QA, GMs and Administrators]])

## Governing Rules
- Governed by [[Ontology Principles]]
- See [[Decision - Chemical Inventory Unified Under Inventory Lot]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: chemical master data import.

## AI Questions
- What is the current status of this Chemical?
- Which Inventory Lots exist for this Chemical, and in which Chemical Type roles?
- What is blocking or affecting this Chemical?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
