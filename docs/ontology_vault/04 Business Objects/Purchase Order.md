---
type: Business Object
domain: Commercial
capability: Financial Authorization
object_classification: Execution Object
status: Reviewed
---

# Purchase Order

## Definition
Client financial authorization for work.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Financial Authorization]]
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
- **provided by** [[Client]]
- **references** [[Quote]]
- **authorizes** [[Project]]
- **referenced by** [[Invoice]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Purchase Order?
- What is blocking or affecting this Purchase Order?
- Which related records explain this Purchase Order?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
