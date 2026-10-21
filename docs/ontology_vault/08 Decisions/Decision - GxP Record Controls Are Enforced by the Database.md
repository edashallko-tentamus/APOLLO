---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - GxP Record Controls Are Enforced by the Database

Audit trail, record versioning, Reason for Change on every edit, user attribution and the ban on hard deletes are enforced in the database itself, not only in application code, so no screen or integration can bypass them. Records are deactivated or retired, never deleted. The audit log is append-only. Separate database accounts for the application and administrators are required before any GxP data is entered. Implements [[GMP Record Change Control Rule]] and [[21 CFR Part 11 Controls]].

See [[Ontology Principles]].
