---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - System Administrators Do Setup, Testing Rights Come From Groups

Alex Kiddle, 2026-10-13: "system admin should only be involved with setup and additive rights by being put in the different groups for testing."

- A system administrator sets the system up: labs, the permission list, groups and people, controlled lists.
- A system administrator does not get bench work by being an administrator. Department steps (weighing, digestion, readings and the rest) are done only by members of the department's group. This is the same rule as for everyone else: bench work depends on training, not rights.
- Testing rights are added to a system administrator only by putting them in the lab's groups, as for any person. Nobody can add themselves to a group, so another lab administrator does it.
- The message shown when someone outside the department tries a step says this plainly, and says who to ask.

This confirms the WD-1 design (see [[Decision - Workflow Designer Slice Scope and Rules]], Departments) and the permission model ([[Decision - Permissions Are Granted Through Lab Groups]]).
