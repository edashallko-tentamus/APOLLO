---
type: Business Object
domain: Master Data and Configuration
capability: Template Management
object_classification: Definition Object
status: Reviewed
---

# Logbook Template

## Definition
Controlled reusable structure for an Electronic Logbook.

## Ownership
- **Core domain:** [[Master Data and Configuration]]
- **Capability:** [[Template Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- To be refined

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
- **creates** [[Electronic Logbook]]
- **may belong to** [[Test Workflow]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Logbook Template?
- What is blocking or affecting this Logbook Template?
- Which related records explain this Logbook Template?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## As built (0.18.0, migration 034)
Built as the logbook's **design version** (`logbook_version` with its `logbook_field` rows); see [[Decision - Electronic Logbooks L-1 and L-2]].
- **User Values:** fields in order: key, label, type (Number, Text, Choice, Pass/Fail, Date/time, Equipment, Lot, Calculated), unit, lower and upper limits, limits per equipment, required, choices, formula, published (a value other records use), help.
- **Derived Values:** version number, status (Draft, Effective, Superseded), problems (errors block approval).
- **Rules:** QA approves a Draft (signed, not an author); an Effective design is locked (a change is a new version); entries keep the version they were made with.
