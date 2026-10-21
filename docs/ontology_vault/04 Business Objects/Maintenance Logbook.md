---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Execution Object
status: Reviewed
---

# Maintenance Logbook

## Definition
Part 11-compliant logbook used to tag out equipment, document maintenance, upload evidence, perform checks, and support tag-in.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
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
- **is an** [[Electronic Logbook]]
- **references** [[Equipment]]
- **may create** [[Equipment Tag]]
- **contains** [[Equipment Document]]
- **supports** [[Release Approval]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Maintenance Logbook?
- What is blocking or affecting this Maintenance Logbook?
- Which related records explain this Maintenance Logbook?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Equipment Tag-Out Maintenance and TAT Workflow]]
- Governed or affected by [[Equipment Return-to-Service Rule]]
