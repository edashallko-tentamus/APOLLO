---
type: Business Object
domain: Sample Management
capability: Expected Sample Management
object_classification: Execution Object
status: Reviewed
---

# Expected Sample

## Definition
Sample expected from a Project or Client Order before receipt.

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Expected Sample Management]]
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
- **created by** [[Project]]
- **defined by** [[Lab Order]]
- **becomes** [[Sample]]
- **belongs to** [[Lab Order]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: many expected samples entered at once (portal or intake).

## AI Questions
- What is the current status of this Expected Sample?
- What is blocking or affecting this Expected Sample?
- Which related records explain this Expected Sample?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Commercial to Sample Intake Workflow]]
