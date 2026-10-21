---
type: Business Object
domain: Sample Management
capability: Chain of Custody
object_classification: Governance Object
status: Reviewed
---

# Chain of Custody

## Definition
Complete custody history for a Sample or Aliquot.

## Ownership
- **Core domain:** [[Sample Management]]
- **Capability:** [[Chain of Custody]]
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
- **governs** [[Sample]]
- **contains** [[Custody Event]]
- **contains** [[Transfer Event]]

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Chain of Custody?
- What is blocking or affecting this Chain of Custody?
- Which related records explain this Chain of Custody?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Built (0.29.0)
- One per lab order (COC-<order code>), made when the order is submitted, with the manifest as submitted; also the sample manifest. Printed with blank Relinquished by boxes; the lab's receipts signed in the LIMS. See [[Decision - Chain of Custody, Receipt Photos and Photo Reports]].
