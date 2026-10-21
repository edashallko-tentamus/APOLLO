---
type: Business Object
domain: Quality Review and Reporting
capability: Deviations and Investigations
object_classification: Event Object
status: Reviewed
---

# Retest Determination

## Definition
QA's evidence-based conclusion after a client retest. The system shows whether the retest result differs from the original, but never decides; QA selects the cause with a reason and e-signature.

## Ownership
- **Core domain:** [[Quality Review and Reporting]]
- **Capability:** [[Deviations and Investigations]]
- **Object classification:** [[Event Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Determination: Confirmed OOS, Lab Error (with assignable cause), Inconclusive
- Reason / assignable cause

## Derived Values
- Billing outcome: Confirmed OOS billable; Lab Error non-billable including any rush fee; Inconclusive billable

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **concludes** [[Retest]]
- **may reference** [[OOS Investigation]]
- **sets billing of** [[Invoice Line Item]]

## Governing Rules
- [[Retest Billing Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Retest Determination?
- What is blocking or affecting this Retest Determination?
- Which related records explain this Retest Determination?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
