---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Stability Studies Are Quoted Whole and Pulled as Lab Orders

Stability gets a dedicated quoting module. A [[Stability Study]] is quoted up front as a whole: conditions (real time and accelerated) by timepoints, with tests varying by timepoint. The client ships all material; T0 is baseline testing at placement, and pulls start at T1 from chamber storage. Each pull creates a [[Lab Order]] on its pull date, due dates count from the scheduled pull date, and pulls are billed individually. Reports are per timepoint plus a cumulative study report. Built in: per-timepoint pull tolerance (early and late, with fill down), weekend and holiday date adjustment, material sufficiency check at placement, chambers as Equipment so excursions list affected studies, amendments as new versions, cancellation with material disposition, and optional annual price escalation compounded on acceptance anniversaries.

See [[Ontology Principles]].
