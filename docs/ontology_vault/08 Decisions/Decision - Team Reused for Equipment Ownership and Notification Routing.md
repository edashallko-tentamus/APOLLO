---
type: Architecture Decision
status: Approved
---

# Decision - Team Reused for Equipment Ownership and Notification Routing

The request for "groups of users for ownership and direct messaging" (e.g. an "HPLC Team" that receives calibration tasks) describes an object that already existed: [[Team]], under Master Data and Configuration, previously an unused stub. Rather than create a new "User Group" object, Team gains **responsible for** [[Equipment]], **receives** [[Notification]], and **receives** [[Worklist Task]] relationships. [[Worklist Task]] already supported "may reference Equipment," so no change was needed there — a Team-routed calibration reminder fans out into each member's individual Worklist Task, reusing the existing per-user task mechanism rather than inventing a team-level task type.

See [[Ontology Principles]].
