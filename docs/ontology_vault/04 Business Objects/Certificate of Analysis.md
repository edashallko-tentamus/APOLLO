---
type: Business Object
domain: Quality Review and Reporting
capability: Certificate of Analysis and Reporting
object_classification: Governance Object
status: Reviewed
---

# Certificate of Analysis

## Definition
Official client-facing report containing approved results.


## Report templates (migration 030, 2026-10-14)
- Each test reports with its version's template (else the lab's default); a COA whose tests use several templates is printed in parts, one per template, with one report ID, signature and verification code. The COA version records the templates used. See [[Decision - Report Templates, Lab Images and Accreditation Placeholders]].

## Ownership
- **Core domain:** [[Quality Review and Reporting]]
- **Capability:** [[Certificate of Analysis and Reporting]]
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
- **reports** [[Sample]]
- **contains** [[Result]]
- **created from** [[Report Template]]
- **has** [[Report Version]]
- **released by** [[Report Release]]
- **may be partial** (completed results released while an OOS result is held, when the client allows partial reports)
- **may be a retest CoA** (new CoA, not an amendment, showing the original OOS result, the retest result and all other tests on the sample order with their final results)

## Governing Rules
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Certificate of Analysis?
- What is blocking or affecting this Certificate of Analysis?
- Which related records explain this Certificate of Analysis?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[Requested Test Execution Workflow]]
- [[Report Review and Release Workflow]]
- [[Report Amendment Workflow]]
- Governed or affected by [[Report Release Blocking Rule]]
