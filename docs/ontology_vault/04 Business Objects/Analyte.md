---
type: Business Object
domain: Master Data and Configuration
capability: Scientific Reference Data
object_classification: Definition Object
status: Reviewed
---

# Analyte

## Definition
Measurand or reportable constituent. A basic, static master table that stands on its own; Inventory draws from it (a Reference Standard or Microbiological Strain lot lists the analytes it certifies, each with concentration and unit). Covers non-chemical parameters such as pH, moisture and total aerobic count. Supersedes the earlier rule that an Analyte could only be created from an Inventory Lot.

## Ownership
- **Core domain:** [[Master Data and Configuration]]
- **Capability:** [[Scientific Reference Data]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Analyte Code (auto-generated, e.g. ANL-00001)
- Analyte Name (internal controlled name; unique)
- Report Name (Certificate of Analysis name; defaults to Analyte Name)
- Analyte Class: Chemical, Microbiological, Physical/General
- CAS Number (optional; Chemical only; check digit validated)
- Synonyms
- Status: Active, Retired

## Derived Values
- None

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **certified by** [[Inventory Lot]] (Reference Standard or Microbiological Strain lots list certified analytes)
- **may correspond to** [[Chemical]]
- **configured by** [[Test-Analyte Configuration]]
- **priced by** [[Test-Analyte Availability]]
- **selected by** [[Requested Analyte]]
- **selected by** [[Quoted Analyte Selection]]
- **reported by** [[Analyte Result]]

## Governing Rules
- Editing requires the Manage Analyte Master permission
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Analyte?
- What is blocking or affecting this Analyte?
- Which related records explain this Analyte?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
