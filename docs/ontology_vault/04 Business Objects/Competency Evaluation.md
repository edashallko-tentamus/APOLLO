---
type: Business Object
domain: Laboratory Operations
capability: Training Competency and Authorization
object_classification: Governance Object
status: Reviewed
---

# Competency Evaluation

## Definition
Pass, conditional pass, or fail evaluation of a competency attempt.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Training Competency and Authorization]]
- **Object classification:** [[Governance Object]]
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
- **evaluates** [[Competency Attempt]]
- **may generate** [[Analyst Qualification]]
- **approved by** [[User]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Competency Evaluation?
- What is blocking or affecting this Competency Evaluation?
- Which related records explain this Competency Evaluation?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Training and Competency Workflow]]

## Built (0.31.0)
- Pass, Conditional pass or Fail on the attempt, signed by the trainer (never the trainee); QA approves or rejects it (signed). See [[Decision - Training and Competency C-1]].
