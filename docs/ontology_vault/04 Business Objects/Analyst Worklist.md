---
type: Business Object
domain: Laboratory Operations
capability: Test Planning Assignment and Batching
object_classification: Execution Object
status: Reviewed
---

# Analyst Worklist

## Definition
Complete collection of tasks assigned to one analyst, including multiple Tests and task types.

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
- **assigned to** [[User]]
- **contains** [[Worklist Task]]
- **may include** [[Test Batch]]
- **may include** [[Maintenance Work Order]]
- **may include** [[Preparation Record]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Analyst Worklist?
- What is blocking or affecting this Analyst Worklist?
- Which related records explain this Analyst Worklist?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Requested Test Execution Workflow]]
- [[Auto-Batching and Analyst Assignment Workflow]]
