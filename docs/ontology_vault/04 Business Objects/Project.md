---
type: Business Object
domain: Commercial
capability: Service Requests and Projects
object_classification: Definition Object
status: Reviewed
---

# Project

## Definition
A static, reusable, client-specific quoted list of tests for a specific purpose (usually one product). It is effectively a client-specific test package: the negotiated pricing applies only when a test is ordered through the project. A Project can be re-ordered indefinitely. Built by the lab, or by the client in the portal and then priced by the lab. Accepting list pricing for catalog tests is also recorded as a Project (flagged List Price Acceptance), so every ordered test traces to an accepted quoted line.

## Ownership
- **Core domain:** [[Commercial]]
- **Capability:** [[Service Requests and Projects]]
- **Object classification:** [[Definition Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Project Code (auto-generated, e.g. PRJ-00001)
- Client
- Project Name
- Purpose
- Origin: Lab, Portal
- Requested By (Contact; required for portal-built projects)
- Available to Child Clients (Yes/No)
- List Price Acceptance (Yes/No)
- Status: Active, Inactive

## Derived Values
- Current Accepted Version
- Orderable Lines

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **owned by** [[Client]]
- **has** [[Project Version]]
- **created or updated by** [[Quote]]
- **applied to** [[Sample]] on a [[Lab Order]]
- **references** [[Purchase Order]]
- **governed by** [[Agreement]]

## Governing Rules
- [[Quoted-Only Ordering Rule]]
- [[List Price Snapshot Rule]]
- Governed by [[Ontology Principles]]

## Related Workflows
- [[Commercial to Sample Intake Workflow]]

## AI Questions
- Which tests can this client order under this project, and at what price?
- When was this project last re-priced, and what changed?
- Which lab orders used this project?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
