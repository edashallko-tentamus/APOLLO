---
type: Business Object
domain: Laboratory Operations
capability: Result Management
object_classification: Execution Object
status: Reviewed
---

# Result

## Definition
Approved or pending output from a Requested Test.

## Ownership
- **Core domain:** [[Laboratory Operations]]
- **Capability:** [[Result Management]]
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
- **belongs to** [[Requested Test]]
- **contains** [[Analyte Result]]
- **derived from** [[Calculation]]
- **reviewed by** [[Technical Review]]
- **reported on** [[Certificate of Analysis]]
- **may be investigated by** [[OOS Investigation]]
- **may be invalidated** only with a documented assignable cause; the original is retained

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## UI Requirements
- Data entry for this object is a grid. Follows the [[Grid Data Entry Standard]]: fill down (Ctrl+D) and copy/paste across rows and columns; no tabbing through rows one at a time. Typical use: manual result entry.

## AI Questions
- What is the current status of this Result?
- What is blocking or affecting this Result?
- Which related records explain this Result?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Requested Test Execution Workflow]]
- [[Pathogen Spike Recovery Workflow]]
- [[Report Review and Release Workflow]]
