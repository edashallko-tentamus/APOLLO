---
type: Decision
status: Accepted (Alex, 2026-10-19); build choices Proposed
decided: 2026-10-19
built: 2026-10-19 (migration 048, version 0.27.0, Claude Code)
---

# Decision - Run Dilutions, the Analyst's Pick and Bench Autosave

## What Alex asked

- "It's very easy to lose your sample weights recorded, it is mandatory to hit the save button first. Can we make the weights automatically saved with any entry. And overwritten entry can be saved. This way a page refresh on accident doesn't lose anything."
- "Can you show me how the picking dilutions between runs works?" It did not exist: a sample had one dilution, shared by every analytical run. A sample diluted further and read again in run 2 had its run 1 reading calculated with the new, larger factor too.
- "I think the analyst should pick the dilution, not the reviewer. They are the ones who know why the dilution was run." "Agreed to all but make the picking a permission so we can turn it off for a lab that doesn't want it."

## Decided

- **Bench values save as they are typed** (every bench grid). Changing a saved value is a correction and asks for its reason straight away.
- **A further dilution is recorded with the analytical run that reads it** ("Add analytical run": aliquot + diluent for the ticked samples, signed with the run). Each reading is calculated with its own run's dilution.
- **The analyst picks the reading reported** for a sample (every analyte, or one), with a note. QC Review shows and uses the pick; the reviewer can choose otherwise, with a justification, and the reviewer's choice wins. The stored result keeps "Picked by the analyst (name): note".
- **Picking is a permission**, `testing.pick_run` (standard groups Analyst and Lab Supervisor). A lab that does not want it takes it off its groups; the reviewer then chooses as before.

## Build choices (Proposed)

- Picks are made while the batch is at the bench (In Progress); once it waits for QC Review, the reviewer chooses.
- A note is always required with a pick.
- One further dilution per new run for the ticked samples (a different dilution: another run).
- Picks apply to final results, not timepoint (preliminary) results.
- The reviewer may override the analyst's pick with a justification (rather than only returning the batch).

## Related

- [[Decision - Analytical Runs, Preliminary Results and Order Statuses]]
- [[Decision - QC Review Build Choices]]
- [[Proposal - Multi-Instrument Pesticide Panel]]
