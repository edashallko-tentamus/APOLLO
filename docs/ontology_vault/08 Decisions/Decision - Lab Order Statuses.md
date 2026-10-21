---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Lab Order Statuses

A [[Lab Order]] moves Draft, Submitted, Received, In Testing, Complete, Reported. Received means every sample is logged; an order with some samples logged stays Submitted and shows the count logged. In Testing, Complete and Reported arrive with results and reporting.

See [[Ontology Principles]].
