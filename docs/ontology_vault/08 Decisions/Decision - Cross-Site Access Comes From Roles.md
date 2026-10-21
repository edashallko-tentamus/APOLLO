---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Cross-Site Access Comes From Roles

Lab access is an administrator function and becomes part of role-based access rather than a separate idea. Two kinds of lab scope:

- **Working access (edit):** analysts, intake and lab staff are assigned the specific [[Laboratory Site]]s where they log samples, order tests and change records. Assigned per user by administrators, as built in migration 004 ([[Decision - Lab Access Is Assigned Per User by Administrators]]).
- **Oversight access (view across sites):** VPs, Division Directors and C-suite staff get a [[Role]] that lets them see dashboards and records across many or all sites. Proposed default: view only, with no editing of lab work, so cross-site visibility never becomes a way to change another lab's records.

Only administrators grant either kind. Confirmed by Alex 2026-10-12: the Executive group is view only, for data and dashboard aggregation (see [[Decision - Permissions Are Granted Through Lab Groups]]). Build when dashboards and roles are built; the database today supports only working access.

See [[Ontology Principles]].
