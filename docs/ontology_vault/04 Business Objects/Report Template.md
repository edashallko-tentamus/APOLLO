---
type: Business Object
domain: Master Data and Configuration
capability: Template Management
object_classification: Definition Object
status: Reviewed
---

# Report Template

## Definition
Controlled report layout and content definition.


## As built (migration 030, 2026-10-14)
- `report_template`: code (RT-001), name, layout (only "Standard COA" so far), lab or every lab, default per lab, options (title, method line, test version, dates tested, LOQ column), status.
- Chosen per test version in the Workflow Designer; a test without one uses its lab's default. A sample whose tests use different templates gets one COA in parts, one part per template.
- See [[Decision - Report Templates, Lab Images and Accreditation Placeholders]].

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
- **creates** [[Certificate of Analysis]]
- **has** [[Report Section]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Report Template?
- What is blocking or affecting this Report Template?
- Which related records explain this Report Template?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
