---
type: Business Object
domain: Commercial
capability: Service and Test Catalog
object_classification: Definition Object
status: Reviewed
---

# Rush Fee Schedule

## Definition
A named, reusable set of rush tiers, for example Micro Rush or Chemistry Rush, so different kinds of testing can carry different rush pricing. Assigned to tests in the Test Workflow Designer. Negotiated rush terms are handled on the quote ([[Quote Rush Term]]) or by assigning a different schedule, never by editing tiers on a quote line.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Service and Test Catalog]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Schedule Name
- Description
- Status: Active, Retired

## Derived Values
- Tests using this schedule

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **contains** [[Rush Fee Tier]]
- **assigned to** [[Test Catalog Entry]]
- **quoted through** [[Quote Rush Term]]

## Governing Rules
- [[Rush Fee Calculation Rule]]
- [[Rush Approval Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Rush Fee Schedule?
- What is blocking or affecting this Rush Fee Schedule?
- Which related records explain this Rush Fee Schedule?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
