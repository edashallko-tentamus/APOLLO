---
type: Business Object
domain: Quality Review and Reporting
capability: Report Approval and Release
object_classification: Event Object
status: Reviewed
---

# Client Notification

## Definition
Notification sent to a Client or Contact.

## Ownership
- **Core domain:** [[Quality Review and Reporting]]
- **Capability:** [[Report Approval and Release]]
- **Object classification:** [[Event Object]]
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
- **references** [[Certificate of Analysis]]
- **delivered by** [[Notification]]
- **stored in** the Outbox in the Sandbox (see [[Decision - Sandbox Emails Go to an Outbox]])

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Client Notification?
- What is blocking or affecting this Client Notification?
- Which related records explain this Client Notification?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Report Review and Release Workflow]]
- [[Report Amendment Workflow]]
