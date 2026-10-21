---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Equipment Belongs to a Department and Analysts Edit It

Alex Kiddle, 2026-10-12, reviewing [[Decision - Equipment Slice Build Choices]].

- **Analysts may add and change equipment** (equipment.edit is in the standard Analyst group), as well as tag it out and record calibrations.
- **Every piece of [[Equipment]] belongs to a [[Department]]** of its lab: required (unless retired). A transfer names the receiving lab's department as well as its responsible group.
- Groups can be department specific (for example an HPTLC group); anyone in such a group will usually be allowed to change that equipment's information. **Permissions stay lab-wide** (Alex agreed 2026-10-12): a group's equipment permissions apply to all of its lab's equipment, not only its own department's. Department groups matter as owners (warnings, and later routing in the Workflow Designer). Department-only editing can be added later if a 21 CFR 211 lab needs it.
- The calibration warning window (30 days by default, not yet confirmed by a lab) can be changed on each instrument: on its edit page, in Add many, or by Excel upload.

Built in migration 010. See [[Ontology Principles]].
