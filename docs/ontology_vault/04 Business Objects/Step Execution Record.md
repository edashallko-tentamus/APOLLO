---
type: Business Object
domain: Laboratory Operations
capability: Analytical Execution
object_classification: Event Object
status: Reviewed
---

# Step Execution Record

## Definition
Immutable record of step actions, timings, resources, and completion.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Analytical Execution]]
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
- **belongs to** [[Workflow Step Instance]]
- **performed by** [[User]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Step Execution Record?
- What is blocking or affecting this Step Execution Record?
- Which related records explain this Step Execution Record?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
