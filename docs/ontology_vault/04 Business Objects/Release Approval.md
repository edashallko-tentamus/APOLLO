---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Equipment Availability and Maintenance
object_classification: Governance Object
status: Reviewed
---

# Release Approval

## Definition
Approval releasing equipment back to service after maintenance, calibration, qualification, and checks.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Equipment Availability and Maintenance]]
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
- **approves** [[Equipment]]
- **permits tag in** [[Equipment Tag]]
- **signed by** [[Electronic Signature]]

## Governing Rules
- Governed by [[Ontology Principles]]
- Governed by [[GMP Record Change Control Rule]] for its own creation/edit as a record — separate from the fact that Release Approval's actual purpose is itself an [[Electronic Signature]] event releasing Equipment back to service

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Release Approval?
- What is blocking or affecting this Release Approval?
- Which related records explain this Release Approval?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Equipment Tag-Out Maintenance and TAT Workflow]]
- Governed or affected by [[Equipment Return-to-Service Rule]]
