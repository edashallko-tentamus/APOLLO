---
type: Business Object
domain: System Integration
capability: Messaging and Notification
object_classification: Event Object
status: Reviewed
---

# Notification

## Definition
Message or alert delivered to a recipient.

## Ownership
- **Core domain:** [[System Integration]]
- **Capability:** [[Messaging and Notification]]
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
- **created from** [[Notification Template]]
- **has** [[Delivery Status]]
- **delivered to** [[User]] or [[Team]] (when delivered to a Team, fans out to each current member individually)
- **may be triggered by** [[Threshold Rule]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Notification?
- What is blocking or affecting this Notification?
- Which related records explain this Notification?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
