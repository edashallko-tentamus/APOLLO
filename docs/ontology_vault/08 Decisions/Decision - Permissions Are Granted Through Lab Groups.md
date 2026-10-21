---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Permissions Are Granted Through Lab Groups

Alex Kiddle, 2026-10-12. Builds on [[Decision - Roles and Permissions Are Additive and Group-Assignable]]. LIMS3 serves 21 CFR 211 pharma labs, 21 CFR 111 supplement labs and ISO 17025 food labs, so access must be flexible enough for each lab to define its own "roles".

**Decided by Alex**
- **A permission list, then groups.** A controlled, hierarchical list of [[Permission]]s (module, then area, then action), granular but not excessively so. Each lab builds its own groups from it; a group is the lab's "role" (Lab Supervisor, HPTLC, Intake, QA...).
- **Additive membership.** A person can belong to several groups (a Lab Supervisor can also be in the HPTLC group); their permissions are the union. Promotion or a change of duties means adding or removing a group, never rebuilding a person's access. This also covers small labs where one person does several jobs, which the current system handles badly.
- **Groups are held per lab.** Membership in one lab grants nothing in another; someone working at two labs has separate memberships at each.
- **Executive group:** a standard view-only group across all labs for VPs, Division Directors and C-suite, for data and dashboard aggregation (data will probably also feed a corporate dashboard or portal).
- **Basic job-role groups are seeded** for now; labs change or add to them.
- **Who approves changes to a group's permissions follows lab policy:** QA in 21 CFR 211 labs; in other labs a GM, Lab Director or QA manager can.
- **Administrator is per lab** and is itself a group; who is in it follows lab policy.

**Agreed 2026-10-12 (proposed by Claude, confirmed by Alex)**
- The separate [[Role]] layer is folded into the group ([[Team]]): a group holds permissions directly. (Alex did not object; treated as agreed.)
- In 21 CFR 211 labs, administrators should be independent of the data (for example IT), following FDA's data integrity guidance; other labs may combine the jobs with administrator actions audited. Alex agreed.
- **No regulatory profile in the system.** Each lab decides its access policy (who approves permission changes, whether administrators may approve data) at IQ/OQ, documents it, and enforces it through how its groups are set up. Kept flexible because a built-in profile is hard to undo; can be added later if needed.
- **System-wide administrators** create labs and maintain the permission list. Starts with Alex Kiddle, who nominates others.
- **Membership and permission changes are signed, dated and kept as history**; deactivating a user ends all memberships.
- **Permission matrix on demand:** an exportable grid of who holds which permission in each lab, plus the history of changes and their sign-offs, for GMP and ISO 17025 audits.

See [[Ontology Principles]].
