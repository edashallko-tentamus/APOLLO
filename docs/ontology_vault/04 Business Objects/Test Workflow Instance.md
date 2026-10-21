---
type: Business Object
domain: Laboratory Operations
capability: Analytical Execution
object_classification: Execution Object
status: Reviewed
---

# Test Workflow Instance

## Definition
Execution copy of an approved Workflow Version for one Requested Test.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Analytical Execution]]
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
- **belongs to** [[Requested Test]]
- **derived from** [[Workflow Version]]
- **contains** [[Workflow Step Instance]]
- **produces** [[Result]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Test Workflow Instance?
- What is blocking or affecting this Test Workflow Instance?
- Which related records explain this Test Workflow Instance?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Requested Test Execution Workflow]]
