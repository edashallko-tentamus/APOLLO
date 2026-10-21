---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Project Is a Reusable Client-Specific Quoted Test Package

A [[Project]] is a static, reusable, client-specific quoted list of tests, usually for one product, re-orderable indefinitely; custom pricing applies only when a test is ordered through it. A [[Quote]] is the negotiation; accepting it creates or updates a [[Project Version]]. Versions keep old orders on old terms. Pricing is per test: quantity, list price snapshot, manually entered final price per sample, discount in dollars and percent. Partial ordering (cancelling some of a project's tests) is allowed. A parent client's project can be shared with child clients when explicitly marked. Clients can build projects in the portal, which the lab then prices. [[Quoted Test Configuration]] is the single priced line; [[Quote Line Item]] is retired. Time-bound engagements such as stability are modeled separately ([[Stability Study]]).

See [[Ontology Principles]].
