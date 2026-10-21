---
type: Business Object
domain: Master Data and Configuration
capability: Organizational Configuration
object_classification: Definition Object
status: Reviewed
---

# Laboratory Site

## Definition
Physical or organizational laboratory site. Cutoff times and due dates are evaluated in the site's local time; business-day turnaround skips the site's holidays. Seeded in the Sandbox: CFL (America/Los_Angeles, confirmed; see [[Decision - CFL Site Time Zone Is Pacific]]) and TPS (Tentamus Pharmaceutical Services, St. Petersburg, FL, America/New_York).


## As built (migration 030, 2026-10-14)
- Accreditation placeholders on the lab: body, certificate number, statement (printed on the COA when filled).
- Lab images (`site_media`): logo, small logo, accreditation mark and other images, placeholders until uploaded. See [[Decision - Report Templates, Lab Images and Accreditation Placeholders]].

## Ownership
- **Core domain:** [[Master Data and Configuration]]
- **Capability:** [[Organizational Configuration]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Site Code (used in sample IDs, e.g. CFL)
- Site Name
- Time Zone
- Holiday Calendar
- Address
- Default OOS Procedure (pharma sites: Full Phase I; others: Check and Acknowledge)
- Status

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
- **contains** [[Department]]
- **assigned to** [[User]]
- **uses** [[Holiday Calendar]]
- **uses** [[Work Calendar]]
- **receives** [[Lab Order]]
- **default for** [[OOS Procedure]]
- **assigned to** [[User]] (lab access; creator assigned automatically)

## Governing Rules
- [[TAT Clock Start Rule]]
- Governed by [[Ontology Principles]]
- [[Lab Access Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Laboratory Site?
- What is blocking or affecting this Laboratory Site?
- Which related records explain this Laboratory Site?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
