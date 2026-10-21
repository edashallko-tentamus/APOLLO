---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Event Object
status: Reviewed
---

# Maintenance Event

## Definition
Immutable record that maintenance occurred.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
- **Object classification:** [[Event Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Summary (free-form description of the maintenance or repair performed — not required to close the associated [[Equipment Tag]])
- Attached Document (optional link to [[Equipment Document]] — never required to complete Tag-In)

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
- **belongs to** [[Equipment]]
- **documents** [[Equipment Tag]] (the tag-out/tag-in cycle this event describes — shows who tagged out and who tagged back in, via the Tag's own Tagged Out By / Tagged In By)
- **recorded in** [[Maintenance Logbook]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Maintenance Event?
- What is blocking or affecting this Maintenance Event?
- Which related records explain this Maintenance Event?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
