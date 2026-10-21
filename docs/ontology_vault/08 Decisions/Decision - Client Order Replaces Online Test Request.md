---
type: Architecture Decision
status: Approved
---

# Decision - Client Order Replaces Online Test Request

> Client Order was renamed Lab Order on 2026-10-12. See [[Decision - Client Order Renamed Lab Order]].

[[Lab Order|Client Order]] generalizes the former "Online Test Request" object to cover all submission channels (Online, Walk-in, Paper, Phone) via a Submission Channel field, rather than modeling electronic and manual client orders as separate object types. A walk-in or paper submission's first intake step is to create a Client Order (Submission Channel: Walk-in or Paper), after which it flows through the same downstream path — [[Project]], [[Quoted Test Configuration]], [[Expected Sample]], [[Sample]] — as an electronic order.

See [[Ontology Principles]].
