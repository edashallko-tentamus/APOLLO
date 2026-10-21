---
type: Business Object
domain: Master Data and Configuration
capability: Organizational Configuration
object_classification: Definition Object
status: Reviewed
---

# Holiday Calendar

## Definition
Non-working days for a [[Laboratory Site]]. Business-day TAT and stability pull-date adjustment skip these days.

## Ownership
- **Core domain:** [[Master Data and Configuration]]
- **Capability:** [[Organizational Configuration]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Calendar Name
- Dates and descriptions

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
- **used by** [[Work Calendar]]
- **assigned to** [[Laboratory Site]]

## Governing Rules
- [[TAT Clock Start Rule]]
- [[Stability Pull Generation Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Holiday Calendar?
- What is blocking or affecting this Holiday Calendar?
- Which related records explain this Holiday Calendar?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
