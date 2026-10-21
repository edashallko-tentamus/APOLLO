---
type: Business Rule
status: Approved
---

# Client Hierarchy Rule

## Rule type
[[Definition Object]]

## Applies to
- [[Client]]

## Required behavior
A Client may have one Parent Client. A client cannot become its own ancestor (loops are rejected). The hierarchy groups clients for reporting and shared projects only; status, holds, contacts and portal visibility do not inherit. A parent's Project is orderable by child clients only when marked Available to Child Clients.

## Value ownership
- Inputs: Parent Client
- Outputs: Validation on save; orderable shared projects

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]
