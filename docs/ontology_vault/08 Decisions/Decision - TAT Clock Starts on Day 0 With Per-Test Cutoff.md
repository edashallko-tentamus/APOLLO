---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - TAT Clock Starts on Day 0 With Per-Test Cutoff

Receipt (logging) day is Day 0; the next day is Day 1. Each test has its own cutoff time in the designer; after it, Day 0 moves to the next working day while the test stays in the pool. Business-day tests received on a weekend or holiday start Day 0 on the next business day. Standard TAT is the maximum. Each site has a time zone and holiday calendar. See [[TAT Clock Start Rule]].

See [[Ontology Principles]].
