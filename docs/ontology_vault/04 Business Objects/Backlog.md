---
type: Business Object
domain: Laboratory Operations
capability: Test Planning Assignment and Batching
object_classification: Derived Value
status: Reviewed
---

# Backlog

## Definition
Derived collection of incomplete Requested Tests past their due date.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Planning Assignment and Batching]]
- **Object classification:** [[Derived Value]]
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
- **derived from** [[Test Pool]]
- **contains overdue** [[Requested Test]]
- **used by** [[AI-Assisted Scheduling]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Backlog?
- What is blocking or affecting this Backlog?
- Which related records explain this Backlog?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Auto-Batching and Analyst Assignment Workflow]]
- Governed or affected by [[Backlog Rule]]
- Governed or affected by [[Delayed TAT Rule]]
