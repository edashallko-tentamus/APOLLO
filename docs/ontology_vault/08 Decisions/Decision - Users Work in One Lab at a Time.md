---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Users Work in One Lab at a Time

A [[User]] works in one [[Laboratory Site]] at a time. An icon showing the lab prefix (for example CFL) sits next to "Working as" at the top of every screen; clicking it switches between the user's assigned labs only. Lab orders, samples, the intake dashboard and the Outbox show the current lab's work, and new lab orders are created in the current lab. Sites are not shown to lab users: Sites and holidays, the Matrix list and lab assignments are on the administrators' Admin pages. Opening a record from another assigned lab through a link is allowed; records from unassigned labs are refused. See [[Lab Access Rule]] and [[Decision - Lab Access Is Assigned Per User by Administrators]]. Requested by Alex Kiddle after reviewing slice 2.

See [[Ontology Principles]].
