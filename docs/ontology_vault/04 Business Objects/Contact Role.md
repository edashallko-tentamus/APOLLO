---
type: Business Object
domain: Commercial
capability: Customer Management
object_classification: Definition Object
status: Reviewed
---

# Contact Role

## Definition
Controlled list of the roles a contact can play for a client. Renamed from the earlier 'Role' field on Contact to avoid confusion with security [[Role]]. Adding a new role is a configuration change, not a schema change.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Customer Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Primary Contact: main point of contact; exactly one active per client
- Secondary Contact: backup point of contact, copied on account communications; any number per client
- Ordering Contact: may submit orders and samples for the client
- Receives Report: receives Certificates of Analysis and reports
- Billing Contact: receives quotes, invoices and statements
- Quality Contact: notified of out-of-specification results, sample discrepancies and deviations

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
- **assigned through** [[Client Contact]]

## Governing Rules
- [[Primary Contact Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Contact Role?
- What is blocking or affecting this Contact Role?
- Which related records explain this Contact Role?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
