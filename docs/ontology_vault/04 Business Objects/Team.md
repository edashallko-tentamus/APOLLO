---
type: Business Object
domain: Master Data and Configuration
capability: Organizational Configuration
object_classification: Definition Object
status: Reviewed
---

# Team

## Definition
Organizational team, functioning as a "group" in the permission sense too — e.g. "HPLC Team" (a working group with an equipment/notification purpose) or "Lab Supervisor" (a group used purely to grant a permission set to whoever's added to it, not tied to Department hierarchy). A Team can be assigned Roles that every current member inherits additively, be responsible for Equipment, and receive Notifications and Worklist Tasks addressed to the whole team rather than one individual. See [[Decision - Team Reused for Equipment Ownership and Notification Routing]] and [[Decision - Roles and Permissions Are Additive and Group-Assignable]] — deliberate reuse rather than separate "Group" and "User Group" objects alongside Team.

## Ownership
- **Core domain:** [[Master Data and Configuration]]
- **Capability:** [[Organizational Configuration]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Team Name

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
- **belongs to** [[Department]] (optional — a permission-only group like "Lab Supervisor" need not sit under a Department)
- **contains** [[User]]
- **assigned** [[Role]] (multiple — every current member inherits these additively; see [[Decision - Roles and Permissions Are Additive and Group-Assignable]])
- **responsible for** [[Equipment]] (multiple per Team; an Equipment may have several Teams/Users responsible for it — Equipment requires at least one owner overall, but not specifically a Team; see [[Decision - Equipment Ownership Is Multi-Party and Required]])
- **receives** [[Notification]]
- **receives** [[Worklist Task]] (fanned out to each member's own worklist)
- **is the permission group** a lab builds from the [[Permission]] list (see [[Decision - Permissions Are Granted Through Lab Groups]])

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Team?
- What is blocking or affecting this Team?
- Which related records explain this Team?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
