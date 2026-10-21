---
type: Business Object
domain: Laboratory Operations
capability: Electronic Logbooks
object_classification: Execution Object
status: Reviewed
---

# Electronic Logbook

## Definition
21 CFR Part 11-compliant structured computational record capable of linking and calculating across logbooks and business objects.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Electronic Logbooks]]
- **Object classification:** [[Execution Object]]
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
- **created from** [[Logbook Template]]
- **contains** [[Logbook Entry]]
- **uses** [[Calculation Formula]]
- **may reference** [[Electronic Logbook]]
- **may reference** [[Sample]]
- **may reference** [[Requested Test]]
- **may reference** [[Equipment]]
- **may reference** [[Inventory Lot]]
- **may produce** [[Result]]
- **signed by** [[Electronic Signature]]
- **governed by** [[Audit Trail]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Electronic Logbook?
- What is blocking or affecting this Electronic Logbook?
- Which related records explain this Electronic Logbook?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Electronic Logbook Calculation Workflow]]
- [[Pathogen Spike Recovery Workflow]]
- Governed or affected by [[Part 11 Logbook Rule]]

## As built (0.18.0, migrations 034 and 035)
See [[Decision - Electronic Logbooks L-1 and L-2]].
- **User Values:** name, kind, what each entry is about (Equipment, Lot, Sample, None), entries due (Daily, Weekly, Monthly, As needed), QA review frequency (Daily, Weekly), signed or recorded, reviewed in the logbook or in the batch, validity (hours), makes a lot (lot name and unit), description, status, the equipment covered with limits per unit.
- **Derived Values:** logbook code (LB-0001), effective and draft design version, entries due now, entries waiting for QA and overdue.
- **Rules:** a sample weights logbook is reviewed in the batch; permissions `logbook.design` (settings and design), `logbook.record`, `logbook.review`.
