---
type: Business Object
domain: Laboratory Operations
capability: Technical Review and Completion
object_classification: Event Object
status: Reviewed
---

# Completion Event

## Definition
Immutable event recording completion of a Requested Test.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Technical Review and Completion]]
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
- **completes** [[Requested Test]]
- **may trigger** [[Certificate of Analysis]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Completion Event?
- What is blocking or affecting this Completion Event?
- Which related records explain this Completion Event?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Requested Test Execution Workflow]]
