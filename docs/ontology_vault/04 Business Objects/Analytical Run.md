---
type: Business Object
domain: Laboratory Operations
capability: Analytical Execution
object_classification: Execution Object
status: Reviewed
---

# Analytical Run

## Definition
Documented instrument or analytical execution for one or more tests or a Test Batch.

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
- **may execute** [[Test Batch]]
- **uses** [[Equipment]]
- **performed by** [[User]]
- **produces** [[Analyte Result]]
- **recorded in** [[Electronic Logbook]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Analytical Run?
- What is blocking or affecting this Analytical Run?
- Which related records explain this Analytical Run?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Auto-Batching and Analyst Assignment Workflow]]
