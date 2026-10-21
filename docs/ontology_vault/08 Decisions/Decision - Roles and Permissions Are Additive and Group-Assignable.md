---
type: Architecture Decision
status: Approved
---

# Decision - Roles and Permissions Are Additive and Group-Assignable

Two changes to how access control works across the whole system, not just Equipment:

1. **Roles are composed of individually selectable Permissions**, not fixed hardcoded bundles. An admin builds a Role by picking which [[Permission]] records belong to it — each lab can shape its own Roles to fit how its personnel actually work, rather than using a one-size-fits-all bundle.
2. **A User's effective permission set is additive**, not a single assigned Role. It's the union of every Permission from every [[Role]] assigned directly to the User, plus every Permission granted by every [[Team]] the User is a member of. Joining a Team adds to what a User already has; it never replaces or narrows it.

[[Team]] can now be assigned Roles directly — a Team used this way (e.g. "Lab Supervisor") functions purely as a permission-granting group and need not belong to a Department or have any Equipment/notification responsibility. This is why Equipment ownership only needed Team and User as owner types, not a third Role type — anything that would have been "assign this Role as an owner" is instead "assign this Team, which carries that Role's permissions."

See [[Ontology Principles]].
