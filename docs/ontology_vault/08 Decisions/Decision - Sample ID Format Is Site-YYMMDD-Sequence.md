---
type: Architecture Decision
status: Superseded
decided: 2026-10-12
---

# Decision - Sample ID Format Is Site-YYMMDD-Sequence

> **Superseded 2026-10-12** by [[Decision - Sample ID Format Is SITEyymmdd Three-Digit Sequence]]. Kept as history.

A sample receives its ID when it is logged: site code, the site-local date as YYMMDD, and a two-digit daily sequence per site, for example CFL-261012-01. The sequence restarts each day for each site; past 99 it continues as 100, 101 rather than failing. Before logging, a sample is identified by the client's sample ID.

See [[Ontology Principles]].
