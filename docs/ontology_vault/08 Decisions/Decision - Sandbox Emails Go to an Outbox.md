---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Sandbox Emails Go to an Outbox

Automatic emails (such as Rush Not Accepted) are generated from fixed templates and stored in an Outbox with recipient, subject and body. In the Sandbox nothing is sent; real delivery is enabled later with IT. Every email is audited.

See [[Ontology Principles]].
