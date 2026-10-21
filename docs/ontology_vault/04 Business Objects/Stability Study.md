---
type: Business Object
domain: Sample Management
capability: Stability Studies
object_classification: Definition Object
status: Reviewed
---

# Stability Study

## Definition
A client stability program for one product, quoted up front as a whole through the dedicated stability quoting module ([[Quote Type]] Stability Testing). The client ships all material at the start. T0 is baseline testing at placement; pulls begin at T1 and draw from chamber storage. Each pull creates a [[Lab Order]] on its pull date and is billed when completed. Reports are issued per timepoint and as a cumulative study report.


## As built (migration 032, 2026-10-14)
- A stability quote (SQ-00001, a quote of kind Stability) holds the design: plan, conditions, timepoints, tests and the matrix. Accepting it creates the study (STB-00001) and its T0 order (origin Stability Baseline).
- Statuses: Awaiting material, Active, Completed (Cancelled to come). Placement records the date, the stored material per condition (rack and position) and schedules the pulls.
- See [[Decision - Stability Studies S-1]].

## As built (0.18.0, logbooks)
- A chamber reading outside its condition (from the temperature logbook) is listed on every study whose material was stored in that chamber at the time (Chamber excursions on the study page). It is not assessed in the system yet (S-2). See [[Decision - Electronic Logbooks L-1 and L-2]].

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Stability Studies]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Study Code
- Client
- Product
- Protocol reference
- Placement Date (T0)
- Status: Active, Completed, Cancelled

## Derived Values
- Current Accepted Version
- Next scheduled pull
- Material remaining by condition

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **owned by** [[Client]]
- **has** [[Stability Study Version]]
- **stores** [[Sample]] (one study sample per condition)
- **generates** [[Stability Pull]]
- **reported in** [[Client Report]] (cumulative)
- **stored in** [[Equipment]] (chambers)

## Governing Rules
- [[Stability Pull Generation Rule]]
- [[Stability Material Sufficiency Rule]]
- [[Stability Price Escalation Rule]]
- [[Quoted-Only Ordering Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the next pull for this study, and is there enough material?
- Which studies are affected by this chamber excursion?
- What will the 24-month pull cost?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
