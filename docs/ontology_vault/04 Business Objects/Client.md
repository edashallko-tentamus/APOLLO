---
type: Business Object
domain: Commercial
capability: Customer Management
object_classification: Definition Object
status: Reviewed
---

# Client

## Definition
Organization the laboratory performs work for. Clients may be grouped under a Parent Client (for example a corporate group with several sites), but nothing cascades through the hierarchy: status, holds, contacts and portal visibility are set on each client explicitly.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Customer Management]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Client Code (auto-generated, e.g. CL-00001)
- Legal Name (unique)
- Display Name
- Parent Client (optional link to [[Client]])
- Account Status: Active, On Hold, Inactive
- Regulated (GMP) Client (Yes/No; drives e-signature requirements such as chain of custody)
- Billing Address
- Site Address
- Default Report Delivery (Email, Portal)
- Allow Partial Reports (Yes/No, default Yes; No means an open OOS holds the whole sample report)
- Open item: optional regulatory category for 21 CFR 111 dietary supplement clients (pending QA decision)

## Derived Values
- Can Order (Active or On Hold)
- Can Release Reports (anything except On Hold)
- Child Clients

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **may have parent** [[Client]]
- **has** [[Client Contact]] (links to [[Contact]] with roles)
- **accesses** [[Client Portal]]
- **owns** [[Project]]
- **owns** [[Stability Study]]
- **places** [[Lab Order]]
- **has** [[Agreement]]
- **requests** [[Quote]]
- **provides** [[Purchase Order]]
- **receives** [[Invoice]]

## Governing Rules
- [[Client Account Status Rule]]
- [[Client Hierarchy Rule]]
- [[Quoted-Only Ordering Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- [[Commercial to Sample Intake Workflow]]

## AI Questions
- What is the current status of this Client?
- What is blocking or affecting this Client?
- Which related records explain this Client?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
