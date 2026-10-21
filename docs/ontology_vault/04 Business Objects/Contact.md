---
type: Business Object
domain: Commercial
capability: Customer Management
object_classification: Definition Object
status: Reviewed
---

# Contact

## Definition
A person who acts for one or more Clients. One person is one record (email is unique across the system); the roles a contact plays are set separately for each client on [[Client Contact]].

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Customer Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- First Name
- Last Name
- Email (unique system-wide)
- Phone
- Job Title
- Portal Access (may log in to the portal at all)
- Status: Active, Inactive

## Derived Values
- Clients visible in portal
- Clients this contact may order for

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **linked to** [[Client]] through [[Client Contact]] (one or many)
- **may access** [[Client Portal]]
- **may accept** [[Project Version]]
- **may request** [[Project]] (portal-built projects)
- **notified by** [[Client Notification]]

## Governing Rules
- [[Primary Contact Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Contact?
- What is blocking or affecting this Contact?
- Which related records explain this Contact?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
