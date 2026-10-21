---
type: Business Object
domain: Laboratory Operations
capability: Training Competency and Authorization
object_classification: Execution Object
status: Reviewed
---

# Demonstration of Competency

## Definition
Special training Test type used to document analyst competency through controlled training samples.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Training Competency and Authorization]]
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
- **runs under** [[House Account]]
- **belongs to** [[Training Project]]
- **references** [[Test]]
- **creates** [[Competency Evaluation]]
- **may generate** [[Analyst Qualification]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Demonstration of Competency?
- What is blocking or affecting this Demonstration of Competency?
- Which related records explain this Demonstration of Competency?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Training and Competency Workflow]]

## Built (0.31.0)
- Training samples: an internal order of TRN- samples run through the workflow, the known values as their specification. See [[Decision - Training and Competency C-1]].
