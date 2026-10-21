---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Lab Access Is Assigned Per User by Administrators

Each [[User]] is assigned the [[Laboratory Site]]s they may work in. A user can create or change lab orders, samples and requested tests only in an assigned lab; the database refuses anything else ("You do not have access to lab ..."). Only administrators can create or change sites, holidays, the [[Matrix]] list and lab assignments. Whoever creates a site is assigned to it automatically. Changing an assignment needs a Reason for Change and is audited. This is the first layer of access. Cross-site oversight for executives comes from roles; see [[Decision - Cross-Site Access Comes From Roles]]. Sandbox seed: every user has every lab, except the demo intake user, who is CFL only. Built in migration 004.

See [[Ontology Principles]].
