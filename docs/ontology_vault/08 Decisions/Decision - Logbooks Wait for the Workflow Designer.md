---
type: Architecture Decision
status: Approved
decided: 2026-10-13
---

# Decision - Logbooks Wait for the Workflow Designer

Alex Kiddle, 2026-10-13. The computational [[Electronic Logbook]]s (templates, limits, formulas, signed entries) need the same machinery as a test's data entry and calculation steps. They are tabled and built after the [[Test Workflow]] Designer, on its calculation engine, so it is built once. Order: Purchasing (closing Phase 1), then the Workflow Designer, then logbooks. See [[Decision - Phase 1 Is Finished Before the Workflow Designer]].

Recorded for the logbook design (Alex, 2026-10-13): entries are signed with credentials by default (GMP needs it and it costs little); each logbook template can switch full credential sign-off off for labs that do not want it.

Direction for how logbook values feed results, the kinds of logbook, and QA review before release: [[Decision - Logbook Values Feed Results Through Scanned Materials]].

See [[Ontology Principles]].
