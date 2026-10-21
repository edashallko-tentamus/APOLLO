---
type: Business Object
domain: Master Data and Configuration
capability: Organizational Configuration
object_classification: Definition Object
status: Reviewed
---

# Work Calendar

## Definition
Working days for a site (weekdays minus the site's holidays), used for due dates, stability pull dates and capacity.

## Ownership
- **Core domain:** [[Master Data and Configuration]]
- **Capability:** [[Organizational Configuration]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Working weekdays

## Derived Values
- Working days

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **uses** [[Holiday Calendar]]
- **used by** [[Due Date]]
- **used by** [[Analyst Worklist]]
- **used by** [[Stability Pull]]

## Governing Rules
- [[TAT Clock Start Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Work Calendar?
- What is blocking or affecting this Work Calendar?
- Which related records explain this Work Calendar?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
