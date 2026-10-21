---
type: Business Object
domain: Commercial
capability: Customer Management
object_classification: Definition Object
status: Reviewed
---

# Client Contact

## Definition
The link between one [[Contact]] and one [[Client]], carrying the roles that contact plays for that client. A consultant can be the Ordering and Report contact for one client and only the Report contact for another.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Customer Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Client
- Contact
- Contact Roles (one or more [[Contact Role]] values)
- Portal Visible (may see this client's orders and reports)
- Status: Active, Inactive

## Derived Values
- Can Order for Client (Ordering role, link Active, contact Active, client Active or On Hold)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **links** [[Client]]
- **links** [[Contact]]
- **assigns** [[Contact Role]]

## Governing Rules
- [[Primary Contact Rule]]
- [[Client Account Status Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time.

## AI Questions
- What is the current status of this Client Contact?
- What is blocking or affecting this Client Contact?
- Which related records explain this Client Contact?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
