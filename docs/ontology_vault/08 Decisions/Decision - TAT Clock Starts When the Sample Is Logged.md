---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - TAT Clock Starts When the Sample Is Logged

The turnaround clock starts when the sample is logged into the system, not at physical arrival. Logging time is recorded reliably by the system; physical arrival is kept separately on the sample for chain of custody. A test added to a sample that is already logged starts its own clock when it is added. Day 0, cutoff and business-day rules are in [[TAT Clock Start Rule]].

See [[Ontology Principles]].
