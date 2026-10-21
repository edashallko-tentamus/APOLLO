---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Sample ID Format Is SITEyymmdd Three-Digit Sequence

Replaces [[Decision - Sample ID Format Is Site-YYMMDD-Sequence]]. A sample receives its ID when it is logged: site code, the site-local date as yymmdd and a three-digit daily sequence per site, with no separators, for example CFL261012001. The sequence restarts each day for each site; past 999 the number simply grows (CFL2610121000) rather than failing. IDs already assigned are never changed. Before logging, a sample is identified by the client's sample ID. Built in migration 004 (`log_samples`).

See [[Ontology Principles]].
