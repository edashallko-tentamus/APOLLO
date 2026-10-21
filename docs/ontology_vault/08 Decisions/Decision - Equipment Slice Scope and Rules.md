---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Equipment Slice Scope and Rules

Alex Kiddle, 2026-10-12, answering the design questions for the Phase 1 Equipment slice. Builds on [[Decision - Equipment Status Is Derived]], [[Decision - Equipment Tag Unified Reason Field Resolves Calibration Block]], [[Decision - Calibration History Preserved as Events]], [[Decision - Equipment Ownership Is Multi-Party and Required]] and [[Decision - Calibration Expiration Auto-Tags Equipment]].

**Decided**
- **Two slices.** Equipment first (register, tag-out and tag-in, calibration and qualification history, maintenance schedules with automatic tag-out, documents, maintenance log). Computational [[Electronic Logbook]]s (templates, entries, calculations) follow as their own slice. (Proposed by Claude; Alex did not object.)
- **[[Equipment Type]] is a static table each lab configures**, the same way as [[Department]]. Calibration interval and alert window are set on each instrument (copied by Duplicate), not inherited from the type.
- **One register for everything.** Pipettes, thermometers and balances are [[Equipment]] records like an HPLC: own serial number, calibration history, can be tagged out. Entered quickly by paste, fill down and Excel upload.
- **Segregation of duties is universal for return to service.** Releasing equipment after Repair, Calibration or Qualification needs the release permission (QA by default; the lab decides who holds it) and the database refuses the person who tagged it out or did or recorded the work, in every lab.
- **Moving an instrument to another lab keeps its history.** A signed transfer; it arrives tagged out for Qualification until the receiving lab releases it. (Chemicals differ: they are re-logged, see [[Decision - Inventory Belongs to a Lab and Transfers Are Re-Logged]].)
- **Blocking test steps and the [[Equipment Impact Assessment]] wait for the Workflow Designer.** Until then a tag-out shows status, warnings and a due and overdue list per owner.
- **The Workflow Designer will name the equipment a test needs:** a main instrument, possibly several. Because each instrument belongs to a department or a group, the system can suggest who else could run the test when an instrument is down, and later another lab with the same capability.
- **Calibration vendors are free text** until Purchasing brings the supplier list.

See [[Ontology Principles]].
