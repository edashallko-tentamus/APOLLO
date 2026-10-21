---
type: Business Object
domain: Commercial
capability: Service Requests and Projects
object_classification: Governance Object
status: Reviewed
---

# Project Version

## Definition
A dated, priced version of a [[Project]]. Re-pricing or changing the test list creates a new version; orders stay tied to the version in force when they were placed. Lifecycle: Draft, Submitted for Quote, Quoted, Accepted, then Superseded, Rejected or Expired. Lines are locked once Quoted. Accepting a new version supersedes the previous one.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Service Requests and Projects]]
- **Object classification:** [[Governance Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Version Number (auto)
- Status
- Valid Until (optional quote expiry)
- Accepted By (Contact of the client)
- Accepted At
- Notes
- Rush Discounts by tier (see [[Quote Rush Term]])

## Derived Values
- Quoted At
- Version Total

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **version of** [[Project]]
- **contains** [[Quoted Test Configuration]]
- **contains** [[Quote Rush Term]]
- **accepted by** [[Contact]]
- **issued as** [[Quote]]

## Governing Rules
- [[Quoted-Only Ordering Rule]]
- [[List Price Snapshot Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- See related capability and relationships

## AI Questions
- What is the current status of this Project Version?
- What is blocking or affecting this Project Version?
- Which related records explain this Project Version?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
