---
type: Architecture Decision
status: Proposed
decided: 2026-10-12
---

# Decision - Permissions Slice Build Choices

Claude, 2026-10-12, while building [[Decision - Permissions Are Granted Through Lab Groups]] (migration 008). These are build choices Alex has not yet confirmed. Each is easy to change.

**The permission list (22)**
- Admin: admin.users (who is in which group), admin.groups (groups and their permissions), admin.lab (lab details and holidays).
- View across labs: data.view_all, audit.view. The only permissions an all-labs group may hold.
- Master data: master.clients, master.analytes, master.molar_mass, master.units, master.reasons, master.matrices.
- Commercial: catalog.edit, quotes.edit.
- Orders: orders.edit, intake.rush.
- Inventory: inventory.edit, inventory.use, inventory.adjust, inventory.request, inventory.approve, inventory.lists, inventory.upload.

**Standard groups created in every lab** (a starting point the lab changes)
- Administrator: admin.users, admin.groups, admin.lab, master.matrices, audit.view.
- QA: master.analytes, master.molar_mass, master.units, master.reasons, master.matrices, inventory.lists, inventory.upload, inventory.adjust, audit.view.
- Lab Supervisor: orders.edit, intake.rush, inventory edit, use, adjust, request, approve and lists, master.molar_mass, audit.view.
- General Manager: master.clients, catalog.edit, quotes.edit, orders.edit, intake.rush, inventory edit, use, adjust, request and lists, audit.view.
- Analyst: orders.edit, inventory edit, use, adjust and request. (Analysts may adjust stock counts.)
- Intake: master.clients, orders.edit, intake.rush.
- Account Manager: master.clients, quotes.edit.
- Executive (all labs, view only): data.view_all, audit.view. Kept by system administrators.

**Rules**
- System administrators hold every permission in every lab.
- Being in any group at a lab lets a person open that lab; data.view_all lets them view (not change) every lab.
- No one can add themselves to a group, except a system administrator.
- A lab administrator can reset passwords only for people in their own lab (or in no lab yet). Only a system administrator can reset another system administrator's.
- The Executive group holds audit.view, so it can open the permission matrix.
- The old job role and lab ticks are kept in step with groups so nothing else breaks. To be removed before validation.
- Sandbox demo: CFL has an "HPTLC" group (inventory edit, use, request, approve) with no members, to show additive groups.

**Open**
- The system administrator flag is still set directly in the database. It needs a signed screen.
- The audit trail page does not yet check audit.view.

See [[Ontology Principles]].
