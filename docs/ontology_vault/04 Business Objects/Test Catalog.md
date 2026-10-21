---
type: Business Object
domain: Commercial
capability: Service and Test Catalog
object_classification: Definition Object
status: Reviewed
---

# Test Catalog

## Definition
The catalogue of orderable tests with list pricing, standard TAT and rush schedules, populated by the Test Workflow Designer. Downloadable, and publishable live (for example on the website or portal) for tests marked Show in Public Catalogue. Clients may browse it and request tests, but must be quoted or accept list pricing before submitting.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Service and Test Catalog]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Publication settings

## Derived Values
- Published catalogue (public tests only)
- Downloadable catalogue export

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **contains** [[Test Catalog Entry]]
- **referenced by** [[Quoted Test Configuration]]

## Governing Rules
- [[Quoted-Only Ordering Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Test Catalog?
- What is blocking or affecting this Test Catalog?
- Which related records explain this Test Catalog?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
