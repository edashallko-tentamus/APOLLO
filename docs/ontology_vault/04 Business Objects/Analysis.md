---
type: Business Object
domain: Laboratory Operations
capability: Analytical Execution
object_classification: Execution Object
status: Reviewed
---

# Analysis

## Definition
Actual execution of a Requested Test or workflow step.

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
- **executes** [[Requested Test]]
- **uses** [[Test Version]]
- **uses** [[Sample]]
- **may use** [[Aliquot]]
- **performed by** [[User]]
- **uses** [[Equipment]]
- **uses** [[Inventory Lot]]
- **records** [[Material Usage Record]]
- **produces** [[Result]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Analysis?
- What is blocking or affecting this Analysis?
- Which related records explain this Analysis?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Requested Test Execution Workflow]]
- [[In-House Material Preparation Workflow]]
