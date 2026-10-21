---
type: Business Object
domain: Sample Management
capability: Sample Preparation
object_classification: Derived Value
status: Draft
---

# Retained Quantity

## Definition
Quantity Received minus the sum of all Aliquot quantities created against the parent Sample. Aliquot-level consumption is not individually reconciled; this roll-up is the tracked figure.

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Sample Preparation]]
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
- **derived from** [[Aliquot]] (quantity created against parent Sample)
- **applies to** [[Sample]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed or affected by [[Retained Sample Threshold Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current Retained Quantity for this Sample?
- Is this Sample below the retention threshold?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
