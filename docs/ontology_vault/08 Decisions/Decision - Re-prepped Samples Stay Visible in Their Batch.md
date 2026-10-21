---
type: Architecture Decision
status: Approved (Alex, 2026-10-19: "Agreed and Go")
decided: 2026-10-19
built: 2026-10-19 (version 0.28.1, no migration)
---

# Decision - Re-prepped Samples Stay Visible in Their Batch

Relates to [[Decision - Chemistry Execution Scope and Rules]] (re-prep: back to the top of the backlog, the old entry superseded with its data) and [[Decision - Media Qualification, Batch Edits and Barcode Labels]] (samples removed before a batch starts).

**Context.** Alex (2026-10-19): "When re-prepping a sample the sample disappears from the original batch. I'm not sure if this is the right look... Do you think it should be kept in the batch but results not needed to complete it? That way the user can see that it was in the batch at some point?"

The entry was never deleted: it was kept as Superseded with everything recorded on it, and no step waited on it. Only the Batching tab showed it; the bench step tabs hid it, so it looked gone.

## Decision

1. **A re-prepped sample stays on every step of its original batch**, greyed and read only, with what was recorded for it, and a note: "Re-prepped (reason): now in BAT-x" (a link), or "waiting in the backlog", or "re-prep cancelled".
2. **Nothing more is needed from it:** no step waits on it, it takes no new values, and its readings cannot be reported from that batch.
3. **QC Review lists the re-prepped samples** (who asked, when, where the re-prep went), so the reviewer sees the whole history.
4. **The new batch says where each re-prep came from** ("Re-prep of <label> in BAT-x", a link back).
5. **Samples removed before a batch starts stay hidden** (nothing was done to them in that batch). Proposed by Claude, agreed by Alex.

## Build notes

- Screens and one query only; no database rule changed.
- The Calculation and Results tabs still show only the samples being reported from the batch.
