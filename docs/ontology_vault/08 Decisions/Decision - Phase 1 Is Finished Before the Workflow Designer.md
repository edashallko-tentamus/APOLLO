---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Phase 1 Is Finished Before the Workflow Designer

The foundational modules are finished before the Test Workflow Designer and result entry, which are built last. Alex Kiddle's call (2026-10-12): the workflow steps depend on them, so building the designer first would mean rebuilding it.

- **Roles and Permissions** replace the interim job role and administrator flag ([[Decision - Roles and Permissions Are Additive and Group-Assignable]]). Workflow steps need [[Step Authorization]] and analyst qualification, and every module built after this uses real permissions instead of interim checks.
- **Equipment** (with calibration, tag-out and electronic logbooks): Weighing, Data Entry and Incubation steps pick equipment by type and are blocked by tagged-out or out-of-calibration units ([[Decision - Calibration Expiration Auto-Tags Equipment]]). Stability chambers are Equipment.
- **Purchasing** (approval queue, vendor qualification) takes over the interim reorder approval ([[Decision - Lab Supervisor Approves Reorders Until Purchasing Exists]], [[Decision - Vendor Qualification Blocks Purchasing]]).

Proposed order inside Phase 1: Roles and Permissions, then Equipment and Logbooks, then Purchasing. Then the Test Workflow Designer and batch execution. Supersedes the "next slice" in [[Decision - Build Order Is Inventory Before the Workflow Designer]] (Inventory before the designer still holds).

See [[Ontology Principles]].
