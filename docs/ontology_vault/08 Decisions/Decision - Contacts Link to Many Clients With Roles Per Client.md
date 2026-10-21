---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Contacts Link to Many Clients With Roles Per Client

One person is one [[Contact]] (email unique system-wide). [[Client Contact]] links a contact to each client and carries that contact's roles for that client, so a consultant can order for several clients and see all of them in the portal with one login. Roles are a controlled list ([[Contact Role]]): Primary, Secondary, Ordering, Receives Report, Billing, Quality. The Quality role exists so out-of-specification results and discrepancies reach the client's QA, not just whoever ordered.

See [[Ontology Principles]].
