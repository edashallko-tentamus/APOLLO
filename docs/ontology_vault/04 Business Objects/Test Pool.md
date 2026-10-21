---
type: Business Object
domain: Laboratory Operations
capability: Test Planning Assignment and Batching
object_classification: Execution Object
status: Reviewed
---

# Test Pool

## Definition
Departmental pool of active Requested Tests available for planning and assignment.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Test Planning Assignment and Batching]]
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
- **owned by** [[Department]]
- **contains** [[Requested Test]]
- **evaluated by** [[Batching Rule]]
- **feeds** [[Analyst Worklist]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Test Pool?
- What is blocking or affecting this Test Pool?
- Which related records explain this Test Pool?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Auto-Batching and Analyst Assignment Workflow]]
- Governed or affected by [[Backlog Rule]]
- Governed or affected by [[Auto-Batching Rule]]
