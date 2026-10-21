---
type: Architecture Decision
status: Approved
---

# Decision - Equipment Ownership Is Multi-Party and Required

[[Equipment]]'s responsible party is not a single optional [[Team]] link. It's a required set spanning two owner types — Team (e.g. "HPLC Team," or a permission-only group like "Lab Supervisor," which is also a Team, not a separate Role-based type) and individually named User (e.g. a General Manager) — and at least one must be assigned before Equipment can be saved, enforced by [[Equipment Responsible Party Required Rule]]. An earlier version of this decision proposed Role as a third owner type ("Lab Supervisor" resolving dynamically to whoever holds that role); that was explicitly rejected — Lab Supervisor is a Team. This is what routes calibration and maintenance [[Notification]]s and [[Worklist Task]]s; unowned Equipment has no notification path, which is why this is a hard block rather than a soft flag.

See [[Ontology Principles]].
