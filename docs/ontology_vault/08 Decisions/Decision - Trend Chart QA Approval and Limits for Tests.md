---
type: Architecture Decision
status: Accepted (Alex's notes and choices, 2026-10-19); build choices Proposed
decided: 2026-10-19
built: 2026-10-19 (migration 044, version 0.24.1, Claude Code)
---

# Decision - Trend Chart QA Approval and Limits for Tests

Alex's notes after looking at [[Decision - Trending and Control Charts T-1]] (2026-10-19), and his answers to Claude Code's questions.

## What Alex asked

1. A button to download all charts as a single report.
2. The legend shows each kind of line as its symbol, not described in words.
3. Logbook error % as a recovery: ignore it if it can be set up in the logbook.
4. Units on the axes and wherever data is shown (his example: the stability chamber chart).
5. A QA reviewable setting on charts that shows on QA's to-do widget, so QA can review and approve control charts.
6. For QC charts, the control chart limits uploaded to the test's QC type after approval.

## Alex's choices

- **QA approves the chart and its limits** (not only the chart, not only the limits).
- **Limits go into the test through a new test version** (not written into the effective version).
- **Download all covers every saved chart** (not only the watched ones).

## What was decided

- **QA approval.** A chart can be marked QA reviewable. QA approves it with an electronic signature ("Approved by"), under a new permission `trending.approve` given to the standard QA groups. Whoever made the chart, last changed it or froze its limits cannot approve it. A change to what it charts, its rules or its frozen limits sends it back to Awaiting QA. QA's Home to-do widget lists "Control charts to approve".
- **QC Review.** A chart shown in QC Review is always QA reviewable, and is shown there only once QA has approved it. Charts already in QC Review when this was built (TC-0005 on Alex's data) went back to Awaiting QA.
- **Limits for the test.** An approved QC chart of one QC check and one analyte, with frozen limits, offers "Use these limits for the test…". The limits are the frozen centre line ± 3 sigma, written into that analyte's row of the QC criterion in the test's Draft version (a new Draft from the effective version when there is none), signed "Changed by" with a reason. The Draft is then approved in the designer as usual. The chart records which version and who.
- **Download all.** Trend watch has "Download all (PDF)"; Report packs has "Every saved chart". Both list each chart's QA status.
- **Units and symbols.** Every chart has axis titles with units, and a key drawing each symbol (point, signal, centre line, control limits, specification or logbook limits, sigma bands, bars).
- **Logbook recovery (note 3): no build.** Add a calculated field "Recovery %" = reading ÷ nominal × 100 in a new version of the logbook; only entries recorded after it carry it.
- **The units example (note 4).** The chamber chart in Alex's screenshot counts excursions per month, so its axis is "Excursions per month"; the temperatures chart (TC-0001) is the one in °C.

## Build choices (Proposed)

- Rounding of carried limits: 4 significant figures. Range criteria take LCL to UCL; Max criteria take UCL only.
- Carrying limits needs `methods.design` (the person changing the test design), not `trending.approve`.
- Recording the limits in the Draft does not send the chart back to QA (it is not a change to the chart).
- Only QA (`trending.approve`) can take a chart off QA review; a chart must leave QC Review first.
- Retiring a chart keeps its QA status.
- A chart that charts each analyte, or every QC check, cannot carry limits: make a chart of one analyte.

## Open (for QA, Jake Teller)

- Is ± 3 sigma from a frozen baseline the right basis for a test's QC acceptance limits, or should the lab review them against the method's own requirements first? (The Draft's approval is that review as built.)
- Minimum baseline size before limits may be carried (built: 20 points for an individuals chart, as for freezing).

## Related

- [[Decision - Trending and Control Charts T-1]]
- [[Decision - QC Criteria Are Set Per Analyte]]
- [[Decision - Test Workflow Changes Are Electronically Signed]]
